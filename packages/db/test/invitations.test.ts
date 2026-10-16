// S2.2 database objects: app.lookup_invitation answers only for pending, unexpired invitations and
// returns only the documented columns; the role and token constraints hold.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withTenant, type Database } from '../src/database.ts';
import { invitations, memberships, tenants } from '../src/schema.ts';
import { startTestDatabase, type TestDatabase } from './postgres.ts';

let db: TestDatabase;
let appPool: pg.Pool;
let app: Database;
const owner = randomUUID();
const tenantId = randomUUID();

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
  }
}

/** Creates an invitation and returns its raw token's hash. */
async function invite(email: string, overrides: Partial<typeof invitations.$inferInsert> = {}): Promise<Buffer> {
  const tokenHash = createHash('sha256').update(randomBytes(32)).digest();
  await withTenant(app, tenantId, (tx) =>
    tx.insert(invitations).values({
      tenantId, emailNormalized: email, role: 'marketer', tokenHash, invitedBy: owner,
      expiresAt: new Date(Date.now() + 7 * 86_400_000), ...overrides,
    }),
  );
  return tokenHash;
}

const lookup = async (hash: Buffer) =>
  (await app.execute(sql`select * from app.lookup_invitation(${hash})`)).rows;

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = db.pool('app_user', 1);
  app = createDatabase(appPool);
  await db.superuser.query(`insert into app.users (id, email, email_normalized, password_hash) values ($1, 'o@example.in', 'o@example.in', 'x')`, [owner]);
  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: 'Invite Co', slug: `s-${tenantId}` });
    await tx.insert(memberships).values({ tenantId, userId: owner, role: 'owner' });
  });
});
afterAll(async () => {
  await db.stop();
});

describe('app.lookup_invitation (S2.2 AC 2)', () => {
  it('returns the documented summary for a pending invitation, without any tenant set', async () => {
    const hash = await invite('new@example.in');
    const rows = await lookup(hash);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['email', 'expires_at', 'invitation_id', 'role', 'tenant_id', 'tenant_name']);
    expect(rows[0]).toMatchObject({ tenant_id: tenantId, tenant_name: 'Invite Co', email: 'new@example.in', role: 'marketer' });
  });

  it('returns nothing for an unknown, expired, revoked or accepted invitation', async () => {
    expect(await lookup(randomBytes(32))).toEqual([]);
    expect(await lookup(await invite('expired@example.in', { expiresAt: new Date(Date.now() - 1000) }))).toEqual([]);
    expect(await lookup(await invite('revoked@example.in', { revokedAt: new Date() }))).toEqual([]);
    expect(await lookup(await invite('accepted@example.in', { acceptedAt: new Date(), acceptedBy: owner }))).toEqual([]);
  });

  it('without the function, app_user sees no invitations outside a tenant', async () => {
    await invite('hidden@example.in');
    expect((await appPool.query('select count(*)::int as n from app.invitations')).rows[0]).toEqual({ n: 0 });
  });

  it('is SECURITY DEFINER, owned by rls_lookup, and not executable by PUBLIC', async () => {
    const { rows } = await db.superuser.query(
      `select p.prosecdef, pg_get_userbyid(p.proowner) as owner,
              has_function_privilege('app_user', p.oid, 'execute') as app_user,
              has_function_privilege('admin_user', p.oid, 'execute') as admin_user
         from pg_proc p where p.proname = 'lookup_invitation'`,
    );
    expect(rows).toEqual([{ prosecdef: true, owner: 'rls_lookup', app_user: true, admin_user: false }]);
  });
});

describe('invitation constraints', () => {
  it('cannot grant owner, and the token hash must be 32 bytes', async () => {
    expect(await sqlState(withTenant(app, tenantId, (tx) => tx.execute(
      sql`insert into app.invitations (tenant_id, email_normalized, role, token_hash, invited_by, expires_at)
          values (${tenantId}, 'x@example.in', 'owner', ${randomBytes(32)}, ${owner}, now() + interval '1 day')`,
    )))).toBe('23514');
    expect(await sqlState(invite('short@example.in', { tokenHash: randomBytes(16) }))).toBe('23514');
  });

  it('allows one pending invitation per email; a revoked one does not block a new one', async () => {
    await invite('dup@example.in');
    expect(await sqlState(invite('dup@example.in'))).toBe('23505');
    await withTenant(app, tenantId, (tx) => tx.execute(sql`update app.invitations set revoked_at = now() where email_normalized = 'dup@example.in'`));
    expect(await sqlState(invite('dup@example.in'))).toBeUndefined();
  });

  it('app_user cannot delete invitations', async () => {
    expect(await sqlState(withTenant(app, tenantId, (tx) => tx.execute(sql`delete from app.invitations`)))).toBe('42501');
  });
});
