# Progress Checklist

**Current phase:** Phase 2 — MVP build
**Current sprint:** Sprint 0 (Foundation)
**Current task:** S0.8 committed (`0bbc51a`) and pushed; CI passed (PO report). **Every Sprint 0 story that doesn't need Docker is done.** Remaining: S0.1-C, S0.4, S0.5 and S0.7, all blocked on Docker (B2). CI **does not block merges** until the `CI OK` ruleset is applied.
**Last updated:** 2026-10-14

## Phases

| Phase | Scope | Status |
|---|---|---|
| Phase 1 | Requirements, architecture, DB design, tech stack, backlog, ADRs, policies | ✅ **Approved 2026-10-14** (D1–D4, with safeguards) |
| Phase 2 | MVP build, Sprints 0–9 (`05-backlog.md`) | 🟡 In progress: Sprint 0 |
| Phase 3 | Controlled beta (`live` sending after the readiness gate) | ⚪ Not started |
| Phase 4 | Release 2: SMS, WhatsApp, automation, forms | ⚪ Not started |
| Phase 5 | Release 3: AI features, integrations, SSO, white-label | ⚪ Not started |

## Phase 1: completed

- [x] Repository inspected (empty) — 2026-10-14
- [x] v0.1 drafts → review (6 critical, 11 major, 10 minor findings) → v0.2 revision
- [x] Product-owner decisions D1–D4 approved — 2026-10-14
- [x] Safeguard 1 applied. The shared suppression list covers only reliably classified invalid addresses and permanent hard bounces, is stored as an HMAC (no plaintext), is queryable only for the tenant's own contacts, never records temporary failures, and has documented false-positive correction (`06` §7, ADR-012, `04` §4 and §5.6, stories S5.2, S10.2, S10.4, S10.5, S14.3).
- [x] Safeguard 2 applied. Thresholds are configurable, versioned guardrails with minimum volumes, a Wilson lower-bound gate, absolute backstops, provider signals, conservative handling of insufficient data, and an immediate pause for serious incidents (`06` §3–§4, ADR-015, story S14.1).
- [x] Consistency check: status headers updated, no stale suppression wording, sprint totals match the plan (305 pts), every MVP story has AC, ADR index complete (001–015)
- [x] ADRs marked Accepted. ADR-013 cost option: Option B preferred (D5), subject to a verified estimate before provisioning. Spike-dependent items are flagged in the ADR index.

## Sprint 0 status

| Story | Status | Notes |
|---|---|---|
| **S0.1** Repo and local environment | ✅ **Closed with carry-over** (PO approved 2026-10-14) | AC 1 met. AC 2 and 3 carried over as S0.1-C (needs Docker). Committed `df3a7cd`. |
| **S0.2** CI pipeline | 🟡 **Committed `7563d15`; GitHub verification pending** | AC 1 defined and checked locally; AC 2 and 3 need a GitHub repository and the `CI OK` ruleset (B6). See "S0.2 report". |
| **S0.3** Toolchain pinning | ✅ **Done; PO approved 2026-10-14** | See "S0.3 report" |
| S0.4 DB foundation and RLS | ⚪ Not started | Needs Docker (B2). **S0.1-C must be completed first.** |
| S0.5 Isolation harness | ⚪ Not started | Needs Docker (B2) |
| **S0.6** Config, logging, health | ✅ **Done; PO approved 2026-10-14** | AC amended (S0.6-A): per-app wiring → S0.8, live `/ready` check → S0.4. See "S0.6 report". |
| S0.7 Queue spike | ⚪ Not started | Needs Docker (B2) |
| **S0.8** App skeletons | ✅ **Done; PO approved 2026-10-14** | AC 3 moved to S0.7 (S0.8-A). See "S0.8 report". |

### S0.1 report (2026-10-14)

