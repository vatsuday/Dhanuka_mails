// Identity routes (S1.1–S1.4). Responses never reveal whether an account exists.
import { SESSION_COOKIE, type IdentityService, type MfaService, type RequestContext } from '@dm/core';
import type { AppWithLogger } from '@dm/shared';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clearedSessionCookie, readCookie, sessionCookie } from '../http/cookies.ts';
import { auth } from '../http/guards.ts';

const email = z.string().max(320);
const password = z.string().max(1024);
const token = z.string().max(128);

const SignupBody = z.object({
  email,
  password,
  name: z.string().max(200).optional(),
  termsVersion: z.string().max(32),
  aupVersion: z.string().max(32),
});
const TokenBody = z.object({ token });
const EmailBody = z.object({ email });
const LoginBody = z.object({ email, password });
const ResetConfirmBody = z.object({ token, password });
const CodeBody = z.object({ code: z.string().max(32) });
const MfaLoginBody = z.object({ challengeId: z.string().max(64), code: z.string().max(32) });

export function requestContext(request: FastifyRequest): RequestContext {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

/** Validates a body or sends 400 with field names (never values). */
export async function parse<T>(schema: z.ZodType<T>, request: FastifyRequest, reply: FastifyReply): Promise<T | undefined> {
  const result = schema.safeParse(request.body);
  if (result.success) return result.data;
  await reply.code(400).send({ error: 'invalid_request', fields: result.error.issues.map((i) => i.path.join('.')) });
  return undefined;
}

function rateLimited(reply: FastifyReply, retryAfterMs = 60_000) {
  return reply.code(429).header('retry-after', String(Math.ceil(retryAfterMs / 1000))).send({ error: 'rate_limited' });
}

const PUBLIC = { config: { permission: 'public' } } as const;
const SESSION = { config: { permission: 'session' } } as const;
const ACCEPTED = { status: 'accepted' } as const;

export function registerAuthRoutes<L extends FastifyBaseLogger>(app: AppWithLogger<L>, identity: IdentityService, mfa: MfaService): void {
  app.post('/auth/signup', PUBLIC, async (request, reply) => {
    const body = await parse(SignupBody, request, reply);
    if (body === undefined) return reply;
    const result = await identity.signup(body, requestContext(request));
    if (result.ok) return reply.code(202).send(ACCEPTED);
    if (result.error === 'rate_limited') return rateLimited(reply, result.retryAfterMs);
    return reply.code(400).send({ error: result.error });
  });

  app.post('/auth/verify-email', PUBLIC, async (request, reply) => {
    const body = await parse(TokenBody, request, reply);
    if (body === undefined) return reply;
    const result = await identity.verifyEmail(body.token, requestContext(request));
    return result.ok ? reply.send({ status: 'verified' }) : reply.code(400).send({ error: result.error });
  });

  app.post('/auth/resend-verification', PUBLIC, async (request, reply) => {
    const body = await parse(EmailBody, request, reply);
    if (body === undefined) return reply;
    const result = await identity.resendVerification(body.email, requestContext(request));
    return result.ok ? reply.code(202).send(ACCEPTED) : rateLimited(reply, result.retryAfterMs);
  });

  app.post('/auth/login', PUBLIC, async (request, reply) => {
    const body = await parse(LoginBody, request, reply);
    if (body === undefined) return reply;
    const previous = readCookie(request.headers.cookie, SESSION_COOKIE);
    const result = await identity.login(body.email, body.password, requestContext(request), previous);
    if (!result.ok) {
      if (result.error === 'rate_limited') return rateLimited(reply, result.retryAfterMs);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    // With MFA on, the password alone gives no session: the client answers the challenge next (S2.1 AC 6).
    if (result.kind === 'mfa_required') return reply.send({ mfaRequired: true, challengeId: result.challengeId });
    return reply.header('set-cookie', sessionCookie(result.sessionId)).send({ user: await identity.getUser(result.userId) });
  });

  app.post('/auth/login/mfa', PUBLIC, async (request, reply) => {
    const body = await parse(MfaLoginBody, request, reply);
    if (body === undefined) return reply;
    const result = await identity.completeMfaLogin(body.challengeId, body.code, requestContext(request));
    if (!result.ok) return reply.code(401).send({ error: result.error });
    return reply.header('set-cookie', sessionCookie(result.sessionId)).send({ user: await identity.getUser(result.userId) });
  });

  app.post('/auth/mfa/enroll', SESSION, async (request, reply) => {
    const { userId } = auth(request);
    const user = await identity.getUser(userId);
    if (user === undefined) return reply.code(401).send({ error: 'unauthenticated' });
    const result = await mfa.startEnrolment(userId, user.email);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.send({
      secret: result.secret,
      otpauthUri: result.otpauthUri,
      qrCode: `data:image/svg+xml;base64,${Buffer.from(result.qrSvg).toString('base64')}`,
    });
  });

  app.post('/auth/mfa/confirm', SESSION, async (request, reply) => {
    const body = await parse(CodeBody, request, reply);
    if (body === undefined) return reply;
    const result = await mfa.confirmEnrolment(auth(request).userId, body.code, requestContext(request));
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return reply.send({ recoveryCodes: result.recoveryCodes });
  });

  app.post('/auth/mfa/disable', SESSION, async (request, reply) => {
    const body = await parse(CodeBody, request, reply);
    if (body === undefined) return reply;
    const result = await mfa.disable(auth(request).userId, body.code, requestContext(request));
    return result.ok ? reply.code(204).send() : reply.code(400).send({ error: result.error });
  });

  app.get('/auth/mfa', SESSION, async (request) => {
    const remaining = await mfa.remainingRecoveryCodes(auth(request).userId);
    return { enabled: remaining !== undefined, recoveryCodesRemaining: remaining ?? 0 };
  });

  app.post('/auth/logout', SESSION, async (request, reply) => {
    const { sessionId, userId } = auth(request);
    await identity.logout(sessionId, userId, requestContext(request));
    return reply.header('set-cookie', clearedSessionCookie()).code(204).send();
  });

  app.post('/auth/password-reset/request', PUBLIC, async (request, reply) => {
    const body = await parse(EmailBody, request, reply);
    if (body === undefined) return reply;
    const result = await identity.requestPasswordReset(body.email, requestContext(request));
    return result.ok ? reply.code(202).send(ACCEPTED) : rateLimited(reply, result.retryAfterMs);
  });

  app.post('/auth/password-reset/confirm', PUBLIC, async (request, reply) => {
    const body = await parse(ResetConfirmBody, request, reply);
    if (body === undefined) return reply;
    const result = await identity.resetPassword(body.token, body.password, requestContext(request));
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return reply.header('set-cookie', clearedSessionCookie()).send({ status: 'password_changed' });
  });
}
