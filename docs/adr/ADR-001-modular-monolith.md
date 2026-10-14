# ADR-001: Modular monolith with separate process types

**Status:** Accepted (Phase 1 approval, 2026-10-14) · **Date:** 2026-10-14

## Context
We are a small team building an MVP that has to be correct (tenant isolation, sending) more than it has to scale independently on day one.

## Decision
One TypeScript monorepo. Domain modules live in `packages/core`, and their boundaries are enforced by dependency-cruiser. The code is deployed as separate processes: web, api, tracker, worker, webhook-worker and admin.

## Consequences
- **Pros:** shared transactions and types, simple deployment, fast iteration.
- **Cons:** a module-boundary violation is caught by lint, not by the network.
- **Exit path:** the likely first services to extract are the tracker and sending.
