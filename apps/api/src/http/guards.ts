// Request guards: CSRF origin check (S1.2 AC 5) and route permissions (S1.8, default deny).
import { can, PERMISSIONS, SESSION_COOKIE, type OrganisationService, type Permission, type Role, type Session, type SessionStore } from '@dm/core';
import type { AppWithLogger } from '@dm/shared';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { readCookie } from './cookies.ts';

export interface Auth {
  sessionId: string;
  session: Session;
  userId: string;
  /** Present on tenant routes, after the membership check. */
  tenantId?: string;
  role?: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: Auth;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isPermission = (value: string): value is Permission => Object.hasOwn(PERMISSIONS, value);

/** `public`, `session`, or a tenant permission. Anything else is a programming error. */
export function isKnownRouteAccess(value: string | undefined): boolean {
  return value === 'public' || value === 'session' || (value !== undefined && isPermission(value));
}

/** Throws at registration if a route doesn't declare a known permission, so it can never be served. */
export function enforceRouteDeclarations<L extends FastifyBaseLogger>(app: AppWithLogger<L>): void {
  app.addHook('onRoute', (route) => {
    const permission = (route.config as { permission?: string } | undefined)?.permission;
    if (!isKnownRouteAccess(permission)) {
      throw new Error(`route ${String(route.method)} ${route.url} has no valid config.permission (got ${String(permission)})`);
    }
  });
}

/**
 * State-changing requests must come from our own web origin: Origin, or else Referer, must match
 * exactly. Missing both is rejected too. SameSite=Lax is the first layer; this is the second.
 */
export function registerOriginCheck<L extends FastifyBaseLogger>(app: AppWithLogger<L>, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins);
  app.addHook('onRequest', async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    let origin = request.headers.origin;
    if (origin === undefined && request.headers.referer !== undefined) {
      try {
        origin = new URL(request.headers.referer).origin;
      } catch {
        origin = undefined;
      }
    }
    if (origin === undefined || !allowed.has(origin)) {
      request.log.warn({ origin: origin ?? null }, 'rejected cross-origin or origin-less state change');
      await reply.code(403).send({ error: 'bad_origin' });
    }
  });
}

/** Resolves the session and enforces the route's permission before any handler runs. */
export function registerAccessControl<L extends FastifyBaseLogger>(
  app: AppWithLogger<L>,
  sessions: SessionStore,
  organisations: OrganisationService,
): void {
  app.addHook('preHandler', async (request, reply) => {
    const permission = request.routeOptions.config.permission;
    if (permission === 'public') return;
    if (!isKnownRouteAccess(permission)) return reply.code(403).send({ error: 'forbidden' });

    const sessionId = readCookie(request.headers.cookie, SESSION_COOKIE);
    const session = sessionId === undefined ? undefined : await sessions.get(sessionId);
    if (sessionId === undefined || session === undefined) return reply.code(401).send({ error: 'unauthenticated' });
    request.auth = { sessionId, session, userId: session.userId };
    if (permission === 'session') return;

    // Tenant route: the tenant comes from the session, never the request, and membership is re-checked
    // on every request so a removed member loses access immediately.
    if (session.tenantId === undefined) return reply.code(409).send({ error: 'no_organisation_selected' });
    const access = await organisations.access(session.tenantId, session.userId);
    if (access === undefined) return reply.code(403).send({ error: 'not_a_member' });
    // S2.1 AC 5: an organisation that requires MFA is closed to members without it.
    if (access.requireMfa && !access.userMfaEnabled) return reply.code(403).send({ error: 'mfa_required' });
    if (!can(access.role, permission as Permission)) return reply.code(403).send({ error: 'forbidden' });
    request.auth = { ...request.auth, tenantId: session.tenantId, role: access.role };
  });
}

/** For handlers on non-public routes: the hook guarantees auth is set. */
export function auth(request: FastifyRequest): Auth {
  if (request.auth === undefined) throw new Error('auth missing: route is public or the hook did not run');
  return request.auth;
}

export function tenantAuth(request: FastifyRequest): Auth & { tenantId: string; role: Role } {
  const a = auth(request);
  if (a.tenantId === undefined || a.role === undefined) throw new Error('tenant auth missing: route is not tenant-scoped');
  return { ...a, tenantId: a.tenantId, role: a.role };
}
