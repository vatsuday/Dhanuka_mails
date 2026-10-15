// Reusable tenant-isolation suite (S0.5 AC 1). Runs the same attacks against every table in
// TENANT_TABLES, as the runtime role, through withTenant. Adding a table to the registry is enough.
import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withTenant, type Database } from '../src/database.ts';
import { tenantTables } from './catalog.ts';
import { startTestDatabase, type TestDatabase } from './postgres.ts';
import { TENANT_TABLES, type IsolationFixtures, type TenantTable } from './tenant-tables.ts';

let db: TestDatabase;
/** A single connection, so every check also runs on a connection that earlier withTenant calls used. */
let appPool: pg.Pool;
let app: Database;
const tenantA = randomUUID();
const tenantB = randomUUID();

const fx: IsolationFixtures = {
  unique: () => randomUUID(),
  newUser: async () => {
    const email = `${randomUUID()}@example.in`;
    const { rows } = await db.superuser.query<{ id: string }>(
      `insert into app.users (email, email_normalized, password_hash) values ($1, $1, 'x') returning id`,
      [email],
    );
    return rows[0]?.id ?? '';
  },
};

const ident = (name: string): SQL => {
  const [schema = '', table = ''] = name.split('.');
  return sql`${sql.identifier(schema)}.${sql.identifier(table)}`;
};
const insert = (table: string, row: Record<string, unknown>): SQL =>
  sql`insert into ${ident(table)} (${sql.join(Object.keys(row).map((k) => sql.identifier(k)), sql`, `)})
      values (${sql.join(Object.values(row).map((v) => sql`${v}`), sql`, `)})`;

/** Postgres SQLSTATE of a failed call (drizzle wraps the driver error in `cause`). */
async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
}

/** Rows affected by a write, or 'denied' when the role lacks the privilege. Both mean "blocked" unless > 0. */
async function affected(tenantId: string, statement: SQL): Promise<number | 'denied'> {
  try {
    const result = await withTenant(app, tenantId, (tx) => tx.execute(statement));
    return result.rowCount ?? 0;
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '42501') return 'denied';
    throw error;
  }
}

async function countAs(table: TenantTable, tenantId: string): Promise<number> {
  const { rows } = await db.superuser.query<{ n: number }>(
    `select count(*)::int as n from ${table.name} where ${table.tenantColumn} = $1`,
    [tenantId],
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = db.pool('app_user', 1);
  app = createDatabase(appPool);
  for (const table of TENANT_TABLES) {
    for (const tenantId of [tenantA, tenantB]) {
      const row = await table.row(tenantId, fx);
      await withTenant(app, tenantId, (tx) => tx.execute(insert(table.name, row)));
    }
  }
});
afterAll(async () => {
  await db.stop();
});

it('the registry covers every tenant table in the database', async () => {
  expect(TENANT_TABLES.map((t) => t.name).sort()).toEqual(await tenantTables(db.superuser));
});

describe.each(TENANT_TABLES)('$name', (table) => {
  const col = sql.identifier(table.tenantColumn);

  it('a tenant sees only its own rows', async () => {
    const result = await withTenant(app, tenantA, (tx) =>
      tx.execute<{ t: string }>(sql`select ${col}::text as t from ${ident(table.name)}`),
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(new Set(result.rows.map((r) => r.t))).toEqual(new Set([tenantA]));
  });

  it('cannot SELECT another tenant\'s rows by naming its ID', async () => {
    const result = await withTenant(app, tenantA, (tx) =>
      tx.execute(sql`select 1 from ${ident(table.name)} where ${col} = ${tenantB}`),
    );
    expect(result.rows).toEqual([]);
  });

  it('cannot UPDATE or DELETE another tenant\'s rows', async () => {
    const before = await countAs(table, tenantB);
    const update = await affected(tenantA, sql`update ${ident(table.name)} set ${col} = ${col} where ${col} = ${tenantB}`);
    const del = await affected(tenantA, sql`delete from ${ident(table.name)} where ${col} = ${tenantB}`);
    expect([update, del].every((n) => n === 0 || n === 'denied')).toBe(true);
    expect(await countAs(table, tenantB)).toBe(before);
  });

  it('rejects an INSERT with a spoofed tenant', async () => {
    const row = await table.row(tenantB, fx);
    expect(await sqlState(withTenant(app, tenantA, (tx) => tx.execute(insert(table.name, row))))).toBe('42501');
  });

  it('rejects moving its own row to another tenant', async () => {
    const state = await sqlState(
      withTenant(app, tenantA, (tx) =>
        tx.execute(sql`update ${ident(table.name)} set ${col} = ${tenantB} where ${col} = ${tenantA}`),
      ),
    );
    expect(state).toBe('42501');
  });

  it('with no tenant set, sees zero rows and cannot insert', async () => {
    const { rows } = await appPool.query<{ n: number }>(`select count(*)::int as n from ${table.name}`);
    expect(rows).toEqual([{ n: 0 }]);
    const row = await table.row(tenantA, fx);
    expect(await sqlState(app.execute(insert(table.name, row)))).toBe('42501');
  });
});
