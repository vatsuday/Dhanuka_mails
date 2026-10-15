import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '../src/bootstrap.ts';
import { startTestDatabase, type TestDatabase } from './postgres.ts';

let db: TestDatabase;
let appUser: pg.Pool;

beforeAll(async () => {
  db = await startTestDatabase();
  appUser = db.pool('app_user');
});
afterAll(async () => {
  await db.stop();
});

const RUNTIME_ROLES = ['app_user', 'admin_user'];

describe('roles (docs/04 §2, S0.4 AC 2)', () => {
  it('runtime roles can log in but are not superuser and do not bypass RLS', async () => {
    const { rows } = await db.superuser.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
      `select rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb
         from pg_roles where rolname = any($1) order by rolname`,
      [[...RUNTIME_ROLES, 'app_migrator']],
    );
    expect(rows).toEqual(
      ['admin_user', 'app_migrator', 'app_user'].map((rolname) => ({
        rolname, rolsuper: false, rolbypassrls: false, rolcanlogin: true, rolcreaterole: false, rolcreatedb: false,
      })),
    );
  });

  it('function-owner roles bypass RLS but cannot log in', async () => {
    const { rows } = await db.superuser.query(
      `select rolname, rolbypassrls, rolcanlogin, rolsuper from pg_roles
        where rolname in ('rls_lookup', 'app_admin_fn') order by rolname`,
    );
    expect(rows).toEqual([
      { rolname: 'app_admin_fn', rolbypassrls: true, rolcanlogin: false, rolsuper: false },
      { rolname: 'rls_lookup', rolbypassrls: true, rolcanlogin: false, rolsuper: false },
    ]);
  });

  it('runtime roles own no schema, table, sequence, view or function', async () => {
    const { rows } = await db.superuser.query(
      `select 'schema' as kind, nspname as name from pg_namespace where nspowner = any(select oid from pg_roles where rolname = any($1))
       union all
       select 'relation', relname from pg_class where relowner = any(select oid from pg_roles where rolname = any($1))
       union all
       select 'function', proname from pg_proc where proowner = any(select oid from pg_roles where rolname = any($1))`,
      [RUNTIME_ROLES],
    );
    expect(rows).toEqual([]);
  });

  it('runtime roles are members of no other role (so they cannot inherit BYPASSRLS or ownership)', async () => {
    const { rows } = await db.superuser.query(
      `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = any($1)`,
      [RUNTIME_ROLES],
    );
    expect(rows).toEqual([]);
  });

  it('app_migrator owns the app schema and every table in it', async () => {
    const { rows } = await db.superuser.query(
      `select distinct pg_get_userbyid(owner) as owner from (
         select nspowner as owner from pg_namespace where nspname = 'app'
         union all
         select c.relowner from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app'
       ) o`,
    );
    expect(rows).toEqual([{ owner: 'app_migrator' }]);
  });

  it('app_migrator cannot inherit the privileges of the function-owner roles', async () => {
    const { rows } = await db.superuser.query(
      `select g.rolname as granted, m.inherit_option, m.set_option from pg_auth_members m
         join pg_roles g on g.oid = m.roleid join pg_roles r on r.oid = m.member
        where r.rolname = 'app_migrator' order by g.rolname`,
    );
    expect(rows).toEqual([
      { granted: 'app_admin_fn', inherit_option: false, set_option: true },
      { granted: 'rls_lookup', inherit_option: false, set_option: true },
    ]);
  });

  it('app_user cannot create objects in the public or app schema', async () => {
    await expect(appUser.query('create table public.t (x int)')).rejects.toThrow(/permission denied for schema public/);
    await expect(appUser.query('create table app.t (x int)')).rejects.toThrow(/permission denied for schema app/);
  });

  it('app_user cannot switch to a privileged role', async () => {
    for (const role of ['app_migrator', 'rls_lookup', 'app_admin_fn']) {
      await expect(appUser.query(`set role ${role}`)).rejects.toThrow(/permission denied to set role/);
    }
  });

  it('bootstrap is idempotent and re-asserts role attributes', async () => {
    await db.superuser.query('alter role app_user bypassrls');
    const client = await db.superuser.connect();
    try {
      await bootstrapDatabase(client);
      await bootstrapDatabase(client);
    } finally {
      client.release();
    }
    const { rows } = await db.superuser.query(`select rolbypassrls from pg_roles where rolname = 'app_user'`);
    expect(rows).toEqual([{ rolbypassrls: false }]);
  });
});
