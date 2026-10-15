-- DEMONSTRATION ONLY (S0.5 AC 4). Never merge. A tenant table with no row-level security:
-- the isolation registry check and the catalog RLS check must both fail on it.
CREATE TABLE app.demo_broken (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES app.tenants (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.demo_broken TO app_user;
