// Catalog tests (S0.5 AC 2-4). The second block proves each detector fails on a deliberately broken
// object, so a passing first block means something; those objects live only in a rolled-back transaction.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRlsViolations, findSecurityDefinerViolations, tenantTables } from './catalog.ts';
import { startTestDatabase, type TestDatabase } from './postgres.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});
afterAll(async () => {
  await db.stop();
});

describe('catalog after all migrations', () => {
  it('finds the tenant tables', async () => {
    expect(await tenantTables(db.superuser)).toEqual(['app.contacts', 'app.memberships', 'app.tenants']);
  });

  it('every tenant table has forced row-level security with a policy', async () => {
    expect(await findRlsViolations(db.superuser)).toEqual([]);
  });

  it('every SECURITY DEFINER function pins search_path and is not executable by PUBLIC', async () => {
    expect(await findSecurityDefinerViolations(db.superuser)).toEqual([]);
  });
});

describe('the detectors catch deliberately broken objects', () => {
  /** Runs `setup` as the superuser, returns what `detect` reports, and rolls everything back. */
  async function detectIn(setup: string, detect: (client: pg.PoolClient) => Promise<string[]>) {
    const client = await db.superuser.connect();
    try {
      await client.query('begin');
      await client.query(setup);
      return await detect(client);
    } finally {
      await client.query('rollback');
      client.release();
    }
  }

  it('a tenant table without RLS', async () => {
    const found = await detectIn('create table app.broken (id int, tenant_id uuid)', findRlsViolations);
    expect(found).toEqual([
      'app.broken: row-level security is not enabled',
      'app.broken: row-level security is not forced',
      'app.broken: has no policy',
    ]);
  });

  it('a tenant table in another schema with RLS enabled but not forced', async () => {
    const found = await detectIn(
      `create schema other; create table other.t (tenant_id uuid);
       alter table other.t enable row level security; create policy p on other.t using (true)`,
      findRlsViolations,
    );
    expect(found).toEqual(['other.t: row-level security is not forced']);
  });

  it('a SECURITY DEFINER function with no pinned search_path and default PUBLIC execute', async () => {
    const found = await detectIn(
      `create function app.leaky() returns int language sql security definer as 'select 1'`,
      findSecurityDefinerViolations,
    );
    expect(found).toEqual([
      'app.leaky(): search_path is not pinned to "pg_catalog, pg_temp"',
      'app.leaky(): PUBLIC can execute it',
    ]);
  });

  it('a SECURITY DEFINER function that pins a search_path including public', async () => {
    const found = await detectIn(
      `create function app.f() returns int language sql security definer set search_path = public, pg_temp as 'select 1';
       revoke all on function app.f() from public`,
      findSecurityDefinerViolations,
    );
    expect(found).toEqual(['app.f(): search_path is not pinned to "pg_catalog, pg_temp"']);
  });

  it('a compliant SECURITY DEFINER function passes', async () => {
    const found = await detectIn(
      `create function app.ok() returns int language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
       revoke all on function app.ok() from public`,
      findSecurityDefinerViolations,
    );
    expect(found).toEqual([]);
  });
});
