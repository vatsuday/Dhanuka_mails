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
- **Apps decide their own build** in S0.8. Next.js compiles workspace packages itself. Node services can run the TypeScript directly or be bundled for the container; that is decided in S0.8 and recorded there.

## Consequences
- No `dist/` folders and no build ordering between internal packages.
- Contributors must use erasable syntax only. The compiler enforces this, and the shared presets catch it.
- Published (npm) packages would need a build; we publish none.
- If a dependency on Node's type stripping becomes a problem (performance, edge cases), the fallback is a per-package `tsc` build to `dist/`. The exports field would then change from `src/*.ts` to `dist/*.js`.

## Verification (S0.6)
- `node --input-type=module -e "await import('./src/index.ts')"` in `packages/shared` loaded all 20 exports.
- `loadConfig` and `redactUrl` ran, and the fail-fast `ConfigError` message printed correctly.
