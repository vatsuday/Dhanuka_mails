# packages/

Shared workspace libraries. These are created as Sprint 0 and later stories need them:

| Package | Purpose | First needed |
|---|---|---|
| `config` (`@dm/config`) | **Created in S0.3.** `tsconfig.base.json` and the ESLint flat-config preset (`@dm/config/eslint`). Prettier preset deferred to S0.4. | S0.3 |
| `shared` (`@dm/shared`) | **Created in S0.6.** zod config loader (fail-fast, `SENDING_MODE` rules), pino logger with redaction, request IDs, `/health` and `/ready` plugin with Postgres and Valkey probes. Exports TypeScript source (ADR-016). | S0.6 |
| `db` | Drizzle schema, SQL migrations, RLS, roles, lookup functions, `withTenant()` | S0.4 |
| `core` | Domain modules | Sprint 1 |
| `channels` | `ChannelProvider`, sink, SES, `SendingModeGuard`, token buckets | S1.5 |
| `security` | Token signing, SSRF-safe HTTP client, crypto helpers | Sprint 4 |
| `ui` | Shared React components | Sprint 1 |
