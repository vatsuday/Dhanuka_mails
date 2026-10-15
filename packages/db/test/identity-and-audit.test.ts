// Sprint 1 database objects: append-only audit log (S1.9 AC 1) and list_user_memberships (S1.7 AC 2),
// plus the grants the identity module relies on.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs } from '../src/audit-schema.ts';
import { createDatabase, withTenant, withUser, type Database } from '../src/database.ts';
import { memberships, tenants } from '../src/schema.ts';
import { startTestDatabase, type TestDatabase } from './postgres.ts';

let db: TestDatabase;
let appPool: pg.Pool;
let app: Database;
const userA = randomUUID();
const userB = randomUUID();
const tenant1 = randomUUID();
const tenant2 = randomUUID();
const tenantOfB = randomUUID();

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = db.pool('app_user', 1);
  app = createDatabase(appPool);
  await db.superuser.query(
    `insert into app.users (id, email, email_normalized, password_hash) values
       ($1, 'a@example.in', 'a@example.in', 'x'), ($2, 'b@example.in', 'b@example.in', 'x')`,
    [userA, userB],
  );
  for (const [tenantId, userId, name, role] of [
    [tenant1, userA, 'Zeta', 'owner'],
    [tenant2, userA, 'Alpha', 'owner'],
    [tenantOfB, userB, 'B Corp', 'owner'],
  ] as const) {
    await withTenant(app, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name, slug: `s-${tenantId}` });
      await tx.insert(memberships).values({ tenantId, userId, role });
    });
  }
  // userB is also a viewer in tenant1 (ownership checks need an owner first).
  await withTenant(app, tenant1, (tx) => tx.insert(memberships).values({ tenantId: tenant1, userId: userB, role: 'viewer' }));
});
afterAll(async () => {
  await db.stop();
});

describe('audit_logs is append-only (S1.9 AC 1)', () => {
  it('app_user can append tenant and tenant-less rows', async () => {
    await withTenant(app, tenant1, (tx) =>
      tx.insert(auditLogs).values({ id: randomUUID(), tenantId: tenant1, actorType: 'user', actorId: userA, action: 'org.created', metadata: {}, createdAt: new Date() }),
    );
    await app.insert(auditLogs).values({
      id: randomUUID(), tenantId: null, actorType: 'user', actorId: userA, action: 'auth.login_succeeded',
      metadata: {}, ip: '203.0.113.7', userAgent: 'test', createdAt: new Date(),
    });
    const { rows } = await db.superuser.query(`select action from app.audit_logs order by created_at`);
    expect(rows).toEqual([{ action: 'org.created' }, { action: 'auth.login_succeeded' }]);
  });

  it('app_user cannot UPDATE or DELETE audit rows, with or without a tenant', async () => {
    expect(await sqlState(withTenant(app, tenant1, (tx) => tx.execute(sql`update app.audit_logs set action = 'x.y'`)))).toBe('42501');
    expect(await sqlState(withTenant(app, tenant1, (tx) => tx.execute(sql`delete from app.audit_logs`)))).toBe('42501');
    expect(await sqlState(appPool.query(`delete from app.audit_logs where tenant_id is null`))).toBe('42501');
    expect(await sqlState(appPool.query(`truncate app.audit_logs`))).toBe('42501');
  });

  it('admin_user cannot UPDATE or DELETE audit rows either', async () => {
    const admin = db.pool('admin_user', 1);
    expect(await sqlState(admin.query(`update app.audit_logs set action = 'x.y'`))).toBe('42501');
    expect(await sqlState(admin.query(`delete from app.audit_logs`))).toBe('42501');
  });

  it('partitions cannot be reached directly', async () => {
    expect(await sqlState(appPool.query(`select * from app.audit_logs_default`))).toBe('42501');
    expect(await sqlState(appPool.query(`insert into app.audit_logs_2026_10 (actor_type, action) values ('system', 'x.y')`))).toBe('42501');
  });

  it('tenant-less rows are never visible to tenants', async () => {
    const rows = await withTenant(app, tenant1, (tx) => tx.select({ action: auditLogs.action }).from(auditLogs));
    expect(rows).toEqual([{ action: 'org.created' }]);
  });

  it('rejects malformed action names', async () => {
    expect(await sqlState(appPool.query(`insert into app.audit_logs (actor_type, action) values ('system', 'Drop Table')`))).toBe('23514');
  });
});

