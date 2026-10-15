# packages/

Shared workspace libraries. These are created as Sprint 0 and later stories need them:

| Package | Purpose | First needed |
|---|---|---|
| `config` (`@dm/config`) | **Created in S0.3.** `tsconfig.base.json` and the ESLint flat-config preset (`@dm/config/eslint`). Prettier preset deferred to S0.4. | S0.3 |
| `shared` (`@dm/shared`) | **Created in S0.6.** zod config loader (fail-fast, `SENDING_MODE` rules, `loadConfigOrExit`), pino logger with redaction, request IDs, `/health` and `/ready` plugin with Postgres and Valkey probes, `connectDependencies()` and `startHttpService()` (S0.8). Exports TypeScript source (ADR-016). | S0.6 |
| `db` (`@dm/db`) | **Created in S0.4.** Role bootstrap SQL, Drizzle schema (tenants, users, memberships, contacts), generated plus hand-written SQL migrations (forced RLS, grants, owner trigger), `runMigrations()`, `withTenant()`, `db:bootstrap` / `db:migrate` commands. Tests run against Testcontainers Postgres. Lookup functions arrive with their stories. | S0.4 |
| `core` (`@dm/core`) | **Created in Sprint 1.** Identity (Argon2id passwords with breached-password checks, one-time tokens, Valkey sessions, rate limits, `IdentityService`), tenancy (`OrganisationService`, permission matrix) and the audit writer. | Sprint 1 |
| `channels` (`@dm/channels`) | **Created in S1.5.** `ChannelProvider`, `SinkProvider` (Mailpit HTTP API), `SendingModeGuard`/`guardedProvider`, system email templates. SES and token buckets arrive with S8.1 and S8.6. | S1.5 |
| `security` | Token signing, SSRF-safe HTTP client, crypto helpers | Sprint 4 |
| `ui` | Shared React components | Sprint 1 |