**Acceptance criteria status:**
| AC | Status |
|---|---|
| (1) `git init` with `.gitignore`, `.editorconfig`, `.nvmrc`, README | ✅ Done and verified: repository on `main`; ignore rules tested; line-ending attributes tested |
| (2) `pnpm infra:up` starts postgres, valkey-queue, valkey-cache, mailpit and elasticmq; every service with a health check reports healthy | ⛔ **Not yet verified.** Waiting for Docker (B2). The compose file has not yet been parsed or run by Docker. |
| (3) README local-setup steps followed on this machine | ⛔ **Not yet verified.** Waiting for Docker and pnpm (B2, B3). |
| *(moved)* `pnpm dev` starts every app | Moved to S0.8 (approved 2026-10-14) |

**Verification attempt 1 (2026-10-14), stopped at the prerequisite check:**
- `docker --version`, `docker compose version`, `docker info`: `docker: command not found`
- `pnpm --version`: `pnpm: command not found`
- On-disk check: no `C:\Program Files\Docker\Docker\Docker Desktop.exe` or `resources\bin\docker.exe`; no Docker Desktop process running.
- `npm ls -g` shows no pnpm, and there is no `pnpm.cmd` in `%AppData%\npm`.
- `wsl --status`: "The Windows Subsystem for Linux is not installed."
- Conclusion: B2 and B3 are still open. No compose, YAML or service checks were run. Nothing was changed.

**S0.1-C attempt (2026-10-14), stopped at prerequisites:** `docker: command not found`; no Docker Desktop files, process or uninstall entry; WSL still not installed. No Compose or service checks were run.

**Verification attempt 3 (2026-10-14):** pnpm 12.11.2 ✅ and Node v26.4.0 ✅. Docker is still absent: `docker: command not found`, no Docker Desktop files, process, uninstall entry or PATH entry. WSL is not installed. The Compose, YAML and service checks were not run.

**Verification attempt 2 (2026-10-14), same result:** `docker` and `pnpm` not found. No Docker Desktop files, process or uninstall registry entry. pnpm not among the global npm packages. WSL not installed. No checks beyond the prerequisites were run.

