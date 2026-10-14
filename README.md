# Dhanuka Mails

A multi-tenant SaaS platform for email marketing and multichannel communication (Email, SMS, WhatsApp), India first, built with security, tenant isolation and deliverability as first-class requirements.

> **Status:** Phase 1 approved (2026-10-14). Sprint 0 is in progress. See [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Local development (Sprint 0, in progress)

**Prerequisites (Windows 11):**

| Tool | Version | Install |
|---|---|---|
| Node.js | 26.4+ (see `.nvmrc`) | nodejs.org or a version manager |
| pnpm | 12.11.2 (see `packageManager`) | `npm install -g --allow-scripts=pnpm pnpm@12.11.2` (corepack is not bundled with Node 26) |
| Docker Desktop | current, WSL2 backend | docker.com. Check the licence terms in `docs/03-tech-stack.md` §6 |
| Git | 2.4x+ | git-scm.com |

**Local services** (Postgres 18, Valkey queue and cache, Mailpit, ElasticMQ):

```sh
cp .env.example .env      # optional: override local defaults; .env is gitignored
npm run infra:up          # docker compose up -d --wait
npm run infra:ps
npm run infra:down        # or infra:reset to also delete volumes
```

The `infra:*` scripts only need Docker. Once pnpm is installed, `pnpm infra:up` works too.

**Apps** (ports and checks in [`apps/README.md`](apps/README.md)):

```sh
pnpm install
cp .env.example .env      # the apps read it in dev mode
pnpm dev                  # all six apps: web :3000, api :3001 … admin :3005
pnpm build                # Next.js production build (Node apps need no build, ADR-016)
pnpm smoke:apps           # boots every Node app and probes /health and /ready
pnpm test:e2e             # Playwright against the built web app (uses your installed Chrome locally)
```

Without Docker running, every Node app's `/ready` returns 503. That's expected; `/health` still returns 200.

## Documentation

| Doc | Purpose |
|---|---|
| [01 — PRD](docs/01-prd.md) | Product requirements, scope, functional rules, NFRs, risks |
| [02 — Architecture](docs/02-architecture.md) | Processes, tenant isolation, auth/RBAC, sending pipeline, SES, unsubscribe, SSRF, security, deployment |
| [03 — Tech stack](docs/03-tech-stack.md) | Runtime decision, pinned and compatibility-checked versions, repo layout, local prerequisites |
| [04 — Database design](docs/04-database-design.md) | Roles, RLS, pre-tenant functions, tables, constraints |
| [05 — Backlog](docs/05-backlog.md) | Sprints 0–9, every story with acceptance criteria, Definition of Done |
| [06 — Deliverability policy](docs/06-deliverability-policy.md) | Sending modes, quotas, warm-up, thresholds, domain authentication |
| [07 — Operations readiness](docs/07-operations-readiness.md) | Environments, local stack, monitoring, runbooks, production gate |
| [08 — AWS cost estimate](docs/08-aws-cost-estimate.md) | Beta cost options A and B |
| [ADRs](docs/adr/README.md) | Architecture decision records 001–015 |
| [Phase 1 review](docs/reviews/phase1-review.md) | Findings and resolution status |
| [CI pipeline](docs/ci.md) | Jobs, required branch protection, supply-chain pinning |
| [Progress](docs/PROGRESS.md) | Checklist, decisions awaiting approval, blockers, risks |
