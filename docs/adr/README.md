# Architecture Decision Records

**Status key:** Proposed · Accepted · Superseded.
Phase 1 was approved on 2026-10-14 (D1–D4), so all ADRs are **Accepted**. Exceptions: ADR-013's cost option is Option B, preferred subject to a verified estimate (D5), and items marked "spike" are confirmed by the named Sprint 0 or Sprint 2 spike. If a spike disproves an assumption, the ADR is revised and the change is reported to the product owner.

| ADR | Title | Status |
|---|---|---|
| [001](ADR-001-modular-monolith.md) | Modular monolith with separate process types | Accepted |
| [002](ADR-002-tenant-isolation.md) | Tenant isolation: RLS + narrow pre-tenant lookup functions | Accepted |
| [003](ADR-003-ses-provider-and-suppression.md) | Amazon SES with tenant management; suppression configuration | Accepted; confirm in spike S2.6 |
| [004](ADR-004-queues-cache-scheduling.md) | Separate queue/cache; BullMQ; DB-backed scheduling, outbox, reconciliation | Accepted; confirm in spike S0.7 |
| [005](ADR-005-event-storage.md) | Partitioned Postgres for messages/events; ClickHouse later | Accepted |
| [006](ADR-006-runtime-toolchain.md) | Node 26, TypeScript 6.0, pinned dependency versions | Accepted; confirm at install S0.3 |
| [007](ADR-007-delivery-guarantees.md) | Delivery guarantees and idempotency (no exactly-once claim) | Accepted |
| [008](ADR-008-templating.md) | MJML 5 + LiquidJS with sandboxed rendering | Accepted |
| [009](ADR-009-webhook-ssrf.md) | SSRF-safe outbound webhooks | Accepted |
| [010](ADR-010-unsubscribe.md) | Unsubscribe handling (GET never mutates; RFC 8058) | Accepted; confirm in spike S2.6 |
| [011](ADR-011-sending-modes.md) | Sending modes sink/sandbox/live and the live gate | Accepted |
| [012](ADR-012-suppression-scope.md) | Suppression scope: tenant-private lists and a strictly qualified shared list | Accepted (D2, with safeguards) |
| [013](ADR-013-aws-deployment.md) | AWS ap-south-1, ECS Fargate, separate accounts | Accepted; Option B preferred, pending verified estimate (D5) |
| [014](ADR-014-authentication.md) | Self-built authentication on vetted primitives | Accepted |
| [015](ADR-015-deliverability-guardrails.md) | Deliverability thresholds as configurable guardrails | Accepted (D4, with safeguards) |
| [016](ADR-016-internal-packages-as-typescript-source.md) | Internal packages ship TypeScript source (no build step) | Accepted (2026-10-14) |
| [017](ADR-017-brevo-provider.md) | Brevo as an additional provider, with tenant-owned accounts | Accepted (2026-10-16); live use needs a real-key check |
