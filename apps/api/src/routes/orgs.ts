// Account and organisation routes (S1.6, S1.7). The active organisation lives in the session.
import { auditLogs, withTenant, type Database } from '@dm/db';
import type { IdentityService, OrganisationService, SessionStore } from '@dm/core';
import { desc } from 'drizzle-orm';
import type { AppWithLogger } from '@dm/shared';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { sessionCookie } from '../http/cookies.ts';
import { auth, tenantAuth } from '../http/guards.ts';
import { parse, requestContext } from './auth.ts';

const CreateOrgBody = z.object({ name: z.string().max(200) });
const SelectOrgBody = z.object({ tenantId: z.uuid() });

export interface OrgRouteDeps {
  db: Database;
  identity: IdentityService;
  organisations: OrganisationService;
  sessions: SessionStore;
}

export function registerOrgRoutes<L extends FastifyBaseLogger>(app: AppWithLogger<L>, { db, identity, organisations, sessions }: OrgRouteDeps): void {
  app.get('/me', { config: { permission: 'session' } }, async (request, reply) => {
    const { userId, session } = auth(request);
    const user = await identity.getUser(userId);
    if (user === undefined) return reply.code(401).send({ error: 'unauthenticated' });
    return { user, organisations: await organisations.list(userId), currentTenantId: session.tenantId ?? null };
  });

  app.get('/orgs', { config: { permission: 'session' } }, async (request) => ({
    organisations: await organisations.list(auth(request).userId),
  }));

  app.post('/orgs', { config: { permission: 'session' } }, async (request, reply) => {
    const body = await parse(CreateOrgBody, request, reply);
    if (body === undefined) return reply;
    const { userId, sessionId } = auth(request);
    const result = await organisations.create(userId, body.name, requestContext(request));
    if (!result.ok) return reply.code(result.error === 'email_not_verified' ? 403 : 400).send({ error: result.error });
    // Switching into the new organisation is a privilege change: rotate the session ID.
    const rotated = await sessions.rotate(sessionId, { tenantId: result.tenantId });
    if (rotated !== undefined) reply.header('set-cookie', sessionCookie(rotated));
    return reply.code(201).send({ tenantId: result.tenantId, slug: result.slug });
  });

  app.post('/orgs/select', { config: { permission: 'session' } }, async (request, reply) => {
    const body = await parse(SelectOrgBody, request, reply);
    if (body === undefined) return reply;
    const { userId, sessionId } = auth(request);
    const memberships = await organisations.list(userId);
    // Not a member and does not exist look the same.
    if (!memberships.some((m) => m.tenantId === body.tenantId)) return reply.code(404).send({ error: 'not_found' });
    const rotated = await sessions.rotate(sessionId, { tenantId: body.tenantId });
    if (rotated === undefined) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.header('set-cookie', sessionCookie(rotated)).send({ currentTenantId: body.tenantId });
  });

  app.get('/orgs/current', { config: { permission: 'org:view' } }, async (request) => {
    const { tenantId, role } = tenantAuth(request);
    return { organisation: await organisations.get(tenantId), role };
  });

  // Minimal reader for the audit trail; the full viewer with filters is S2.8.
  app.get('/orgs/current/audit-log', { config: { permission: 'audit:view' } }, async (request) => {
    const { tenantId } = tenantAuth(request);
    const events = await withTenant(db, tenantId, (tx) =>
      tx.select({
        action: auditLogs.action, actorType: auditLogs.actorType, actorId: auditLogs.actorId,
        targetType: auditLogs.targetType, targetId: auditLogs.targetId, createdAt: auditLogs.createdAt,
      }).from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(50),
    );
    return { events };
  });
}
