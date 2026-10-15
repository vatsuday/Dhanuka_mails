-- Row-level security, grants and the owner-keeping trigger for the first tables
-- (docs/04-database-design.md §1, §2, §5.1, §5.3; ADR-002). Hand-written; reviewed like code.
--
-- Tenant predicate. NULLIF matters: once a pooled connection has run set_config('app.tenant_id', ..., true)
-- in an earlier transaction, current_setting() returns '' (not NULL) afterwards, and ''::uuid would raise
-- an error. With NULLIF an unset tenant compares to NULL, so every row is filtered out (fail closed).
-- The (SELECT ...) wrapper makes Postgres evaluate it once per query, not once per row.

-- tenants: a tenant sees only its own row.
ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.tenants
  USING      (id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid));

ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.memberships
  USING      (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid));

ALTER TABLE app.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.contacts
  USING      (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid));

-- Explicit per-table grants; no blanket GRANT ALL (§2). admin_user gets no direct table access:
-- operator actions go through app.admin_* functions (later stories).
-- Tenants are created at sign-up and never deleted by the runtime (closure is a status change).
GRANT SELECT, INSERT, UPDATE ON app.tenants TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memberships TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.contacts TO app_user;
-- users is global (no RLS): the identity module reads and updates it. INSERT arrives with sign-up (S1.x).
GRANT SELECT, UPDATE ON app.users TO app_user;

-- Every tenant keeps at least one owner (§5.1). Deferred, so an ownership transfer can demote the old
-- owner and promote the new one in the same transaction. Locking the tenant row serialises concurrent
-- demotions, so two transactions cannot each remove one of the last two owners.
CREATE FUNCTION app.memberships_keep_owner() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.role = 'owner' THEN
    -- No row means the tenant itself is gone or not visible; nothing to protect.
    PERFORM 1 FROM app.tenants WHERE id = OLD.tenant_id FOR UPDATE;
    IF FOUND AND NOT EXISTS (
      SELECT 1 FROM app.memberships WHERE tenant_id = OLD.tenant_id AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'tenant % must keep at least one owner', OLD.tenant_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'memberships_keep_owner';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.memberships_keep_owner() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER memberships_keep_owner
  AFTER UPDATE OF role, tenant_id OR DELETE ON app.memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.memberships_keep_owner();
