// S1.8 RBAC: every route declares a permission (default deny), and every role is tested against
// every tenant route registered so far. Also cross-tenant and membership-removal checks (docs/02 §4.3).
import { randomUUID } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { can, localBreachedList, localKek, PERMISSIONS, TEST_ARGON2, type Permission, type Role } from '@dm/core';
import { createDatabase } from '@dm/db';
import { buildHttpService, createLogger } from '@dm/shared';
import type { RouteOptions } from 'fastify';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerApi } from '../src/app.ts';
import { Client, GOOD_PASSWORD, startStack, TERMS, tokenFrom, waitForEmail, type Stack } from './stack.ts';

const ROLES: Role[] = ['owner', 'admin', 'marketer', 'developer', 'viewer'];

/** Builds the API without connecting anywhere and returns every route it registers. */
async function registeredRoutes(): Promise<RouteOptions[]> {
  const routes: RouteOptions[] = [];
  const cache = new Redis({ lazyConnect: true });
  const app = await buildHttpService({
    service: 'routes', env: 'test', host: '127.0.0.1', port: 0, handleSignals: false, checks: [],
    logger: createLogger({ service: 'routes', env: 'test', level: 'silent' }),
    register: (a) => {
      a.addHook('onRoute', (route) => { routes.push(route); });
      registerApi(a, {
        db: createDatabase(new pg.Pool({ max: 1 })), cache, sendingMode: 'sink', mailpitUrl: 'http://127.0.0.1:1',
        mailFrom: { email: 'a@b.test', name: 'x' }, appUrl: 'http://app.test', breached: localBreachedList(), argon2: TEST_ARGON2,
        mfaKeks: [localKek('t', randomBytes(32))],
      });
    },
  });
  await app.ready();
  await app.close();
  cache.disconnect();
  return routes;
}

const permissionOf = (route: RouteOptions) => (route.config as { permission?: string } | undefined)?.permission;
const isTenantPermission = (p: string | undefined): p is Permission => p !== undefined && Object.hasOwn(PERMISSIONS, p);

describe('route declarations (S1.8 AC 2)', () => {
  it('every registered route declares a known permission', async () => {
    const routes = await registeredRoutes();
    expect(routes.length).toBeGreaterThan(10);
    const undeclared = routes.filter((r) => {
      const p = permissionOf(r);
      return !(p === 'public' || p === 'session' || isTenantPermission(p));
    });
    expect(undeclared.map((r) => `${String(r.method)} ${r.url}`)).toEqual([]);
  });

  // /health and /ready are registered by @dm/shared before this hook, with config.permission 'public';
  // the stack tests below reach them without a session.
  it('only the documented routes are public', async () => {
    const publicRoutes = (await registeredRoutes())
      .filter((r) => permissionOf(r) === 'public' && r.method !== 'HEAD')
      .map((r) => `${String(r.method)} ${r.url}`)
      .sort();
    expect(publicRoutes).toEqual([
      'POST /auth/login', 'POST /auth/login/mfa', 'POST /auth/password-reset/confirm', 'POST /auth/password-reset/request',
      'POST /auth/resend-verification', 'POST /auth/signup', 'POST /auth/verify-email',
    ]);
  });

  it('a route without a permission cannot even be registered (default deny)', async () => {
    await expect(buildHttpService({
      service: 'x', env: 'test', host: '127.0.0.1', port: 0, handleSignals: false, checks: [],
      logger: createLogger({ service: 'x', env: 'test', level: 'silent' }),
      register: (a) => {
        const cache = new Redis({ lazyConnect: true });
        registerApi(a, {
          db: createDatabase(new pg.Pool({ max: 1 })), cache, sendingMode: 'sink', mailpitUrl: 'http://127.0.0.1:1',
          mailFrom: { email: 'a@b.test', name: 'x' }, appUrl: 'http://app.test', breached: localBreachedList(),
          mfaKeks: [localKek('t', randomBytes(32))],
        });
        a.get('/oops', () => 'no permission declared');
        cache.disconnect();
      },
    })).rejects.toThrow('route GET /oops has no valid config.permission');
  });
});

