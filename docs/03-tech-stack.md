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

## 2. Pinned versions

Compatibility here was checked from npm registry metadata (`version`, `engines`, `peerDependencies`) on 2026-10-14. **Nothing has been installed yet.** Sprint 0 task S0.3 performs the real install, typecheck and build, and only then are these versions confirmed. Exact versions go in `package.json`, and the lockfile is committed.

| Layer | Package | Pin | Engines / peers checked | Notes |
|---|---|---|---|---|
| Package manager | pnpm | **12.11.2** | node ≥ 18 | Via npm global install, not corepack |
| Monorepo | turbo | **2.11.8** | — | |
| Language | typescript | **6.0.3** | — | ⚠️ **Not 7.0.2.** typescript-eslint 8.71.2 requires TypeScript `>=4.8.4 <6.1.0`. |
| Lint | eslint | **10.12.0** | node ≥ 24 ✅ | Flat config |
| Lint | typescript-eslint | **8.71.2** | eslint ^10 ✅, TS < 6.1 ✅ | |
| Web | next | **16.4.0** | node ≥ 20.9 ✅, react ^19 ✅ | `output: 'standalone'` for ECS |
| Web | react / react-dom | **19.3.0** | — | |
| Web | tailwindcss | **4.3.3** | — | shadcn/ui on Tailwind v4 |
| API | fastify | **5.12.7** | — | |
| Validation | zod | **4.6.7** | — | |
| API | fastify-type-provider-zod | **7.0.0** | fastify ^5.5 ✅, zod ≥ 4.1.5 ✅ | Plus `@fastify/swagger` for OpenAPI |
| DB | drizzle-orm | **0.45.4** | pg ≥ 8 ✅ | ⚠️ **Not the 1.0 RC** (`1.0.0-rc.5`). Re-evaluate when 1.0 reaches GA. |
| DB | drizzle-kit | **0.31.11** | — | Hand-written SQL migrations for RLS, roles and functions |
| DB driver | pg | **8.23.1** | node ≥ 16 ✅ | |
| Queue | bullmq | **6.3.15** | ioredis ≥ 5 ✅ | Major released 2026-07-30. **Sprint 0 spike** (S0.7); fall back to 5.x if it fails. |
| Redis client | ioredis | **6.0.0** | node ≥ 20 ✅ | |
| Email | mjml | **5.4.1** | — | |
| Templating | liquidjs | **10.30.0** | node ≥ 16 ✅ | ADR-008 |
| Email provider | @aws-sdk/client-sesv2 | **3.1151.0** | node ≥ 20 ✅ | Needs `TenantName` support; checked in the Sprint 2 spike |
| HTTP client | undici | **8.12.1** | node ≥ 22.19 ✅ | Custom `lookup` for the SSRF guard |
| Passwords | @node-rs/argon2 | **2.2.2** | N-API (independent of Node version) | |
| MFA | otplib | **13.5.0** | — | |
| Logging | pino | **10.4.0** | — | |
| Tests | vitest | **5.0.4** | node ^22.12 / ^24 / ≥ 26 ✅ | |
| Tests | testcontainers | **12.2.1** | node ≥ 22.22 ✅ | **Requires Docker** |
| Tests | @playwright/test | **1.64.0** | node ≥ 20 ✅ | Matches Next 16's optional peer `^1.51.1` |
| Types | @types/node | **26.x** | — | Matches the runtime major |

Other tools will be pinned at the same time in Sprint 0: `@fastify/*` plugins, `dependency-cruiser`, `prettier`, `shadcn` CLI, `@opentelemetry/*`, `@sentry/node`, `gitleaks` (CI action).

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
