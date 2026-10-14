# ADR-002: Tenant isolation with RLS and narrow pre-tenant lookup functions

**Status:** Accepted (Phase 1 approval, 2026-10-14) · **Date:** 2026-10-14 · Supersedes the v0.1 draft (review finding C1)

## Context
We use a shared schema. The application must never see another tenant's data, even when the application code has a bug. Some operations legitimately happen before the tenant is known:
- API-key authentication
- invitation acceptance
- listing a user's organisations
- routing provider events
- the scheduler, outbox relay and reconciler, which work across tenants

## Decision
- **RLS on every tenant table:** `tenant_id` column plus `FORCE ROW LEVEL SECURITY`. The setting is read with `(SELECT current_setting('app.tenant_id', true))` and set transaction-locally by `withTenant()`. With no tenant set, queries see zero rows.
- **No login role has `BYPASSRLS`.**
- **Pre-tenant and cross-tenant needs** are served only by `SECURITY DEFINER` functions owned by the NOLOGIN roles `rls_lookup` and `app_admin_fn`. Each function:
  - has `search_path = pg_catalog, pg_temp` pinned;
  - has execution revoked from `PUBLIC` and granted only to the intended role;
  - returns the minimum set of columns;
  - has its own tests.
  The full list is in `04-database-design.md` §4.
- **Tracker and unsubscribe tokens** carry `tenant_id` inside the HMAC-signed payload, so they need no lookup.
- **CI catalog tests** fail the build if:
  - a table with `tenant_id` lacks forced RLS;
  - a `SECURITY DEFINER` function lacks a pinned `search_path`;
  - a `SECURITY DEFINER` function is executable by `PUBLIC`.

## Alternatives rejected
- **Schema per tenant or database per tenant:** operational overhead at our scale.
- **A login role with `BYPASSRLS` for lookups:** too broad. Any bug in that code path could leak every tenant's data.
- **Isolation in application code only:** a single missed `WHERE` clause becomes a leak.

## Consequences
- Every new cross-tenant need requires a reviewed function, which is deliberate friction.
- Functions are covered by the isolation suite.
