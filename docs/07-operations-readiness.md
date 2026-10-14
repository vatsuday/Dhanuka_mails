# 07 — Environments, Monitoring and Production Readiness

**Status:** v1.0 — **approved** (Phase 1 approval: D1–D4, 2026-10-14). Changes from now on go through change control: update the doc, the ADR if relevant, and PROGRESS.md.
**Last updated:** 2026-10-14

## 1. Environments

| Environment | Purpose | Sending mode | Infrastructure |
|---|---|---|---|
| **Local** | Development on Windows 11 + Docker Desktop (WSL2) | `sink` | Docker Compose |
| **CI** | Automated tests on every PR | `sink` | GitHub Actions + Testcontainers |
| **Staging** | Integration with real AWS services, demos, E2E, load tests | `sandbox` (the SES account **stays in the SES sandbox**) | Separate AWS account, ap-south-1, scaled down |
| **Production** | Controlled beta, then general availability | `live`, only after the readiness gate | Separate AWS account, ap-south-1, Multi-AZ |

### 1.1 Local Docker Compose services

| Service | Image (exact tag pinned in Sprint 0) | Purpose |
|---|---|---|
| `postgres` | postgres:18.6-bookworm | Main database (aligned to the RDS minor in S2.6) |
| `valkey-queue` | valkey/valkey:8.1.10, with `--maxmemory-policy noeviction --appendonly yes` | BullMQ |
| `valkey-cache` | valkey/valkey:8.1.10, with `--maxmemory 256mb --maxmemory-policy allkeys-lru` | Sessions, rate limits, cache |
| S3 emulator | **To be selected before Sprint 3.** `minio/minio` is no longer on Docker Hub (checked 2026-10-14). | S3 |
| `mailpit` | axllent/mailpit:v1.31.5 | SMTP sink and web UI; tests read it through its API |
| `elasticmq` | softwaremill/elasticmq-native:1.7.1 | SQS-compatible queue for the provider-event ingestion path |

A **fake SES event injector** (`pnpm dev:ses-event bounce <recipient>`) publishes synthetic SES events to ElasticMQ. This exercises the same ingestion code that production uses. Running everything needs about 6–8 GB of RAM allocated to Docker.

### 1.2 Staging

- **Introduced in Sprint 2** and grown each sprint after that.
- Deployed automatically from `main`.
- Seeded with test tenants.
- **Never contains real personal data.**

## 2. Monitoring and alerting

### 2.1 Signals

| Area | Metrics | Alert (initial values, tuned in beta) |
|---|---|---|
| API, web, tracker | RPS, p95 latency, 5xx rate | 5xx > 2% for 5 min; p95 > 1 s for 10 min |
| Queue | Depth and age per queue, failed jobs, stalled jobs, valkey-queue memory | Oldest job > 10 min; memory > 70%; DLQ > 0 |
| Sending | Sends/min (platform and tenant), provider error rates by class, `unknown` recipients, token-bucket saturation | `unknown` > 0.1% of a campaign; provider errors > 5% |
| Scheduler and reconciler | Last run time, campaigns stalled, outbox lag | Scheduler silent > 2 min; outbox lag > 1 min |
| Provider events | SQS age, DLQ depth, ingestion lag | Age > 5 min; DLQ > 0 |
| Deliverability | Per-tenant and platform bounce and complaint rates (`06` §4), SES tenant findings, Gmail Postmaster spam rate (manual weekly review in beta) | As defined in `06` §4 |
| Domains | Domains `degraded` | Any (notify the tenant); more than 5 at once (platform alert) |
| Security | Failed logins, MFA failures, API-key auth failures, SSRF blocks, 429s, WAF blocks | Spikes above baseline |
| Database | CPU, connections, replication lag, storage, slow queries | CPU > 80% for 15 min; storage < 20% |
| Webhooks | Delivery success rate, auto-disabled endpoints | Informational |

### 2.2 Tooling

- **Logs:** pino JSON → CloudWatch Logs, **kept 180 days in ap-south-1** (CERT-In), then archived to S3.
- **Traces:** OpenTelemetry.
- **Errors:** Sentry, with PII scrubbing.
- **Metrics and alarms:** CloudWatch → SNS → email and Slack during beta. A paging tool is decided before GA.

### 2.3 Incident response

- **Severity levels:** SEV1 means data leak, unauthorised sending or a full outage. SEV2 means sending is stalled or a partial outage.
- **Regulatory reporting:** **CERT-In within 6 hours** for reportable cyber incidents. Personal-data breaches go to the **Data Protection Board** and affected people under the DPDP Rules. Counsel confirms the exact timelines and contacts before beta (decision U10).

## 3. Runbooks (written by Sprint 9)

1. Tenant auto-paused (bounce or complaint)
2. SES account under review or paused
3. Queue backlog or valkey-queue failover (recovery through the reconciler)
4. `unknown` recipients after a provider incident
5. Database failover and point-in-time restore
6. Signing key rotation (unsubscribe/tracking tokens, webhook secrets)
7. Suspected cross-tenant data exposure
8. Abuse report against a tenant
9. Data-subject requests (export or erase)

## 4. Production readiness gate (required before `live` sending)

The product owner signs off on this checklist in Sprint 9. It is recorded in `PROGRESS.md`.

**Security and isolation**
- [ ] Isolation suite and catalog tests pass, covering 100% of tenant tables
- [ ] External or independent security review done, with all high and critical findings closed (ASVS L2 checklist)
- [ ] SSRF test suite passes against staging
- [ ] Secrets in Secrets Manager, KMS keys rotated, gitleaks clean
- [ ] Operator accounts use MFA, and the admin app is on a separate hostname

**Deliverability**
- [ ] SES production access granted in ap-south-1. Send quota and rate recorded.
- [ ] SES tenant management and tenant-level suppression verified (spike report)
- [ ] Our domains (system mail, tracking, unsubscribe) have SPF, DKIM, DMARC (≥ p=quarantine) and Gmail Postmaster registration
- [ ] One-click unsubscribe verified end to end on Gmail and Outlook test inboxes, including DKIM coverage of the headers
- [ ] Reputation guard and circuit breaker demonstrated on staging with the bounce and complaint simulator

**Reliability**
- [ ] Load test report: sustained platform throughput, queue recovery after a valkey-queue failover, zero duplicate sends
- [ ] Backup and point-in-time-restore drill done, with RPO/RTO measured
- [ ] Every §2 alert fired at least once in a test
- [ ] Runbooks 1–9 written

**Compliance and business**
- [ ] Terms, AUP, privacy policy and DPA published (counsel reviewed)
- [ ] DPDP notice and consent text and the grievance contact published
- [ ] Billing and GST invoice data verified (or beta billing explicitly waived)
- [ ] Owner and SLA for abuse review assigned

**Final step**
- [ ] Product owner approval recorded. `SENDING_LIVE_APPROVED_AT` and `SENDING_LIVE_APPROVED_BY` set by the release pipeline.
