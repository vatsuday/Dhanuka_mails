// Catalog checks (S0.5 AC 2 and 3, docs/04 §1 and §4). Each returns human-readable violations;
// an empty list means the database is compliant. They inspect every non-system schema, so a table or
// function added anywhere is covered without registering it.
import type pg from 'pg';

type Queryable = Pick<pg.ClientBase, 'query'>;

const USER_SCHEMAS = `n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'`;

/** Tables that hold tenant data: any table with a tenant_id column, plus app.tenants itself. */
export async function tenantTables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `select n.nspname || '.' || c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and ${USER_SCHEMAS} and not c.relispartition
        and (exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
             or (n.nspname = 'app' and c.relname = 'tenants'))
      order by 1`,
  );
  return rows.map((r) => r.name);
}

/** Every tenant table must have RLS enabled and forced, with at least one policy. */
export async function findRlsViolations(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ name: string; enabled: boolean; forced: boolean; policies: number }>(
    `select n.nspname || '.' || c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where (n.nspname || '.' || c.relname) = any($1)
      order by 1`,
    [await tenantTables(db)],
  );
  return rows.flatMap((t) => [
    ...(t.enabled ? [] : [`${t.name}: row-level security is not enabled`]),
    ...(t.forced ? [] : [`${t.name}: row-level security is not forced`]),
    ...(t.policies > 0 ? [] : [`${t.name}: has no policy`]),
  ]);
}

const PINNED_SEARCH_PATH = 'search_path=pg_catalog, pg_temp';

/** Every SECURITY DEFINER function must pin search_path and must not be executable by PUBLIC. */
export async function findSecurityDefinerViolations(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ name: string; config: string[] | null; publicExecute: boolean }>(
    `select p.oid::regprocedure::text as name, p.proconfig as config,
            (p.proacl is null  -- no ACL means the default: PUBLIC may execute
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
              as "publicExecute"
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and ${USER_SCHEMAS}
      order by 1`,
  );
  return rows.flatMap((f) => [
    ...((f.config ?? []).includes(PINNED_SEARCH_PATH) ? [] : [`${f.name}: search_path is not pinned to "pg_catalog, pg_temp"`]),
    ...(f.publicExecute ? [`${f.name}: PUBLIC can execute it`] : []),
  ]);
}
