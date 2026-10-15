import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { auditLogs } from './audit-schema.ts';
import * as tables from './schema.ts';

const schema = { ...tables, auditLogs };

export type Database = NodePgDatabase<typeof schema>;
/** The transaction handed to a `withTenant` callback. */
export type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDatabase(pool: pg.Pool): Database {
  return drizzle({ client: pool, schema });
}

/**
 * Applies pending migrations. Must run as `app_migrator` (the schema owner), never as the runtime role.
 * The ledger table lives in the `app` schema, which app_migrator owns; nobody else has grants on it.
 */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: 'app',
    migrationsTable: '__drizzle_migrations',
  });
}

/**
 * Runs `fn` in a transaction bound to one signed-in user, for pre-tenant lookups such as
 * `app.list_user_memberships`, which only answer for the bound user. Transaction-local, like withTenant.
 */
export async function withUser<T>(db: Database, userId: string, fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new TypeError('withUser: userId must be a UUID');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_catalog.set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` in a transaction scoped to one tenant (ADR-002). The tenant is set with
 * `set_config(..., is_local => true)`, so it ends with the transaction and never leaks to the next
 * user of a pooled connection. Outside withTenant, row-level security returns zero rows.
 * The tenant ID must come from the session or API key, never from a request body.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
  options: { userId?: string } = {},
): Promise<T> {
  if (!UUID.test(tenantId)) throw new TypeError('withTenant: tenantId must be a UUID');
  if (options.userId !== undefined && !UUID.test(options.userId)) throw new TypeError('withTenant: userId must be a UUID');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_catalog.set_config('app.tenant_id', ${tenantId}, true)`);
    if (options.userId !== undefined) {
      await tx.execute(sql`select pg_catalog.set_config('app.user_id', ${options.userId}, true)`);
    }
    return fn(tx);
  });
}
