# ADR-007: Delivery guarantees and idempotency

**Status:** Accepted (Phase 1 approval, 2026-10-14) · **Date:** 2026-10-14 · Resolves review finding M1

## Context
Exactly-once delivery through an external provider is impossible. If the worker crashes after SES accepts a message but before we record the acceptance, retrying sends a duplicate. The v0.1 documents contradicted each other on this point.

## Decision

| Flow | Guarantee |
|---|---|
| Campaign email | **At most one provider call per (campaign, contact).** Ambiguous outcomes are marked `unknown`, never retried automatically, and reconciled through the SES `Send` event (`rid` tag). Anything unresolved after 24 h becomes `unknown_final`. A tenant may explicitly choose to retry those and accept the duplicate risk. |
| Transactional API | At most once per `Idempotency-Key` within 24 h. Same key with a different body → 422; a request still in progress → 409. |
| Jobs and outbox | At least once, with idempotent handlers. |
| Provider events | Deduplicated on the SNS `MessageId`. |
| Webhooks out | At least once, with a stable `webhook-id`. |

**Mechanism:**
- `campaign_recipients` (PK `tenant_id, campaign_id, contact_id`) moves through `pending → sending → sent | failed | unknown`, with a lease.
- The `sending` state is committed before the provider call, in sub-batches of at most 10 per worker.
- Transitions are enforced by a trigger.
- Provider errors are classified as definite, retryable or ambiguous.

## Consequences
- **Never claim "exactly once"** in documentation, marketing or acceptance criteria.
- Reports show `unknown` recipients explicitly.
