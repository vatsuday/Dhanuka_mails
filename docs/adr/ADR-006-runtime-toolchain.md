# ADR-006: Runtime and toolchain versions

**Status:** Accepted (Phase 1 approval, 2026-10-14); versions to be confirmed by the real install in S0.3 · **Date:** 2026-10-14

## Context (checked 2026-10-14)
- **Installed:** Node v26.4.0.
- **Node 24** moves to maintenance on 2026-10-20. **Node 26** becomes LTS on 2026-10-28.
- **corepack** is not bundled with the installed Node.
- **TypeScript 7.0.2** is the latest release, but typescript-eslint 8.71.2 only supports TypeScript `<6.1.0`.
- **Drizzle 1.0** is still a release candidate.
- **BullMQ 6** was released 2026-07-30.

## Decision
- **Node 26.** Every planned package's `engines` field accepts it. Fallback: Node 24.x, maintained until 2028-04-30.
- **pnpm 12.11.2** installed with `npm i -g` and pinned through the `packageManager` field.
- **TypeScript 6.0.3** (not 7.x), **Drizzle 0.45.4** (not the 1.0 RC), and **BullMQ 6.3.15** (subject to spike S0.7).
- The full pin table is in `03-tech-stack.md` §2.
- Exact versions and the committed lockfile are mandatory. Upgrades arrive only through Renovate PRs that pass CI.

## Revisit when
- typescript-eslint supports TypeScript 7;
- Drizzle 1.0 reaches GA;
- Node 28 becomes LTS.
