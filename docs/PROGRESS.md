# Progress Checklist

**Current phase:** Phase 2 — MVP build
**Current sprint:** Sprint 0 (Foundation)
**Current task:** S0.2 (CI pipeline) **committed at `7563d15d5c8b2eea3436a15d9b04359a2761a4bf`** (2026-10-14). CI has not run on GitHub and **does not block merges** (no repository or ruleset yet, B6). **S0.3 will not start until the repository setup is reviewed and the PO approves.**
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
| S0.3 Toolchain pinning | ⚪ Not started | pnpm is now available |
| S0.4 DB foundation and RLS | ⚪ Not started | Needs Docker (B2). **S0.1-C must be completed first.** |
| S0.5 Isolation harness | ⚪ Not started | Needs Docker (B2) |
| S0.6 Config, logging, health | ⚪ Not started | |
| S0.7 Queue spike | ⚪ Not started | Needs Docker (B2) |
| S0.8 App skeletons | ⚪ Not started | |

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

Approved: D1 (plan), D2 (suppression scope, with safeguards), D3 (unsubscribe scope), D4 (guardrails, with safeguards), S0.1-A (S0.1 AC amendment). All on 2026-10-14.
**D5 recorded (2026-10-14):** Option B (lean beta) preferred, **subject to a verified AWS Pricing Calculator estimate before any provisioning** (S2.7).
**S0.1 commit:** approved by the PO and created as `df3a7cd` (38 files) on 2026-10-14.
**S0.2 commit:** approved by the PO and created as `7563d15d5c8b2eea3436a15d9b04359a2761a4bf` (7 files) on 2026-10-14.

## Blockers

| # | Blocker | Impact | Action needed |
|---|---|---|---|
| B6 | **No GitHub repository or remote** | CI can't run, merges can't be blocked, runtime can't be measured (S0.2 AC 1–3 on GitHub) | **PO decision (2026-10-14):** a **private** repository named **`dhanuka-mails`** under the PO's **personal** GitHub account. The PO creates it. Claude must **not** add the remote, authenticate or push until the PO confirms the repository exists **and** explicitly authorises the push. Then apply the Actions settings and the `CI OK` ruleset (`docs/ci.md`). |
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