**pnpm installation (2026-10-14, at the PO's request):**
- `npm install -g pnpm@12.11.2` exited 0, but npm 12 **blocked pnpm's install script**, so `pnpm.cmd` failed ("…\node_modules\pnpm\pnpm is not recognized").
- The install script was inspected: it links the prebuilt `@pnpm/exe.win32-x64` binary and regenerates the Windows shims. Then re-ran `npm install -g --allow-scripts=pnpm pnpm@12.11.2` (exit 0).
- Result: `pnpm --version` = **12.11.2** in bash, PowerShell and cmd. **B3 resolved.**
- The README and `03` now give the `--allow-scripts=pnpm` command.

**S0.1 fix: pnpm settings (T2 resolved):**
- `pnpm config get engine-strict` / `save-exact` returned `undefined`: pnpm 12 ignores those keys in `.npmrc`.
- In a scratch project, pnpm 12 read `engineStrict` and `savePrefix` from `pnpm-workspace.yaml` and **rejected an install with an unsatisfiable `engines`** (exit 1).
- Moved both settings to `pnpm-workspace.yaml` and deleted `.npmrc`. In the project, pnpm now reports `engineStrict=true` and `savePrefix=""`.

**Side effect: `pnpm-lock.yaml` created.** `pnpm config get` in the project made pnpm 12 write `pnpm-lock.yaml`, recording `packageManagerDependencies: pnpm 12.11.2` with integrity hashes. No `node_modules` and no project dependencies. Kept, because a committed lockfile is required by ADR-006.

**Final non-Docker verification (2026-10-14, after the pnpm fix):**
| Check | Result |
|---|---|
| `pnpm-workspace.yaml` and `docker-compose.yml` parsed with a real YAML parser (`yaml` 2.9.1, run from the scratch dir, not added to the project) | ✅ No errors |
| `pnpm-lock.yaml` parsed (multi-document, `parseAllDocuments`) | ✅ 2 documents, 0 errors, lockfileVersion 9.0, pnpm 12.11.2 pinned |
| Compose services match AC 2 (postgres, valkey-queue, valkey-cache, mailpit, elasticmq) | ✅ |
| Every image pinned (no `latest`); every port bound to 127.0.0.1 | ✅ |
| valkey-queue `noeviction` + AOF; valkey-cache `allkeys-lru`, no persistence | ✅ |
| Health checks defined | postgres, valkey-queue, valkey-cache: yes. mailpit, elasticmq: **none** (they can only be reported as running) |
| pnpm settings `engineStrict: true`, `savePrefix: ""` | ✅ |
| `pnpm install --frozen-lockfile --ignore-scripts` | ✅ "Already up to date". It created `node_modules/` containing only pnpm state files (5 KB, gitignored, no packages). |
| `docker compose config`, `infra:up`, service health, Docker steps of the README | ⛔ **Not run: Docker not installed** → S0.1-C |

**S0.1 closure (PO approval 2026-10-14):** S0.1 is closed with AC 1 met. AC 2 (`infra:up` + health) and AC 3 (README walkthrough including the Docker steps) are carried over as **S0.1-C**. **S0.1-C must pass before S0.4**, and before S0.5 and S0.7, which also need Docker. Services are **not** claimed healthy.

**Not done in S0.1, by instruction:** no dependencies installed, no Docker or system software installed, no AWS configuration, **no git commit** (files are untracked and await review).

### S0.2 report (2026-10-14)

**Built:** `.github/workflows/ci.yml` with these jobs:
- `secret-scan`: gitleaks 8.30.1, checksum-verified, full history.
- `quality`: frozen-lockfile install, lint, typecheck, unit tests.
- `integration`: Testcontainers on the runner's Docker.
- `ci-ok`: the aggregate gate.

Actions are SHA-pinned, permissions are read-only, each job has a time limit (≤ 15 min), and the runner is `ubuntu-24.04`. Root scripts `lint`, `typecheck`, `test:unit` and `test:integration` fan out with `pnpm -r --if-present`. Documented in `docs/ci.md`.

**Acceptance criteria status:**
| AC | Status |
|---|---|
| (1) Each PR runs frozen-lockfile install, lint, typecheck, unit, integration and gitleaks | 🟡 **Defined and validated locally.** Not yet executed by GitHub Actions (no remote). ⚠️ Lint, typecheck and tests **run zero checks until packages exist** (S0.3+). |
| (2) Any failure blocks the merge | 🟡 Failure propagation proven locally (fixture workspace and gate-logic tests). **Enforcement needs a GitHub repository plus a branch ruleset requiring `CI OK`** (B6, `docs/ci.md`). |
| (3) Runtime under 15 min | 🟡 Each job's limit is ≤ 15 min and the jobs run in parallel. **Actual runtime not measured** (no GitHub run yet). |

**Checks run (all with tools in the session scratch directory, not added to the project):**
| Check | Result |
|---|---|
| actionlint 1.7.12 (checksum-verified) on `ci.yml` | ✅ 0 errors (the first attempt used a wrong flag, `-color=never`, and was re-run with `-no-color`) |
| actionlint + shellcheck 0.11.0 (shell steps) | ✅ 0 errors. shellcheck publishes no checksum file; the download was verified against GitHub's published release-asset SHA-256 digest (`sha256:8a4e35ab0b331c85d73567b12f2a444df187f483e5079ceffa6bda1faa2e740e`, 8,068,167 bytes), which matched (see "Final review"). |
| gitleaks 8.30.1 (checksum-verified): `git` history (same command as CI) | ✅ 1 commit, no leaks |
| gitleaks `dir` on the working tree (including uncommitted files) | ✅ No leaks |
| gitleaks positive control (random fake `ghp_` token in a scratch folder) | ✅ Detected, exit 1, so the scanner works |
| `pnpm run lint`, `typecheck`, `test:unit`, `test:integration` in the repo | ✅ Exit 0 (no packages yet, zero checks run) |
| Fixture workspace: one package passing lint + one failing | ✅ Root `pnpm run lint` exit 1, so a failure propagates |
| Fixture: only the passing package | ✅ Exit 0; packages without the script are skipped |
| `ci-ok` gate logic with jq 1.8.2 (checksum-verified) on simulated job results | ✅ all success → 0; failure, skipped or cancelled → 1 |

**Final review (2026-10-14, after PO feedback):**
- **Zero-check condition made explicit in CI:** new `scripts/report-check-coverage.mjs` (root script `checks:coverage`) runs in the `quality` job. It prints `::warning` annotations and a job-summary table for every check that no package defines. Tested: 0 packages → 4 warnings, exit 0; simulated GitHub → annotations and summary table written; a fixture with 2 packages → correct counts. A Node DEP0190 warning on Windows was fixed by using a constant command string.
- **Permissions hardened:** workflow-level `permissions: {}`; checkout jobs get `contents: read`; `CI OK` gets `{}`.
- **Untrusted-PR review:** `pull_request` only (no `pull_request_target`), 0 `secrets.*` references, 0 write permissions, 0 `github.event.*` values in `run:` scripts, no caches, GitHub-owned SHA-pinned actions only. Details in `docs/ci.md` § Security review.
- **shellcheck checksum resolved:** the download matched GitHub's release-asset SHA-256 digest (`8a4e35ab…a2e740e`, 8,068,167 bytes).
- actionlint + shellcheck re-run on the final workflow: 0 errors.

**Still unverified (needs the GitHub repository):** GitHub execution of all jobs; **merge protection** (CI does **not** block merges until a ruleset or branch protection requires `CI OK`); Node 26 on `ubuntu-24.04` via `setup-node` v7.0.0; `npm --allow-scripts` on the runner; actual CI duration.

### S0.3 report (2026-10-14)

**Scope interpretation:**
- The full planned stack was verified in a **scratch workspace**, not in the repository.
- The repository installs **only what is used now**, the `@dm/config` toolchain. Runtime libraries are installed by the stories that use them, from the catalog.
- All pins live in the **`catalog:` in `pnpm-workspace.yaml`**.

**Main finding: supply-chain age.** 21 of the Phase 1 pins had been published within the previous 14 days (some that same day). A 14-day minimum release age was added (`minimumReleaseAge: 20160`, enforced by pnpm), and the affected pins moved back within the same major line. **next** (16.4.0 → 16.3.7) and **@playwright/test** (1.64.0 → 1.63.0) each moved back one minor version. Full list in ADR-006.

**Acceptance criteria:**
| AC | Status |
|---|---|
| (1) Exact versions installed on Node 26.4 | ✅ Full set: scratch install of 594 packages, every library loaded or exercised, every CLI run. Repository: `@dm/config` toolchain at exact catalog versions (98 packages). |
| (2) Peer warnings reviewed; accepted ones documented | ✅ Scratch: **1 upstream peer conflict** (`htmlnano` wants `cssnano ^8`, gets 7.1.9, inside MJML), accepted and documented; MJML minify verified working. Repository: **no peer issues**. Install scripts: 5 reviewed and denied (`allowBuilds`), each dependent tool verified to work without them. |
| (3) Version changes recorded in ADR-006 with reasons | ✅ ADR-006 "S0.3 revision": 18 re-pins, 4 additions, 4 deferrals, 1 exception, 1 accepted peer warning, 5 build-script denials |

**Checks run:**
| Check | Result |
|---|---|
| Publish date of every pin (npm registry) | 21 of 32 were younger than 14 days → re-pinned |
| Scratch install with `minimumReleaseAge` | First attempt **rejected** (next 16.3.8, pg 8.23.1, @fastify/swagger 9.9.1, sesv2 3.1144.0 and transitive deps were < 14 days old), so the rule works. Re-pinned with a 2026-09-29 cutoff, after which it **resolved 594 packages**. |
| Scratch install build-script gate | Stopped on 7 unapproved scripts; 5 packages reviewed and denied; install exit 0 |
| `pnpm peers check` (scratch) | 1 issue: `htmlnano` → `cssnano ^8` (accepted, see above) |
| Node 26 load and behaviour checks (19) | ✅ All OK: argon2 native hash+verify; Liquid escaping; MJML compile + minify; zod; Fastify + zod provider (200/400); pino; pg; drizzle; ioredis; BullMQ import; undici custom lookup; SESv2 command; testcontainers import; React SSR; next resolves |
| Follow-ups to two weak checks | otplib: a real TOTP generate + verify (valid true, wrong code false). SESv2: `TenantName` confirmed on `SendEmailRequest` in the SDK types. |
| CLIs | tsc 6.0.3, eslint 10.11.0, prettier 3.9.9, turbo 2.11.5, drizzle-kit 0.31.11, playwright 1.63.0, next 16.3.7, vitest 5.0.2 |
| Real vitest run (TypeScript test) | ✅ 1 passed |
| esbuild without its install script (0.18.20, 0.25.12, 0.28.2) | ✅ All transform TypeScript |
| Repo `pnpm install`, then a clean `--frozen-lockfile` install | ✅ 98 packages; `pnpm peers check`: no issues |
| Repo `pnpm run lint` / `typecheck` | ✅ Exit 0, real checks on `@dm/config` |
| Negative tests in `@dm/config` (planted unused variable, planted type error) | ✅ eslint exit 1 and tsc exit 2; both pass again after removal |
| Consumer fixture using `@dm/config` exports | ✅ Type-aware lint caught `no-floating-promises` (and 2 more); `noUncheckedIndexedAccess` caught TS2322; the fixed code passes |
| `checks:coverage` | lint 1, typecheck 1, test:unit 0, test:integration 0 (warnings shown) |

**Note:** pnpm placed its content-addressable store at `D:.pnpm-store` (drive root, outside the repository).

### S0.6 report (2026-10-14)

**Built:** `packages/shared` (`@dm/shared`), exporting TypeScript source (**ADR-016**, proposed):
- **`loadConfig()`** (zod 4): base settings (`APP_ENV`, `LOG_LEVEL`, `SENDING_MODE`, live approvals) plus composable shapes for the database, Valkey and HTTP. Fails fast with **every** problem listed by variable name, **never the value**. Empty strings count as unset, and the result is frozen.
- **Cross-field rules:** `live` only when `APP_ENV=production` **and** both approval variables are set (ADR-011); the queue and cache Valkey URLs must differ (ADR-004).
- **`createLogger()`** (pino): JSON with level label, service, env and ISO time. Redacts passwords, tokens, secrets, API keys, cookies, authorization headers and connection URLs at the top level and up to two levels deep. `redactUrl()` masks passwords in URLs for safe config logging.
- **Request IDs:** a well-formed incoming `X-Request-ID` is reused, otherwise a UUID is generated. It appears as `request_id` on every request log line and is echoed in the response header. Uses Fastify 5.12's `LogController`; the deprecated option was removed after a warning appeared in testing.
- **`registerHealthRoutes()`:** `GET /health` (liveness, no dependency calls) and `GET /ready` (readiness: checks run in parallel with per-check timeouts, 503 on failure, **error details logged server-side, never returned**). Probes: `postgresCheck` (`select 1`) and `valkeyCheck` (`PING`).
- **Base tsconfig:** added `erasableSyntaxOnly` and `rewriteRelativeImportExtensions` (ADR-016).
- **Catalog:** added `@types/pg` 8.23.1 (2026-08-17, satisfies the 14-day rule).
- **`.env.example`:** now complete (runtime, sending, database, Valkey and HTTP variables, plus the docker-compose ones).

**Acceptance criteria:**
| AC | Status |
|---|---|
| (1) zod loader fails fast with a clear message | ✅ Tested: all problems in one error, by name; allowed values listed; secrets never echoed (tested with a planted secret in 3 variables) |
| (2) `.env.example` complete | ✅ Tested: it parses into a valid config, and every variable in the shared schemas is documented in it |
| (3) pino JSON logs include `request_id` | ✅ Tested through a real Fastify server: every request line carries the same `request_id`; reused or generated as appropriate; unsafe IDs (log injection, too long) are replaced |
| (4) Secrets redacted; tested | ✅ 8 planted secrets (top level, nested, headers, connection URL) absent from the output. **Limit:** keys nested deeper than two levels aren't matched; avoid logging deep objects that contain secrets. |
| (5) `/health` and `/ready` for each app; `/ready` checks the DB and both Valkey instances | 🟡 **Partly met.** The reusable plugin and the Postgres and Valkey probes are built and tested (fakes, timeouts, and real `pg`/`ioredis` clients against a closed port). **Not done:** per-app wiring (no apps until S0.8), and `/ready` against a *running* Postgres and Valkey (needs Docker). **Proposed amendment S0.6-A** moves these to S0.8 and S0.1-C/S0.4. |
| (6) `SENDING_MODE` defaults to `sink`; `live` rejected outside production; tested | ✅ Default tested; `live` rejected in development, test and staging (even with approvals) and in production without both approvals; accepted only in production with both |

**Checks run:**
| Check | Result |
|---|---|
| Node 26 native TypeScript (scratch) | ✅ `.ts` imports run; `enum` rejected (non-erasable) |
| `@dm/shared` typecheck / lint | ✅ After fixes. Lint found 9 issues in the first draft, and typecheck found the Fastify helpers didn't accept a pino-typed app (would have broken S0.8); both fixed. |
| `@dm/shared` unit tests (Vitest) | ✅ **45 passed**, 4 files (config 21, logger 6, request IDs 9, health 9) |
| Mutation check (3 deliberate breakages, then restored) | ✅ All caught: redaction off → 1 failure; live rule removed → 3 failures; `/ready` always 200 → 1 failure. 45/45 pass after restore. |
| Plain-Node import of `src/index.ts` (no Vitest) | ✅ 20 exports; config, `redactUrl` and the fail-fast message work |
| Repo: frozen install, peers, lint, typecheck, test:unit, test:integration | ✅ All exit 0; no peer issues |
| `checks:coverage` | lint 2, typecheck 2, **test:unit 1 (45 tests)**, test:integration 0 (warned) |
| gitleaks on the working tree | ✅ No leaks (including the local example `DATABASE_URL`) |
| `git diff --check` | ✅ Clean |

### S0.8 report (2026-10-14)

**Built:**
- **Six apps:**
  - `web` (Next.js 16.3.7, App Router, standalone output; `/health` and `/ready` route handlers; Playwright smoke test);
  - `api`, `tracker`, `worker`, `webhook-worker` and `admin` (Fastify via `@dm/shared`). Each connects only its own dependencies and listens on ports 3001–3005 (`apps/README.md`).
- **New in `@dm/shared`:**
  - `connectDependencies()`: pg pool and Valkey clients with readiness checks; logs URLs without passwords and deduplicates repeated connection errors;
  - `startHttpService()` / `buildHttpService()`: logging, request IDs, `/health`, `/ready`, graceful SIGTERM/SIGINT shutdown;
  - `loadConfigOrExit()`: prints the clear config message and exits 1, with no stack trace.
- **Root scripts:** `dev`, `build`, `test:e2e`, and `smoke:apps` (`scripts/smoke-apps.mjs`). `checks:coverage` now also tracks `build` and `test:e2e`.
- **CI:**
  - `quality` job gains `build` and `smoke:apps`;
  - new `e2e` job (Playwright Chromium on the runner);
  - `CI OK` requires all four jobs;
  - `NEXT_TELEMETRY_DISABLED=1`.
- **Shared presets:** Node globals for `.js`/`.mjs` files (`globals` 17.12.0).
- **Catalog additions:** `@types/react` / `@types/react-dom` 19.3.0 and `globals` 17.12.0, all at least 14 days old.
- **`.gitignore`:** `next-env.d.ts` (generated).
- **ADR-016 application:** Node apps run from TypeScript source with no build step, and `web` runs the standalone `server.js`.

**Acceptance criteria:**
| AC | Status |
|---|---|
| (0) `pnpm dev` starts every app | ✅ Ran `pnpm dev` with the `.env.example` values exported in the shell (no `.env` file created). All six answered `/health` 200 within about 2 s; Node apps' `/ready` gave 503 (no Docker), web's `/ready` gave 200. Every process was then stopped by its root PID and ports 3000–3005 were confirmed free. |
| (0b) Every app exposes `/health` and `/ready` with its own checks | ✅ `smoke:apps`: each Node app's `/ready` lists exactly its checks; web has none, by design (no direct DB or Valkey access) |
| (1) All six apps build | ✅ `web`: `next build` succeeds. Node apps: per ADR-016 there is no compile step; "build" = typecheck ✅ + start ✅ (`smoke:apps`). |
| (2) Playwright smoke test loads the web health page | ✅ 4/4 passed in installed Chrome against the standalone server: `/health` in a real browser, `/ready`, home page title and heading, no `x-powered-by` header |
| (3) Worker sample job inside `withTenant`, integration-tested | ⏸ **Not done.** Needs `withTenant` (S0.4) and BullMQ (S0.7), both of which need Docker. **Proposed amendment S0.8-A:** move to S0.7. |

**Checks run:**
| Check | Result |
|---|---|
| Node type stripping through the `node_modules/@dm/shared` symlink | ✅ Resolves to `packages/shared/src/index.ts`; loads |
| `@dm/shared` typecheck / lint / tests | ✅ **56 tests** (6 files). Typecheck caught that `buildHttpService` lost the pino logger type, and `observabilityServerOptions` was made generic to fix it. |
| Five Node apps: typecheck and lint | ✅ All clean |
| `smoke:apps` (local) | ✅ **28/28 checks**. Graceful-shutdown checks are skipped on Windows (SIGTERM force-kills) and run in CI on Linux. |
| `web`: `next build`, typecheck (`next typegen` + tsc), lint | ✅ After 2 fixes: dot-notation in the Playwright config, and Node globals for `.mjs` in the preset |
| `web`: Playwright | ✅ 4/4. A first run with `next start` warned that it doesn't support standalone output, so `start` now runs the standalone server. |
| Full CI sequence locally, from a clean install | ✅ frozen install, peers, coverage, lint (9 s), typecheck (5 s), unit (3 s), integration (1 s), build (6 s), smoke (4 s), e2e (3 s), all exit 0 |
| actionlint + shellcheck on the updated workflow | ✅ 0 errors. No `pull_request_target`, no secrets, no write permissions. |

**GitHub CI (PO report, 2026-10-14):** the run for `0bbc51a` **passed**, including the new `e2e` job and `smoke:apps`, so graceful shutdown on Linux passed. Claude has no Actions access, so this wasn't verified independently. **CI duration not yet recorded** (S0.2 AC 3).

**Found during review:**
- **`apps/web/AGENTS.md` and `CLAUDE.md` were generated by `next dev`** (Next.js 16 writes them when it detects an AI coding agent; confirmed in `next/dist/server/lib/generate-agent-files.js`). They contain Next.js's generic "read the bundled docs" instructions. **PO decision (2026-10-14): not tracked; gitignored.**
- **gitleaks `dir` reports 9 `generic-api-key` findings, all inside the gitignored `apps/web/.next/`.** These are the per-build preview and server-action keys Next.js generates. None are in tracked or candidate files, and CI scans git history only. **Sprint 2 note:** container images must not bake in per-build keys inconsistently across instances; set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` from Secrets Manager (track in S2.6).

## Open technical items

| # | Item | Needed by | Notes |
|---|---|---|---|
| T1 | Choose a local S3 emulator (`minio/minio` is no longer on Docker Hub, checked 2026-10-14). Removed from S0.1 (approved); now a prerequisite of S5.1. | Sprint 3, before S5.1 | Candidates: RustFS 1.0.1, SeaweedFS, Adobe S3Mock. Check licence and S3 API coverage. |
| S0.1-C | **Carry-over:** `docker compose config`, `pnpm infra:up` (`up -d --wait`), health checks pass for postgres and both Valkey instances, mailpit and elasticmq running, README walkthrough including the Docker steps | When B2 is resolved; **before S0.4** | Includes Mailpit and ElasticMQ health behaviour (no healthchecks defined for them yet) |
| T4 | Align local Postgres and Valkey minors with what RDS and ElastiCache offer in ap-south-1 | S2.6 | Local pins: postgres 18.6, valkey 8.1.10 |

## Decisions awaiting approval

| # | Decision | Recommendation | Needed by |
|---|---|---|---|
| D6 | Beta assumptions: about 25 tenants, about 2M emails/month | Confirm or correct | Sprint 2 |
| D7 | AWS Organizations with separate staging and production accounts; billing owner | Approve | Sprint 2 |
| D8 | Brand and domains (app, tracking/unsubscribe, preview, system mail, MAIL FROM) | Provide | Sprint 2 |
| D9 | Editor scope: block editor plus MJML/HTML code mode | Approve | Sprint 4 |
| D10 | Payment provider: Razorpay | Razorpay | Sprint 8 |
| D11 | Pricing and plans; trial vs free tier | Trial plus review | Sprint 8 |
| D12 | Abuse-review owner and SLA (including the 2-business-day suppression re-check SLA) | Assign | Sprint 7 |
| D13 | Legal: ToS, AUP, privacy policy, DPA, DPDP notice, grievance contact, CERT-In contact | Engage counsel | Before beta |

**Approved by the PO (2026-10-14), S0.8:**
- **S0.8-A:** AC (3) moved to S0.7.
- **`apps/web/AGENTS.md` / `CLAUDE.md`:** not tracked; added to `.gitignore` (local files kept, since `next dev` regenerates them).
- **S0.8 commit** approved.

**Approved by the PO (2026-10-14), S0.6:**
- **S0.6-A:** per-app `/health` and `/ready` wiring moved to S0.8; the live `/ready` check against running Postgres and Valkey moved to S0.4.
- **ADR-016** accepted.
- **S0.6 commit** approved.

**pnpm exception approved by the PO (2026-10-14):** pnpm **12.11.2** (published 2026-10-09) is younger than the 14-day rule. It is accepted as an exception, because it was adopted in S0.1 before the rule and ran in CI, and will be replaced at the next tool upgrade (ADR-006).
**S0.3 commit:** approved by the PO (2026-10-14).

Approved: D1 (plan), D2 (suppression scope, with safeguards), D3 (unsubscribe scope), D4 (guardrails, with safeguards), S0.1-A (S0.1 AC amendment). All on 2026-10-14.
**D5 recorded (2026-10-14):** Option B (lean beta) preferred, **subject to a verified AWS Pricing Calculator estimate before any provisioning** (S2.7).
**S0.1 commit:** approved by the PO and created as `df3a7cd` (38 files) on 2026-10-14.
**S0.2 commit:** approved by the PO and created as `7563d15d5c8b2eea3436a15d9b04359a2761a4bf` (7 files) on 2026-10-14.

## Blockers

| # | Blocker | Impact | Action needed |
|---|---|---|---|
| B6 | **GitHub setup incomplete** (repository exists and `main` is pushed) | Merges not yet protected; CI duration not yet recorded | The repository is `vatsuday/Dhanuka_mails` (private, personal account; the actual name differs from the planned `dhanuka-mails`). Pushed 2026-10-14 with the PO's authorisation. **First CI run: passed (PO report, 2026-10-14).** A pass implies Node 26 via `setup-node` and the pnpm install worked on the runner, since the `quality` and `integration` jobs depend on both. Still zero package checks (see `docs/ci.md`). **Remaining:** (1) apply the Actions settings and the `CI OK` ruleset (`docs/ci.md`); **until then CI does not block merges**; (2) record the actual CI duration from the run page (S0.2 AC 3). |
| B2 | Docker Desktop not installed | S0.1 AC (2) and (3), and S0.4, S0.5, S0.7 | **The PO is installing** Docker Desktop (WSL2) |
| B4 | AWS accounts and SES production access | Sprint 2 | Create accounts by Sprint 2 |
| B5 | Domains (D8) | Sprint 2 | Product owner provides them |

## Known issues and risks

- Dependency versions are checked against registry metadata only. The real install happens in S0.3 (fallbacks: Node 24, BullMQ 5, PG 17).
- SES tenant suppression, `TenantName` in SDK v3, DKIM coverage of the unsubscribe headers, PG 18 on RDS and Valkey persistence are unverified until spike S2.6.
- The cost estimate is indicative until S2.7.
- Gmail complaints aren't visible through SES; monitoring relies on Postmaster Tools.
- DPDP and CERT-In obligations need counsel confirmation (D13).
- Sprints 3, 4, 7, 8 and 9 are planned at 32 points against an assumed velocity of 30. Re-forecast after Sprint 1.
