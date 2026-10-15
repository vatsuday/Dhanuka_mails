-- Sprint 1 security objects (docs/04 §2, §4, §5.1; S1.6, S1.7, S1.9). Hand-written; reviewed like code.
-- Tenant predicate: see 0001 for why NULLIF is required.

-- tenant_sending_policies 🔒: tenants read their own row; the row is created with the tenant (S1.6).
-- No UPDATE or DELETE for the runtime role: only operator functions change tiers and quotas (S14.3).
ALTER TABLE app.tenant_sending_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_sending_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.tenant_sending_policies
  USING      (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid));
GRANT SELECT, INSERT ON app.tenant_sending_policies TO app_user;

-- Identity (global tables, no RLS): sign-up creates users; tokens are created and consumed.
GRANT INSERT ON app.users TO app_user;
GRANT SELECT, INSERT, UPDATE ON app.user_tokens TO app_user;

-- audit_logs 🔒: append-only, range-partitioned by month (docs/04 §5.1, §6).
CREATE TABLE app.audit_logs (
  id          uuid        NOT NULL DEFAULT uuidv7(),
  tenant_id   uuid        REFERENCES app.tenants (id),
  actor_type  text        NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system', 'operator')),
  actor_id    uuid,
  action      text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  target_type text,
  target_id   text,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX audit_logs_tenant_created_idx ON app.audit_logs (tenant_id, created_at);
CREATE INDEX audit_logs_actor_created_idx ON app.audit_logs (actor_id, created_at);

-- Monthly partitions through 2027-12, plus a default partition so an insert can never fail for lack
-- of a partition. The partition-maintenance job (3 months ahead, docs/04 §6) arrives with retention (S10.6).
DO $partitions$
DECLARE
  month date := date '2026-10-01';
BEGIN
  WHILE month < date '2028-01-01' LOOP
    EXECUTE format(
      'CREATE TABLE app.%I PARTITION OF app.audit_logs FOR VALUES FROM (%L) TO (%L)',
      'audit_logs_' || to_char(month, 'YYYY_MM'), month, month + interval '1 month');
    month := month + interval '1 month';
  END LOOP;
END
$partitions$;
CREATE TABLE app.audit_logs_default PARTITION OF app.audit_logs DEFAULT;

-- Tenants see only their own rows. Rows without a tenant (sign-up, login, password reset) may be
-- written by the runtime role but are never visible to it.
ALTER TABLE app.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON app.audit_logs FOR SELECT
  USING (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid));
CREATE POLICY tenant_append ON app.audit_logs FOR INSERT
  WITH CHECK (tenant_id IS NULL
              OR tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid));
-- INSERT and SELECT only: UPDATE and DELETE are impossible for both runtime roles (S1.9 AC 1).
-- Partitions get no grants, so they can only be reached through the parent and its policies.
GRANT SELECT, INSERT ON app.audit_logs TO app_user, admin_user;

-- list_user_memberships (docs/04 §4, S1.7): the organisation switcher after login, before a tenant
-- is chosen. Defence in depth: it answers only for the user bound to the transaction with
-- set_config('app.user_id', ..., true) (withUser), so an API bug passing another user's ID returns nothing.
CREATE FUNCTION app.list_user_memberships(p_user_id uuid)
  RETURNS TABLE (tenant_id uuid, tenant_name text, role text, tenant_status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT m.tenant_id, t.name, m.role, t.status
    FROM app.memberships m
    JOIN app.tenants t ON t.id = m.tenant_id
   WHERE m.user_id = p_user_id
     AND p_user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
   ORDER BY t.name, m.tenant_id
$$;
-- Order matters: only the owner can revoke or grant, and a REVOKE by a non-owner is silently ignored
-- (a warning, not an error). So fix the ACL while app_migrator still owns the function, then hand it over;
-- ALTER OWNER carries the ACL across. The catalog test caught the reverse order leaving PUBLIC EXECUTE.
REVOKE ALL ON FUNCTION app.list_user_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_user_memberships(uuid) TO app_user;
ALTER FUNCTION app.list_user_memberships(uuid) OWNER TO rls_lookup;
-- The function owner reads only the columns it returns or filters on.
GRANT SELECT (tenant_id, user_id, role) ON app.memberships TO rls_lookup;
GRANT SELECT (id, name, status) ON app.tenants TO rls_lookup;
