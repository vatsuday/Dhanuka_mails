import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withTenant, type Database } from '../src/database.ts';
import { contacts, memberships, tenants } from '../src/schema.ts';
import { startTestDatabase, type TestDatabase } from './postgres.ts';

let db: TestDatabase;
/** One connection, so every test reuses the connection earlier withTenant calls ran on. */
let appPool: pg.Pool;
let app: Database;
const tenantA = randomUUID();
const tenantB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();

/** The failing query's Postgres error (drizzle wraps it in `cause`). */
async function pgError(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    return cause as { code?: string; message: string };
  }
  throw new Error('expected the query to fail');
}

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = db.pool('app_user', 1);
  app = createDatabase(appPool);
  // Users are global and the runtime role cannot insert them yet (sign-up arrives in Sprint 1).
  await db.superuser.query(
    `insert into app.users (id, email, email_normalized, password_hash)
     values ($1, 'a@example.in', 'a@example.in', 'x'), ($2, 'b@example.in', 'b@example.in', 'x')`,
    [userA, userB],
  );
  // Tenants are created through RLS: the WITH CHECK policy only accepts the current tenant's own row.
  for (const [tenantId, userId, name] of [[tenantA, userA, 'A'], [tenantB, userB, 'B']] as const) {
    await withTenant(app, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `Tenant ${name}`, slug: `tenant-${name.toLowerCase()}` });
      await tx.insert(memberships).values({ tenantId, userId, role: 'owner' });
      await tx.insert(contacts).values({ tenantId, email: `c@${name}.in`, emailNormalized: `c@${name.toLowerCase()}.in` });
    });
  }
});
afterAll(async () => {
  await db.stop();
});

