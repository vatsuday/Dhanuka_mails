-- Database bootstrap (docs/04-database-design.md §2). Run once per database by a superuser
-- (locally the docker-compose bootstrap user; in AWS the RDS master user), before any migration.
-- Idempotent: safe to run again, and it re-asserts every role attribute each time.
-- Passwords are never set here; `pnpm db:bootstrap` sets them separately from the environment.

DO $bootstrap$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_migrator', 'app_user', 'admin_user', 'rls_lookup', 'app_admin_fn'] LOOP
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I', r);
    END IF;
  END LOOP;
END
$bootstrap$;

-- Owns the schema and runs migrations (CI/CD only).
ALTER ROLE app_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Runtime roles: never owners, never BYPASSRLS (ADR-002).
ALTER ROLE app_user     LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE admin_user   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Owners of SECURITY DEFINER functions (pre-tenant lookups and operator functions). They cannot log in.
ALTER ROLE rls_lookup   NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
ALTER ROLE app_admin_fn NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;

-- Only the roles above may connect; nothing may create objects in public.
DO $bootstrap$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_migrator, app_user, admin_user', current_database());
  -- The Drizzle migrator always runs CREATE SCHEMA IF NOT EXISTS, which Postgres checks against
  -- database CREATE even when the schema exists. Only the DDL role gets it; runtime roles never do.
  EXECUTE format('GRANT CREATE ON DATABASE %I TO app_migrator', current_database());
END
$bootstrap$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrator;
ALTER SCHEMA app OWNER TO app_migrator;
GRANT USAGE ON SCHEMA app TO app_user, admin_user;
-- Function owners need CREATE on the schema to own functions in it.
GRANT USAGE, CREATE ON SCHEMA app TO rls_lookup, app_admin_fn;

-- Lets migrations hand function ownership to rls_lookup / app_admin_fn (ALTER FUNCTION ... OWNER TO).
-- INHERIT FALSE: app_migrator does not gain their privileges, and BYPASSRLS is never inherited.
GRANT rls_lookup   TO app_migrator WITH INHERIT FALSE, SET TRUE;
GRANT app_admin_fn TO app_migrator WITH INHERIT FALSE, SET TRUE;