describe('roles against tenant routes (S1.8 AC 3)', () => {
  let stack: Stack;
  let tenantId: string;
  const members = new Map<Role, Client>();

  beforeAll(async () => {
    stack = await startStack();
    let ip = 10;
    for (const role of ROLES) {
      const client = new Client(stack.app, `192.0.2.${String(ip++)}`);
      const email = `${role}@rbac.example.in`;
      await client.post('/auth/signup', { email, password: GOOD_PASSWORD, ...TERMS });
      await client.post('/auth/verify-email', { token: tokenFrom((await waitForEmail(stack.mailpitUrl, email, 'Confirm')).text) });
      await client.post('/auth/login', { email, password: GOOD_PASSWORD });
      members.set(role, client);
    }
    const owner = members.get('owner');
    tenantId = (await owner?.post('/orgs', { name: 'RBAC Org' }))?.json<{ tenantId: string }>().tenantId ?? '';
    // Add the other roles directly (invitations, S2.2, are tested in invitations.test.ts).
    for (const role of ROLES.filter((r) => r !== 'owner')) {
      await stack.pg.superuser.query(
        `insert into app.memberships (tenant_id, user_id, role) select $1, id, $2 from app.users where email_normalized = $3`,
        [tenantId, role, `${role}@rbac.example.in`],
      );
      expect((await members.get(role)?.post('/orgs/select', { tenantId }))?.statusCode).toBe(200);
    }
  });
  afterAll(async () => {
    await stack.stop();
  });

  it('each role gets exactly what the matrix allows on every tenant route', async () => {
    const tenantRoutes = (await registeredRoutes()).filter((r) => isTenantPermission(permissionOf(r)) && r.method !== 'HEAD');
    expect(tenantRoutes.length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const route of tenantRoutes) {
      const permission = permissionOf(route) as Permission;
      for (const role of ROLES) {
        const client = members.get(role);
        const response = await client?.request(route.method as 'GET' | 'POST', route.url, route.method === 'GET' ? undefined : {});
        const allowed = can(role, permission);
        const denied = response?.statusCode === 403;
        if (allowed === denied) mismatches.push(`${role} ${String(route.method)} ${route.url} → ${String(response?.statusCode)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('a member cannot select an organisation they do not belong to; unknown IDs look the same', async () => {
    const outsider = new Client(stack.app, '192.0.2.99');
    await outsider.post('/auth/signup', { email: 'outsider@rbac.example.in', password: GOOD_PASSWORD, ...TERMS });
    await outsider.post('/auth/verify-email', { token: tokenFrom((await waitForEmail(stack.mailpitUrl, 'outsider@rbac.example.in', 'Confirm')).text) });
    await outsider.post('/auth/login', { email: 'outsider@rbac.example.in', password: GOOD_PASSWORD });
    const foreign = await outsider.post('/orgs/select', { tenantId });
    const unknown = await outsider.post('/orgs/select', { tenantId: randomUUID() });
    expect([foreign.statusCode, foreign.json()]).toEqual([404, { error: 'not_found' }]);
    expect([unknown.statusCode, unknown.json()]).toEqual([404, { error: 'not_found' }]);
  });

  it('a removed member loses access on the next request', async () => {
    const viewer = members.get('viewer');
    expect((await viewer?.get('/orgs/current'))?.statusCode).toBe(200);
    await stack.pg.superuser.query(
      `delete from app.memberships where tenant_id = $1 and user_id = (select id from app.users where email_normalized = 'viewer@rbac.example.in')`,
      [tenantId],
    );
    const after = await viewer?.get('/orgs/current');
    expect([after?.statusCode, after?.json()]).toEqual([403, { error: 'not_a_member' }]);
  });

  it('health checks are reachable without a session', async () => {
    expect((await new Client(stack.app).get('/health')).statusCode).toBe(200);
    expect((await new Client(stack.app).get('/ready')).statusCode).toBe(200);
  });

  it('session routes need a session; tenant routes need a selected organisation', async () => {
    expect((await new Client(stack.app).get('/me')).statusCode).toBe(401);
    expect((await new Client(stack.app).get('/orgs/current')).statusCode).toBe(401);
    const fresh = new Client(stack.app, '192.0.2.120');
    await fresh.post('/auth/signup', { email: 'noorg@rbac.example.in', password: GOOD_PASSWORD, ...TERMS });
    await fresh.post('/auth/login', { email: 'noorg@rbac.example.in', password: GOOD_PASSWORD });
    expect((await fresh.get('/orgs/current')).json()).toEqual({ error: 'no_organisation_selected' });
  });

  it('the tenant audit log shows only this tenant\'s events', async () => {
    const owner = members.get('owner');
    const { events } = (await owner?.get('/orgs/current/audit-log'))?.json<{ events: { action: string }[] }>() ?? { events: [] };
    expect(events.map((e) => e.action)).toEqual(['org.created']);
  });
});