describe('forced row-level security (S0.4 AC 1)', () => {
  it('every tenant table has RLS enabled and forced, with a policy', async () => {
    const { rows } = await db.superuser.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind in ('r', 'p') and c.relname in ('tenants', 'memberships', 'contacts')
        order by c.relname`,
    );
    expect(rows).toEqual(
      ['contacts', 'memberships', 'tenants'].map((relname) => ({
        relname, relrowsecurity: true, relforcerowsecurity: true, policies: 1,
      })),
    );
  });

  it('even the table owner sees no rows without a tenant, because RLS is forced', async () => {
    const migrator = db.pool('app_migrator', 1);
    const { rows } = await migrator.query('select count(*)::int as n from app.contacts');
    expect(rows).toEqual([{ n: 0 }]);
  });
});

describe('withTenant (S0.4 AC 3)', () => {
  it('sees only the current tenant\'s rows', async () => {
    const seen = await withTenant(app, tenantA, async (tx) => ({
      tenants: await tx.select({ id: tenants.id }).from(tenants),
      contacts: await tx.select({ tenantId: contacts.tenantId }).from(contacts),
      memberships: await tx.select({ tenantId: memberships.tenantId }).from(memberships),
    }));
    expect(seen).toEqual({
      tenants: [{ id: tenantA }],
      contacts: [{ tenantId: tenantA }],
      memberships: [{ tenantId: tenantA }],
    });
  });

  it('sets the tenant transaction-locally, so it is gone once the transaction ends', async () => {
    const inside = await withTenant(app, tenantA, (tx) =>
      tx.execute<{ t: string }>(sql`select current_setting('app.tenant_id', true) as t`),
    );
    expect(inside.rows).toEqual([{ t: tenantA }]);
    // Same single pooled connection: the setting must not have survived.
    const { rows } = await appPool.query(`select current_setting('app.tenant_id', true) as t`);
    expect(rows).toEqual([{ t: '' }]);
  });

  it('cannot read or write another tenant\'s rows by naming its ID', async () => {
    await withTenant(app, tenantA, async (tx) => {
      expect(await tx.select().from(contacts).where(eq(contacts.tenantId, tenantB))).toEqual([]);
      const updated = await tx.update(contacts).set({ firstName: 'x' }).where(eq(contacts.tenantId, tenantB)).returning();
      expect(updated).toEqual([]);
      const deleted = await tx.delete(contacts).where(eq(contacts.tenantId, tenantB)).returning();
      expect(deleted).toEqual([]);
    });
    const { rows } = await db.superuser.query('select first_name from app.contacts where tenant_id = $1', [tenantB]);
    expect(rows).toEqual([{ first_name: null }]);
  });

  it('rejects inserting a row with another tenant\'s ID', async () => {
    const error = await pgError(
      withTenant(app, tenantA, (tx) => tx.insert(contacts).values({ tenantId: tenantB, emailNormalized: 'spoof@b.in' })),
    );
    expect(error.code).toBe('42501');
    expect(error.message).toMatch(/row-level security policy/);
  });

  it('rejects a tenant ID that is not a UUID before touching the database', async () => {
    await expect(withTenant(app, "x' or true --", () => Promise.resolve())).rejects.toThrow(TypeError);
  });

  it('rolls back everything when the callback throws', async () => {
    await expect(
      withTenant(app, tenantA, async (tx) => {
        await tx.insert(contacts).values({ tenantId: tenantA, emailNormalized: 'rollback@a.in' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rows } = await db.superuser.query(`select count(*)::int as n from app.contacts where email_normalized = 'rollback@a.in'`);
    expect(rows).toEqual([{ n: 0 }]);
  });
});

describe('outside withTenant (S0.4 AC 4)', () => {
  it('a fresh connection sees zero rows in every tenant table', async () => {
    const fresh = db.pool('app_user', 1);
    for (const table of ['tenants', 'memberships', 'contacts']) {
      const { rows } = await fresh.query(`select count(*)::int as n from app.${table}`);
      expect(rows).toEqual([{ n: 0 }]);
    }
  });

  it('a pooled connection that ran withTenant before also sees zero rows (not an error)', async () => {
    await withTenant(app, tenantA, (tx) => tx.select().from(contacts));
    for (const table of ['tenants', 'memberships', 'contacts']) {
      const { rows } = await appPool.query(`select count(*)::int as n from app.${table}`);
      expect(rows).toEqual([{ n: 0 }]);
    }
  });

  it('cannot insert without a tenant', async () => {
    const error = await pgError(appPool.query(`insert into app.contacts (tenant_id, email_normalized) values ($1, 'x@a.in')`, [tenantA]));
    expect(error.code).toBe('42501');
  });
});

describe('grants (docs/04 §2)', () => {
  it('app_user cannot delete tenants or users', async () => {
    expect((await pgError(withTenant(app, tenantA, (tx) => tx.delete(tenants)))).message).toMatch(/permission denied for table tenants/);
    // Sign-up (S1.1) needs INSERT on users; deleting users is never allowed to the runtime role.
    expect((await pgError(appPool.query('delete from app.users'))).message).toMatch(/permission denied for table users/);
  });

  it('admin_user has no direct access to tenant tables', async () => {
    const admin = db.pool('admin_user', 1);
    expect((await pgError(admin.query('select * from app.contacts'))).message).toMatch(/permission denied for table contacts/);
  });

  it('nobody but app_migrator can read the migrations ledger', async () => {
    expect((await pgError(appPool.query('select * from app.__drizzle_migrations'))).message).toMatch(/permission denied/);
  });
});

describe('at least one owner per tenant (docs/04 §5.1)', () => {
  it('rejects removing or demoting the last owner', async () => {
    const del = await pgError(withTenant(app, tenantA, (tx) => tx.delete(memberships).where(eq(memberships.userId, userA))));
    expect(del.code).toBe('23514');
    const demote = await pgError(
      withTenant(app, tenantA, (tx) => tx.update(memberships).set({ role: 'admin' }).where(eq(memberships.userId, userA))),
    );
    expect(demote.code).toBe('23514');
  });

  it('allows transferring ownership within one transaction', async () => {
    await withTenant(app, tenantA, async (tx) => {
      await tx.insert(memberships).values({ tenantId: tenantA, userId: userB, role: 'admin' });
      await tx.update(memberships).set({ role: 'admin' }).where(eq(memberships.userId, userA));
      await tx.update(memberships).set({ role: 'owner' }).where(eq(memberships.userId, userB));
    });
    const { rows } = await db.superuser.query(
      `select u.email, m.role from app.memberships m join app.users u on u.id = m.user_id where m.tenant_id = $1 order by u.email`,
      [tenantA],
    );
    expect(rows).toEqual([{ email: 'a@example.in', role: 'admin' }, { email: 'b@example.in', role: 'owner' }]);
  });
});
