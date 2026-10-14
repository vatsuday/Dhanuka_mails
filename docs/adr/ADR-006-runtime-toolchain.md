# ADR-006: Runtime and toolchain versions

**Status:** Accepted (Phase 1 approval, 2026-10-14). **Revised in S0.3 (2026-10-14)** after a real install and verification, before PO review of S0.3. · **Date:** 2026-10-14

## Context (checked 2026-10-14)
- **Installed:** Node v26.4.0.
- **Node 24** moves to maintenance on 2026-10-20. **Node 26** becomes LTS on 2026-10-28.
- **corepack** is not bundled with the installed Node.
- **TypeScript 7.0.2** is the latest release, but typescript-eslint only supports TypeScript `<6.1.0`.
- **Drizzle 1.0** is still a release candidate.
- **BullMQ 6** was released 2026-07-30.

## Decision
- **Node 26.** Every pinned package installs and loads on Node 26.4.0 (verified in S0.3). Fallback: Node 24.x, maintained until 2028-04-30.
- **pnpm 12.11.2**, installed with `npm install -g --allow-scripts=pnpm` and pinned through the `packageManager` field.
  - pnpm 12 reads its settings from `pnpm-workspace.yaml`.
- **Version source of truth:** the **`catalog:` in `pnpm-workspace.yaml`**. Packages reference versions with `catalog:`. Versions are exact (`savePrefix: ""`) and the lockfile is committed.
- **Version lines:** TypeScript **6.0.x** (not 7.x), Drizzle **0.45.x** (not the 1.0 RC), BullMQ **6.x** (subject to spike S0.7).
- **Supply-chain rules (added in S0.3):**
  1. **Minimum release age of 14 days** for every direct and transitive dependency, enforced by pnpm (`minimumReleaseAge: 20160`). New versions arrive through Renovate PRs only after they've aged.
  2. **Install scripts are denied unless reviewed.** Each denial or approval is recorded in `allowBuilds` with its reason.
  3. **GitHub Actions and downloaded CI tools** are pinned to commit SHAs or checksums, and the versions chosen must be at least 14 days old (S0.2).

## S0.3 revision: changes from the Phase 1 plan, with reasons

**1. Versions moved back by the 14-day rule.** Phase 1 pinned "latest on 2026-10-14", and 21 of those pins were published within the previous 14 days (some on the same day). Each was re-pinned to the newest version published on or before 2026-09-29, within the same major line:

| Package | Planned | Pinned | Package | Planned | Pinned |
|---|---|---|---|---|---|
| turbo | 2.11.8 | 2.11.5 | drizzle-orm | 0.45.4 | 0.45.3 |
| eslint | 10.12.0 | 10.11.0 | pg | 8.23.1 | 8.23.0 |
| typescript-eslint | 8.71.2 | 8.71.0 | bullmq | 6.3.15 | 6.3.10 |
| next | 16.4.0 | **16.3.7** (minor back) | liquidjs | 10.30.0 | 10.29.0 |
| fastify | 5.12.7 | 5.12.5 | @aws-sdk/client-sesv2 | 3.1151.0 | 3.1142.0 |
| zod | 4.6.7 | 4.6.5 | undici | 8.12.1 | 8.11.2 |
| @node-rs/argon2 | 2.2.2 | 2.2.1 | pino | 10.4.0 | 10.3.1 |
| vitest | 5.0.4 | 5.0.2 | testcontainers | 12.2.1 | 12.2.0 |
| @playwright/test | 1.64.0 | **1.63.0** (minor back) | @types/node | 26.x | 26.6.3 |

**2. Added:**
- `@eslint/js` 10.0.1, for the flat-config recommended rules;
- `@fastify/swagger` 9.9.0 and `openapi-types` 12.1.3, required (non-optional) peers of `fastify-type-provider-zod` 7.0.0;
- `prettier` 3.9.9, which was listed as "pin in Sprint 0".

**3. Deferred:**
- **turbo:** catalogued but not installed. `pnpm -r` runs the checks until there is a build graph worth caching.
- **Prettier wiring:** until there is source code (S0.4).
- **dependency-cruiser:** until there are module boundaries to enforce.
- **CI dependency cache:** the toolchain install is 98 packages; revisit when install time matters.

**4. Accepted exception:** pnpm 12.11.2 was published 2026-10-09, so it is younger than 14 days. It was adopted in S0.1, before this rule existed, and it ran in CI. It will be replaced by a version at least 14 days old at the next tool upgrade. **Approved by the product owner on 2026-10-14.**

**5. Accepted peer warning (upstream):** `mjml-core 5.4.1 → htmlnano 3.3.1` declares peer `cssnano ^8` but resolves `cssnano 7.1.9`. It can't be fixed by pinning, and MJML compilation **with `minify: true`** was verified to work. Revisit when MJML updates htmlnano. (In the repository there are currently no peer issues, because MJML isn't installed yet.)

**6. Denied install scripts (reviewed):**
- `cpu-features` and `ssh2` (testcontainers SSH support, which we don't use);
- `esbuild` (post-install binary check; all three versions, 0.18.20, 0.25.12 and 0.28.2, transformed TypeScript correctly without it);
- `msgpackr-extract` (optional native accelerator for BullMQ);
- `protobufjs` (post-install check).

## Verification evidence (S0.3)
**Scratch workspace** (all pins together, `minimumReleaseAge` enforced): 594 packages resolved, and the install succeeded after the build-script review.
- **Load and behaviour checks on Node 26.4.0:**
  - argon2 hash and verify (native binary);
  - LiquidJS HTML escaping;
  - MJML compile, plain and minified;
  - zod parse;
  - Fastify request validation through the zod provider (200 and 400);
  - otplib TOTP generate and verify;
  - React server render;
  - `TenantName` present on SES `SendEmailRequest`;
  - construction of pg, drizzle, ioredis, BullMQ, undici and testcontainers objects.
- **CLIs run:** tsc, eslint, prettier, turbo, drizzle-kit, playwright, next and vitest. A real vitest TypeScript test run passed.

**Repository:** `@dm/config` toolchain installed (98 packages, no peer issues), and a clean `pnpm install --frozen-lockfile` succeeds.
- `lint` and `typecheck` pass, and fail correctly on planted errors.
- A consumer-package fixture showed that the presets enforce type-aware rules (`no-floating-promises`) and strict compiler options (`noUncheckedIndexedAccess`).

**Not yet verified:** BullMQ behaviour against Valkey (S0.7), Testcontainers starting containers (needs Docker), Playwright browsers (S0.8), real SES behaviour (S2.6).

## Revisit when
- typescript-eslint supports TypeScript 7;
- Drizzle 1.0 reaches GA;
- Node 28 becomes LTS;
- the next pnpm upgrade happens (to resolve the pnpm 12.11.2 exception).
