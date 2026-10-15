# ADR-004: Separate queue and cache; BullMQ; DB-backed scheduling, outbox and reconciliation

**Status:** Accepted (Phase 1 approval, 2026-10-14); BullMQ 6 confirmed by spike S0.7 (2026-10-15) · **Date:** 2026-10-14 · Resolves review findings C5, M2, M3, M4

## Decision
1. **Two Valkey instances:**
   - **valkey-queue** for BullMQ: `noeviction`, Multi-AZ replica, memory alarm at 70%.
   - **valkey-cache** for sessions, rate limits and caches: `allkeys-lru`.
2. **BullMQ 6.3.x.** If spike S0.7 finds problems with retries, delayed or repeatable jobs, stalled-job recovery or Valkey compatibility, use **5.x** instead.
   **Outcome (S0.7, 2026-10-15): BullMQ 6.3.10 kept.** Retries with backoff, delayed jobs, job schedulers, stalled-job recovery after a killed worker, and `noeviction` all verified against Valkey 8.1.10 ([spike report](../spikes/S0.7-queue-spike.md)). Rules from the spike: every worker on a queue uses the same `stalledInterval` (one shared constant per queue), and job processors use a connection with `maxRetriesPerRequest: null`.
3. **Postgres is the source of truth** for every piece of durable work:
   - **Scheduling:** `campaigns.scheduled_at`, picked up by a scheduler running every 30 s through `claim_due_campaigns()`. BullMQ delayed jobs are never relied on.
   - **Outbox:** every enqueue that follows a database change is written to `outbox` in the same transaction. A relay publishes it with `jobId = outbox.id`.
   - **Reconciler:** runs every 60 s and re-enqueues stalled campaigns. A lease sweeper moves expired `sending` recipients to `unknown`.
4. **Throttling** uses custom Lua token buckets at platform, tenant and recipient-domain level. Grouped rate limits are only in BullMQ Pro.
5. **SES events** arrive through SNS → **SQS** (with a DLQ) → worker, not by SNS pushing to HTTP.

## Consequences
- Losing queue data (for example, an ElastiCache failover without AOF) costs time, not correctness.
- MemoryDB is the upgrade path if stronger queue durability is ever needed.
- Local development mirrors the queue/cache split with two containers.