interface MembershipRow extends Record<string, unknown> { tenant_id: string; tenant_name: string; role: string; tenant_status: string }
/** Calls the function for `userId` inside withUser(`boundUser`), or with no user bound when boundUser is null. */
const listMemberships = async (userId: string, boundUser: string | null = userId): Promise<MembershipRow[]> => {
  const query = sql`select * from app.list_user_memberships(${userId})`;
  const result = boundUser === null
    ? await app.execute<MembershipRow>(query)
    : await withUser(app, boundUser, (tx) => tx.execute<MembershipRow>(query));
  return result.rows;
};

describe('app.list_user_memberships (S1.7)', () => {
  it('returns the bound user\'s organisations with exactly the documented columns, ordered by name', async () => {
    expect(await listMemberships(userA)).toEqual([
      { tenant_id: tenant2, tenant_name: 'Alpha', role: 'owner', tenant_status: 'pending_review' },
      { tenant_id: tenant1, tenant_name: 'Zeta', role: 'owner', tenant_status: 'pending_review' },
    ]);
  });

  it('never returns other users\' memberships', async () => {
    const rows = await listMemberships(userB);
    expect(rows.map((r) => [r.tenant_name, r.role])).toEqual([['B Corp', 'owner'], ['Zeta', 'viewer']]);
  });

  it('returns nothing when asked about a user other than the bound one, or with no user bound', async () => {
    expect(await listMemberships(userB, userA)).toEqual([]);
    expect(await listMemberships(userA, null)).toEqual([]);
  });

  it('is owned by rls_lookup, pins search_path, and only app_user may execute it', async () => {
    const { rows } = await db.superuser.query(
      `select pg_get_userbyid(proowner) as owner, prosecdef, proconfig,
              has_function_privilege('app_user', oid, 'execute') as app_user,
              has_function_privilege('admin_user', oid, 'execute') as admin_user
         from pg_proc where proname = 'list_user_memberships'`,
    );
    expect(rows).toEqual([{
      owner: 'rls_lookup', prosecdef: true, proconfig: ['search_path=pg_catalog, pg_temp'], app_user: true, admin_user: false,
    }]);
  });

  it('PUBLIC cannot execute it', async () => {
    const { rows } = await db.superuser.query(
      `select exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                       where p.proname = 'list_user_memberships' and a.grantee = 0) as public_grant`,
    );
    expect(rows).toEqual([{ public_grant: false }]);
  });
});

describe('identity grants', () => {
  it('app_user can create users and tokens but cannot delete users or tokens', async () => {
    const userId = randomUUID();
    await appPool.query(`insert into app.users (id, email, email_normalized, password_hash) values ($1, 'n@e.in', 'n@e.in', 'h')`, [userId]);
    await appPool.query(
      `insert into app.user_tokens (user_id, purpose, token_hash, expires_at) values ($1, 'verify_email', $2, now() + interval '1 day')`,
      [userId, Buffer.alloc(32, 1)],
    );
    expect(await sqlState(appPool.query(`delete from app.user_tokens`))).toBe('42501');
    expect(await sqlState(appPool.query(`delete from app.users where id = $1`, [userId]))).toBe('42501');
  });

  it('token hashes must be exactly 32 bytes', async () => {
    expect(await sqlState(appPool.query(
      `insert into app.user_tokens (user_id, purpose, token_hash, expires_at) values ($1, 'verify_email', $2, now())`,
      [userA, Buffer.alloc(16)],
    ))).toBe('23514');
  });

  it('tenants can read but not change their sending policy', async () => {
    await withTenant(app, tenant1, (tx) => tx.execute(sql`insert into app.tenant_sending_policies (tenant_id) values (${tenant1})`));
    const { rows } = await withTenant(app, tenant1, (tx) => tx.execute(sql`select tier, send_mode, daily_limit, hourly_limit, max_contacts from app.tenant_sending_policies`));
    expect(rows).toEqual([{ tier: 'sandbox', send_mode: 'sandbox', daily_limit: 50, hourly_limit: 20, max_contacts: 1000 }]);
    expect(await sqlState(withTenant(app, tenant1, (tx) => tx.execute(sql`update app.tenant_sending_policies set send_mode = 'live'`)))).toBe('42501');
  });
});
