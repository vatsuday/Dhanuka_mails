# ADR-005: Partitioned Postgres for messages and events; ClickHouse later

**Status:** Accepted (Phase 1 approval, 2026-10-14) · **Date:** 2026-10-14 · Revised for review finding C2

## Decision
- `messages`, `message_events` and `audit_logs` are range-partitioned by month.
- **No uniqueness that must hold across partitions is enforced on partitioned tables.** It lives in non-partitioned tables instead: `campaign_recipients`, `idempotency_keys` and `processed_provider_events`.
- `message_events` has no foreign key. It stores `message_id` and `message_created_at`.
- **Retention:** IP and user agent nulled after 90 days; partitions archived to S3 and dropped after 13 months.
- **ClickHouse** arrives in Release 2 if events exceed about 50M rows/month.
