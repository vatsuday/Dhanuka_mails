// Members and invitations (S2.2). Managing them needs members:manage; accepting needs only a session,
// because the invitee is not a member yet.
import type { InvitationService, SessionStore } from '@dm/core';
import type { AppWithLogger } from '@dm/shared';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { sessionCookie } from '../http/cookies.ts';
import { auth, tenantAuth } from '../http/guards.ts';
import { parse, rateLimited, requestContext } from './auth.ts';

const InviteBody = z.object({ email: z.string().max(320), role: z.string().max(20) });
const TokenBody = z.object({ token: z.string().max(64) });
const InvitationParams = z.object({ id: z.uuid() });

const MANAGE = { config: { permission: 'members:manage' } } as const;

export function registerInvitationRoutes<L extends FastifyBaseLogger>(
  app: AppWithLogger<L>,
  { invitations, sessions }: { invitations: InvitationService; sessions: SessionStore },
): void {
  app.get('/orgs/current/members', { config: { permission: 'org:view' } }, async (request) => ({
    members: await invitations.members(tenantAuth(request).tenantId),
  }));

  app.get('/orgs/current/invitations', MANAGE, async (request) => ({
    invitations: await invitations.listPending(tenantAuth(request).tenantId),
  }));

  app.post('/orgs/current/invitations', MANAGE, async (request, reply) => {
    const body = await parse(InviteBody, request, reply);
    if (body === undefined) return reply;
    const { tenantId, userId, role } = tenantAuth(request);
    const result = await invitations.create(tenantId, { userId, role }, body.email, body.role, requestContext(request));
    if (result.ok) return reply.code(201).send({ invitationId: result.invitationId });
    if (result.error === 'rate_limited') return rateLimited(reply, result.retryAfterMs);
    return reply.code(result.error === 'role_not_allowed' ? 403 : result.error === 'already_member' ? 409 : 400).send({ error: result.error });
  });

  app.post('/orgs/current/invitations/:id/revoke', MANAGE, async (request, reply) => {
    const params = InvitationParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const { tenantId, userId } = tenantAuth(request);
    const result = await invitations.revoke(tenantId, userId, params.data.id, requestContext(request));
    return result.ok ? reply.code(204).send() : reply.code(404).send({ error: result.error });
  });

  // POST so the token never appears in a URL or access log.
  app.post('/invitations/preview', { config: { permission: 'session' } }, async (request, reply) => {
    const body = await parse(TokenBody, request, reply);
    if (body === undefined) return reply;
    const preview = await invitations.preview(body.token);
    return preview === undefined ? reply.code(404).send({ error: 'invalid_token' }) : reply.send(preview);
  });

  app.post('/invitations/accept', { config: { permission: 'session' } }, async (request, reply) => {
    const body = await parse(TokenBody, request, reply);
    if (body === undefined) return reply;
    const { userId, sessionId } = auth(request);
    const result = await invitations.accept(userId, body.token, requestContext(request));
    if (!result.ok) {
      const status = result.error === 'invalid_token' ? 404 : result.error === 'already_member' ? 409 : 403;
      return reply.code(status).send({ error: result.error });
    }
    // Joining switches into the organisation: a privilege change, so the session ID rotates.
    const rotated = await sessions.rotate(sessionId, { tenantId: result.tenantId });
    if (rotated !== undefined) reply.header('set-cookie', sessionCookie(rotated));
    return reply.send({ tenantId: result.tenantId });
  });
}
