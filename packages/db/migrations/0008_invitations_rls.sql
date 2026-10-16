-- Invitations (S2.2; docs/04 §4, §5.1). Hand-written; reviewed like code. Tenant predicate: see 0001.

-- invitations 🔒: members with members:manage create, list and revoke them inside their tenant.
-- No DELETE: revoked and accepted invitations stay as history.
ALTER TABLE app.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.invitations
  USING      (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid));
GRANT SELECT, INSERT, UPDATE ON app.invitations TO app_user;

-- lookup_invitation (docs/04 §4): the invitee is not a member yet, so no tenant can be set. Given only
-- the SHA-256 of a token, it returns the documented summary, and only while the invitation is pending
-- (not accepted, not revoked) and unexpired. Accepting then runs inside withTenant(tenant_id).
CREATE FUNCTION app.lookup_invitation(p_token_hash bytea)
  RETURNS TABLE (invitation_id uuid, tenant_id uuid, tenant_name text, email text, role text, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT i.id, i.tenant_id, t.name, i.email_normalized, i.role, i.expires_at
    FROM app.invitations i
    JOIN app.tenants t ON t.id = i.tenant_id
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.revoked_at IS NULL
     AND i.expires_at > pg_catalog.now()
$$;
-- Revoke while app_migrator still owns the function, then hand it over (see 0003).
REVOKE ALL ON FUNCTION app.lookup_invitation(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lookup_invitation(bytea) TO app_user;
ALTER FUNCTION app.lookup_invitation(bytea) OWNER TO rls_lookup;
-- The function owner reads only the columns it returns or filters on (tenants: granted in 0003).
GRANT SELECT (id, tenant_id, email_normalized, role, token_hash, expires_at, accepted_at, revoked_at)
  ON app.invitations TO rls_lookup;
