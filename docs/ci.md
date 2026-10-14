# CI Pipeline

**Workflow:** `.github/workflows/ci.yml` (story S0.2)
**Status:** Defined and validated locally (2026-10-14). **Not yet run on GitHub.** The repository has no remote (blocker B6). **CI does not block merges yet.** It only will once a GitHub ruleset or branch protection rule on `main` requires the `CI OK` check to pass (see "Required GitHub settings").

> **Check coverage (current, after S0.8):** eight workspace packages.
> - `lint` and `typecheck` run on all of them.
> - `test:unit` runs **56 tests** in `@dm/shared`.
> - `build` and `test:e2e` run on `@dm/web` (4 Playwright tests).
> - `smoke:apps` boots all five Node apps.
> - `test:integration` still **executes no checks**, and the `checks:coverage` step warns about it. Integration tests arrive with S0.4/S0.5 (Docker / Testcontainers).

## Triggers

Pull requests to `main`, pushes to `main`, and manual runs (`workflow_dispatch`). A newer push to the same PR cancels the older run.

## Jobs

| Job | What it does | Time limit |
|---|---|---|
| `secret-scan` | Downloads gitleaks **8.30.1** (SHA-256 verified) and scans the **full git history** (`gitleaks git --redact --exit-code 1`) | 10 min |
| `quality` | Node from `.nvmrc`, pnpm **12.11.2** (version asserted), `pnpm install --frozen-lockfile`, **`pnpm run checks:coverage`** (reports and warns about zero-check steps), then `pnpm run lint`, `typecheck`, `test:unit`, **`build`**, and **`smoke:apps`** (boots every Node app: `/health` 200, `/ready` 503 with exactly that app's checks, fail-fast config, graceful SIGTERM shutdown) | 15 min |
| `integration` | Same setup, then `docker version` and `pnpm run test:integration` (Testcontainers uses the runner's Docker) | 15 min |
| `e2e` | Same setup, then `playwright install --with-deps chromium`, `pnpm run build`, `pnpm run test:e2e` (Playwright against the standalone Next.js server) | 15 min |
| `ci-ok` | Runs always. **Fails unless all four jobs above succeeded**, so a skipped or cancelled job also fails it. | 5 min |

The jobs run in parallel, so a run should finish in under 15 minutes (S0.2 AC 3). The time limits enforce this: a job that runs over is cancelled and the run fails.

## How package checks are discovered

The root scripts fan out to the workspace packages:

```
lint             -> pnpm -r --if-present run lint
typecheck        -> pnpm -r --if-present run typecheck
test:unit        -> pnpm -r --if-present run test:unit
test:integration -> pnpm -r --if-present run test:integration
```

- **Adding checks:** a package opts in by defining the script. Packages without it are skipped.
- **Failures:** any failing package fails the root command, which fails the job (verified with a fixture workspace).
- **⚠️ Current state (after S0.8):** lint and typecheck cover all 8 packages; unit tests cover `@dm/shared`; e2e covers `@dm/web`. **Integration tests run zero checks** until S0.4/S0.5.

## Supply-chain controls

- **Actions pinned to commit SHAs:**
  - `actions/checkout` v7.0.1 → `3d3c42e5aac5ba805825da76410c181273ba90b1`
  - `actions/setup-node` v7.0.0 → `820762786026740c76f36085b0efc47a31fe5020`. v7.0.0 rather than v7.1.0, which had been public for only 6 days.
- **Downloaded tools are checksum-verified:** gitleaks `linux_x64` SHA-256 `551f6fc8…f2470eb`, from the official release checksums file.
- **Least privilege:** workflow-level `permissions: {}`; jobs that check out code get only `contents: read`; `CI OK` gets none. `persist-credentials: false` on every checkout.
- **Fixed runner image** (`ubuntu-24.04`) instead of `ubuntu-latest`.
- **No real email from CI:** `SENDING_MODE=sink` (ADR-011).

## Security review: untrusted pull-request code (2026-10-14)

| Risk | Status |
|---|---|
| Secrets exposed to PR code | **None used.** The workflow references no `secrets.*`. It is triggered by `pull_request`, never `pull_request_target`, so fork PRs get a read-only token and no repository secrets. |
| Token abuse | `permissions: {}` by default; at most `contents: read`; no write scope anywhere |
| Credential persistence | `persist-credentials: false`, so the token isn't left in `.git/config` for later steps |
| Script injection | No `github.event.*` value is interpolated into `run:` scripts. The only expressions are in `concurrency` and `toJSON(needs)`, which is passed through `env`, not inlined. |
| Cache poisoning | No caches are used |
| Third-party code | Only GitHub-owned actions, SHA-pinned. gitleaks is checksum-verified. |
| Dependency install scripts | `pnpm install` runs inside the job with a read-only token and no secrets. pnpm blocks dependency build scripts unless they are explicitly allowed. |
| `workflow_dispatch` | In a private repository, only people with write access can trigger it |

**Repository settings to apply when the GitHub repository exists** (Settings → Actions → General):
- Actions permissions: allow only actions by GitHub, or a specific allow-list.
- Workflow permissions: **Read repository contents**; leave **"Allow GitHub Actions to create and approve pull requests" off**.
- Fork pull-request workflows: private repositories have these disabled by default. Keep them disabled. If ever enabled, require approval and **do not** send secrets or write tokens to fork workflows.

**Rule for future changes:** any job that needs a secret (deploys in Sprint 2+) must run only on `push` to `main` or on protected environments with required reviewers, **never** on `pull_request` from untrusted code. Use OIDC for AWS instead of long-lived keys.

## Required GitHub settings (to make failures block merges: S0.2 AC 2)

Once the repository exists on GitHub, apply a **branch ruleset** (or classic branch protection) to `main`:

1. Require a pull request before merging, with at least 1 approval once there is more than one contributor.
2. **Require status checks to pass:** add **`CI OK`**, and require branches to be up to date before merging.
3. Block force pushes and block deletions.
4. Optional: require linear history and signed commits.

Only `CI OK` needs to be required, because it aggregates every job. New jobs must be added to its `needs` list.

## Validating locally

| Check | Tool |
|---|---|
| Workflow syntax, expressions and shell scripts | `actionlint` 1.7.12 with `shellcheck` 0.11.0 |
| Secrets in history and working tree | `gitleaks git .` and `gitleaks dir .` (8.30.1) |
| Root scripts | `pnpm run lint`, `typecheck`, `test:unit`, `test:integration` |

These tools are **not** project dependencies. They were run from the session scratch directory. Their integrity was checked as follows:
- actionlint, gitleaks and jq: against the official release checksum files.
- **shellcheck 0.11.0:** the project publishes no checksum file, so the download was verified against **GitHub's release-asset SHA-256 digest** (`sha256:8a4e35ab0b331c85d73567b12f2a444df187f483e5079ceffa6bda1faa2e740e`, 8,068,167 bytes), which matched.
- shellcheck isn't used by the CI workflow itself.

## Not yet verified (requires the GitHub repository)

| Item | Why it's unverified |
|---|---|
| GitHub execution of all jobs | No remote; the workflow has never run on GitHub |
| **Merge protection** | Needs a ruleset or branch protection on `main` requiring `CI OK`. **Until then, CI does not block merges.** |
| Node 26 on `ubuntu-24.04` through `setup-node` v7.0.0 + `.nvmrc` | Not yet executed |
| Actual CI duration (AC 3, under 15 min) | Not measured. Only the per-job limits (≤ 15 min) are configured. |
| `npm install -g --allow-scripts=pnpm` on the runner's npm | Not yet executed |

## Other known gaps

- **No dependency caching (deferred in S0.3, ADR-006):** the toolchain install is 98 packages. Revisit when install time matters. When added, key it on the lockfile and save only from `push` to `main`, to avoid cache poisoning from pull requests.
- **Supply-chain rule:** `pnpm install --frozen-lockfile` in CI also checks the lockfile against `minimumReleaseAge` (14 days) and the `allowBuilds` policy in `pnpm-workspace.yaml`.
