# ADR-016: Internal packages ship TypeScript source (no build step)

**Status:** Accepted (PO approval, 2026-10-14) · **Date:** 2026-10-14

## Context
Workspace packages such as `@dm/shared` and `@dm/config` are consumed only inside this monorepo. A build step per package (tsc to `dist/`) would need build orchestration (turbo was deferred in ADR-006) and would make "edit, run, test" slower.

Node 26 runs TypeScript files directly, by stripping type annotations, for code that uses only **erasable** syntax. Verified on 2026-10-14 with Node 26.4.0:
- `.ts` files with `.ts` relative imports and `import type` ran correctly;
- an `enum` (non-erasable) was rejected.

## Decision
- **Internal packages export their TypeScript source**, for example `"exports": { ".": "./src/index.ts" }`. Node 26 runs it directly, Vitest transforms it in tests, and `tsc` only typechecks (`noEmit`).
- The shared base tsconfig (`@dm/config/tsconfig.base.json`) enforces this with:
  - `erasableSyntaxOnly: true`: no `enum`, `namespace`, parameter properties or other syntax that needs emitting;
  - `rewriteRelativeImportExtensions: true`: relative imports use real `.ts` file extensions.
- **How the apps run (decided in S0.8):**
  - **Node services** (`api`, `tracker`, `worker`, `webhook-worker`, `admin`) have **no build step**. `start` is `node src/main.ts`, and `dev` adds `--watch` and `--env-file-if-exists=../../.env`. Node follows the workspace symlink to `packages/shared/src/index.ts`, outside `node_modules`, so type stripping applies (verified in S0.8). For these apps, "build" means typecheck plus a successful start, both checked in CI (`typecheck` and `smoke:apps`).
  - **`web`** is built with `next build` (`output: 'standalone'`). `start` runs the standalone `server.js` through `apps/web/scripts/start.mjs`, the same way the container will.
  - Container images come in Sprint 2 (S2.6).

## Consequences
- No `dist/` folders and no build ordering between internal packages.
- Contributors must use erasable syntax only. The compiler enforces this, and the shared presets catch it.
- Published (npm) packages would need a build; we publish none.
- If a dependency on Node's type stripping becomes a problem (performance, edge cases), the fallback is a per-package `tsc` build to `dist/`. The exports field would then change from `src/*.ts` to `dist/*.js`.

## Verification (S0.6)
- `node --input-type=module -e "await import('./src/index.ts')"` in `packages/shared` loaded all 20 exports.
- `loadConfig` and `redactUrl` ran, and the fail-fast `ConfigError` message printed correctly.
