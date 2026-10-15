# 03 — Technology Stack

**Status:** v1.0 — **approved** (Phase 1 approval: D1–D4, 2026-10-14). Changes from now on go through change control: update the doc, the ADR if relevant, and PROGRESS.md.
**Last updated:** 2026-10-14

## 1. Runtime decision: Node.js 26 (installed version)

| Fact (checked 2026-10-14) | Source |
|---|---|
| Installed locally: **Node v26.4.0**, npm 12.0.1 | `node --version` |
| Node 24: Active LTS until **2026-10-20**, then maintenance until 2028-04-30 | nodejs/Release `schedule.json` |
| Node 26: becomes **LTS on 2026-10-28**; maintenance from 2027-10-20; end of life 2029-04-30 | nodejs/Release `schedule.json` |
| The `engines` field of every planned dependency accepts Node 26 (table below) | npm registry metadata |
| **corepack is no longer bundled with Node** (it's absent from the v26 install) | `corepack: command not found` |

**Decision: use the installed Node 26** (`engines: ">=26.4.0 <27"`, `.nvmrc` = `26`, Docker image `node:26-bookworm-slim`). It will be the Active LTS when the MVP ships, and the developer machine already runs it.

- **Fallback:** if any dependency fails on Node 26 during Sprint 0 installation, use **Node 24.x**, which every pinned package also supports and which is maintained until April 2028. Record the reason in ADR-006.
- **pnpm installation:** corepack isn't available, so install with `npm install -g --allow-scripts=pnpm pnpm@12.11.2`. The version is pinned in the `packageManager` field. pnpm 12 reads its settings (`engineStrict`, `savePrefix`) from **`pnpm-workspace.yaml`, not `.npmrc`** (verified 2026-10-14). It also records its own version in `pnpm-lock.yaml` (`packageManagerDependencies`).

## 2. Pinned versions (verified in S0.3, 2026-10-14)

**The source of truth is the `catalog:` in `pnpm-workspace.yaml`.** Packages reference versions with `catalog:`. This table explains the pins.

**How they were verified:**
- The whole set was installed together in a scratch workspace on **Node 26.4.0 + pnpm 12.11.2**, with `minimumReleaseAge` set to 14 days. The install resolved 594 packages.
- Every runtime library was loaded and exercised on Node 26, and every CLI was run.
- Peers were checked with `pnpm peers check`.
- In the repository itself, only the toolchain of `@dm/config` is installed so far (98 packages, no peer issues).

**Supply-chain rule (ADR-006):**
- Every pinned version, and every transitive dependency, must be **at least 14 days old**. pnpm enforces this with `minimumReleaseAge: 20160`.
- That is why many Phase 1 pins, which were "latest on 2026-10-14", moved back to the newest version published on or before 2026-09-29, within the same major line.

| Layer | Package | Planned (Phase 1) | **Pinned (S0.3)** | Published | Verified on Node 26.4 | Notes |
|---|---|---|---|---|---|---|
| Package manager | pnpm | 12.11.2 | **12.11.2** | 2026-10-09 | Installed globally; CI-proven | ⚠️ **Exception** to the 14-day rule (adopted in S0.1, before the rule). Replace with a ≥ 14-day version at the next tool upgrade. |
| Monorepo | turbo | 2.11.8 | **2.11.5** | 2026-09-28 | CLI ran | Catalogued only; **adoption deferred** (`pnpm -r` is enough until a build graph exists) |
| Language | typescript | 6.0.3 | **6.0.3** | 2026-04-16 | Strict compile ✅; in use by `@dm/config` | Not 7.x: typescript-eslint requires TypeScript `<6.1.0` |
| Lint | eslint | 10.12.0 | **10.11.0** | 2026-09-18 | In use; negative tests ✅ |  |
| Lint | @eslint/js | — | **10.0.1** | 2026-02-06 | In use | **Added:** needed for flat-config `recommended` rules |
| Lint | typescript-eslint | 8.71.2 | **8.71.0** | 2026-09-28 | In use; type-aware rules ✅ | Peer: TypeScript `<6.1.0` ✅, eslint ^10 ✅ |
| Format | prettier | (Sprint 0) | **3.9.9** | 2026-09-23 | CLI ran | Catalogued; **wiring deferred** until there is source code (S0.4) |
| Web | next | 16.4.0 | **16.3.7** | 2026-09-29 | Resolves; CLI ran | 16.4.0 was too new |
| Web | react / react-dom | 19.3.0 | **19.3.0** | 2026-09-09 | SSR render ✅ |  |
| Web | tailwindcss | 4.3.3 | **4.3.3** | 2026-07-16 | Installed |  |
| API | fastify | 5.12.7 | **5.12.5** | 2026-09-16 | Request validation via inject ✅ |  |
| Validation | zod | 4.6.7 | **4.6.5** | 2026-09-13 | Parse ✅ |  |
| API | fastify-type-provider-zod | 7.0.0 | **7.0.0** | 2026-06-24 | 200/400 validation ✅ | Requires peers `@fastify/swagger` and `openapi-types` |
| API | @fastify/swagger | — | **9.9.0** | 2026-09-22 | Loads | **Added:** required peer |
| API | openapi-types | — | **12.1.3** | 2023-05-24 | Installed | **Added:** required peer |
| DB | drizzle-orm | 0.45.4 | **0.45.3** | 2026-09-21 | pg table definition ✅ | Not 1.0 RC |
| DB | drizzle-kit | 0.31.11 | **0.31.11** | 2026-09-21 | CLI ✅ (with esbuild script denied) |  |
| DB driver | pg | 8.23.1 | **8.23.0** | 2026-08-08 | Client constructed | 8.23.1 was too new |
| Queue | bullmq | 6.3.15 | **6.3.10** | 2026-09-29 | Loads | Behaviour spike in S0.7 (needs Docker) |
| Redis client | ioredis | 6.0.0 | **6.0.0** | 2026-07-31 | Lazy client ✅ |  |
| Email | mjml | 5.4.1 | **5.4.1** | 2026-09-10 | Compile ✅; minify ✅ | Accepted upstream peer conflict: htmlnano wants cssnano ^8, gets 7.1.9 (see ADR-006) |
| Templating | liquidjs | 10.30.0 | **10.29.0** | 2026-08-11 | HTML escaping ✅ |  |
| Email provider | @aws-sdk/client-sesv2 | 3.1151.0 | **3.1142.0** | 2026-09-28 | `SendEmailRequest.TenantName` present in types ✅ | Real SES behaviour: spike S2.6 |
| HTTP client | undici | 8.12.1 | **8.11.2** | 2026-09-24 | Agent with custom `connect.lookup` ✅ |  |
| Passwords | @node-rs/argon2 | 2.2.2 | **2.2.1** | 2026-09-10 | Native hash + verify on Node 26 ✅ |  |
| MFA | otplib | 13.5.0 | **13.5.0** | 2026-08-21 | TOTP generate + verify ✅ | v13 API: `generate` / `verify` functions |
| Logging | pino | 10.4.0 | **10.3.1** | 2026-02-09 | Loads |  |
| Tests | vitest | 5.0.4 | **5.0.2** | 2026-09-25 | Real TypeScript test run ✅ |  |
| Tests | testcontainers | 12.2.1 | **12.2.0** | 2026-09-28 | Starts Postgres 18.6 and Valkey 8.1.10 containers (S0.4, 2026-10-15) | Windows Docker Desktop verified; Linux runner via CI |
| Tests | @playwright/test | 1.64.0 | **1.63.0** | 2026-09-04 | CLI ran | Browsers not installed yet (S0.8) |
| Types | @types/node | 26.x | **26.6.3** | 2026-09-25 | In use |  |
| Types | @types/pg | — | **8.23.1** | 2026-08-17 | In use (`@dm/shared`) | **Added in S0.6**; runtime dependency of `@dm/shared` since S0.8 |
| Types | @types/react / @types/react-dom | — | **19.3.0** | 2026-09-09 | In use (`@dm/web`) | **Added in S0.8** |
| Lint | globals | — | **17.12.0** | 2026-09-01 | In use (`@dm/config` preset) | **Added in S0.8:** Node globals for `.js`/`.mjs` files |

**Install scripts:** denied by default. Reviewed denials (`allowBuilds` in `pnpm-workspace.yaml`): `cpu-features`, `ssh2`, `esbuild`, `msgpackr-extract`, `protobufjs`. All dependent tools were verified to work without them.

**Still to pin when first used:** `@fastify/*` plugins, `dependency-cruiser` (S0.4/S0.8, once there are module boundaries to enforce), `shadcn` CLI, `@opentelemetry/*`, `@sentry/node`. Any new pin must be at least 14 days old.

## 3. Services and infrastructure versions

| Component | Choice | Verification still needed |
|---|---|---|
| PostgreSQL | **18** (native `uuidv7()`, released 2025-09) | Confirm RDS supports the latest 18.x minor in ap-south-1 (Sprint 0/2). **Fallback: 17.** Local image pinned to the same minor. |
| Valkey (queue and cache) | **8.x**, the newest version ElastiCache supports in ap-south-1 | Pin the exact tag in Sprint 0. The BullMQ 6 compatibility spike runs in S0.7. |
| SES | API v2 with **tenant management** and tenant-level suppression | Sprint 2 spike (ADR-003) |
| SQS | Local: **ElasticMQ** (Apache-2.0, SQS-compatible) | — |
| S3 | Local: **emulator to be selected before Sprint 3**. The `minio/minio` image is no longer on Docker Hub (checked 2026-10-14). Candidates: RustFS (1.0.1 on Docker Hub), SeaweedFS, Adobe S3Mock. | Selection and licence check (tracked in PROGRESS) |
| Mail sink | Local: **Mailpit** | — |

## 4. Choices and rationale

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Language | TypeScript (strict) on Node 26 | One language end to end; shared zod types | Go |
| Monorepo | pnpm + Turborepo | Fast cached builds, clean boundaries | Nx |
| Web | Next.js App Router + Tailwind + shadcn/ui | Productive and accessible | Vite SPA |
| API | Fastify + zod + OpenAPI | Fast and schema-first | NestJS, Hono |
| ORM | Drizzle (stable 0.45) + raw SQL migrations for RLS | Close to SQL; works with transaction-local settings | Prisma |
| Database | PostgreSQL 18 | RLS, partitioning, JSONB | — |
| Jobs | BullMQ on Valkey + Postgres outbox | Delayed and repeatable jobs; DB-backed recovery | SQS-only, pg-boss |
| Templates | MJML 5 + **LiquidJS** | Responsive email; safe, sandboxable templating | Handlebars (dropped: it was inconsistent with the backlog's syntax and weaker at sandboxing) |
| Auth | Self-built on Argon2id, otplib and Redis sessions | Full control over multi-tenant memberships; small surface area; external security review in Sprint 9 | Better Auth, Clerk |
| Tests | Vitest, Testcontainers (real Postgres and Valkey), Playwright | RLS is exercised against a real database | Jest |
| Observability | pino, OpenTelemetry, Sentry, CloudWatch | Vendor-neutral | — |
| IaC and CI | Terraform, GitHub Actions | Standard | CDK |

## 5. Repository layout

```
dhanuka-mails/
├─ apps/
│  ├─ web/             # Next.js dashboard
│  ├─ api/             # Fastify tenant/public API
│  ├─ tracker/         # open/click/unsubscribe
│  ├─ worker/          # BullMQ processors, scheduler, reconciler, outbox relay
│  ├─ webhook-worker/  # isolated outbound webhooks
│  └─ admin/           # operator console + API (separate deployment)
├─ packages/
│  ├─ db/              # Drizzle schema, SQL migrations, RLS, roles, lookup functions, withTenant()
│  ├─ core/            # domain modules
│  ├─ channels/        # ChannelProvider, SES, Sink, SendingModeGuard, token buckets
│  ├─ security/        # token signing, SSRF-safe HTTP client, crypto helpers
│  ├─ shared/          # zod schemas, config loader, errors
│  ├─ ui/              # shared React components
│  └─ config/          # eslint/tsconfig/prettier presets
├─ infra/
│  ├─ docker/          # docker-compose.yml (local)
│  └─ terraform/       # staging, prod
├─ docs/               # PRD, architecture, ADRs, policies, progress
└─ .github/workflows/
```

## 6. Local development prerequisites (Windows 11 Home)

| Tool | Status (2026-10-14) | Action |
|---|---|---|
| Node.js 26.4.0 | ✅ Installed | None |
| Git 2.55 | ✅ Installed | None |
| pnpm 12.11.2 | ✅ Installed 2026-10-14 | `npm install -g --allow-scripts=pnpm pnpm@12.11.2`. Without `--allow-scripts`, npm 12 blocks pnpm's install script and `pnpm.cmd` breaks on Windows (observed). |
| Docker Desktop (WSL2 backend) | ❌ | Install, and enable virtualisation in BIOS if needed. **Licence:** free for personal use and small businesses (fewer than 250 employees **and** under $10M annual revenue); otherwise a paid subscription is required. |
| Memory | — | Allow about 6–8 GB RAM for Docker (Postgres, Valkey ×2, Mailpit, ElasticMQ, and later an S3 emulator) |

Details of the local environment are in `07-operations-readiness.md` §1.
