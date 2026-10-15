# 05 — Product Backlog and Sprint Plan (MVP)

**Status:** v1.0 — **approved** (Phase 1 approval: D1–D4, 2026-10-14). Changes from now on go through change control: update the doc, the ADR if relevant, and PROGRESS.md.
**Last updated:** 2026-10-14
**Estimation:** relative story points. Assumed velocity is about 30 points per 2-week sprint, **recalibrated after Sprint 1**.
**Priority:** P0 = must have, P1 = should have, P2 = could have (flex).

> **Every MVP story below has acceptance criteria (AC).** At each sprint's planning session the stories are broken into tasks. The AC may be refined then, but never weakened without product-owner approval.

## Definition of Done (every story)

1. Code reviewed. Lint, typecheck and dependency-cruiser are clean.
2. Unit tests, plus integration tests against real Postgres and Valkey (Testcontainers), are written and pass in CI.
3. Any new tenant table is added to the **isolation suite**. Any new `SECURITY DEFINER` function has its own tests and passes the catalog test.
4. New endpoints declare a permission or scope, and have authz tests plus a cross-tenant ID test.
5. Metrics and structured logs are added for new background flows.
6. The E2E suite is extended when the story touches a critical path.
7. Docs (ADRs, policies) and `PROGRESS.md` are updated. No secrets are committed.
8. Demo or verification evidence is recorded in the sprint notes. **No feature is reported as working without it.**

## Sprint exit criteria (every sprint)

- All P0 stories meet their AC, or are explicitly carried over with product-owner agreement.
- CI is green on `main`. From Sprint 2 onwards, staging is deployed and its smoke tests pass.
- The sprint review demo is done and `PROGRESS.md` is updated.
- Product-owner approval is required at the milestones marked 🏁.

---

## Revised sprint plan

| Sprint | Goal | Pts | Depends on | Exit demo |
|---|---|---|---|---|
| **0** | Foundation: toolchain, local stack, DB + RLS + isolation harness, CI, queue spike | 27 | Phase 1 approval; Docker and pnpm installed | `pnpm dev` runs; isolation tests green in CI |
| **1** | Identity, organisations, RBAC, audit writer, system email in **sink** mode | 27 | S0 | Signup → verify (email visible in Mailpit) → create org |
| **2** | MFA, invitations, API keys, domains, **staging v1 + SES spike**, cost validation 🏁 | 31 | S1, AWS accounts, domains (U9) | Domain verified in staging; SES spike report |
| **3** | Contacts, lists, tags, import; account settings | 32 | S1 | Import 100k rows locally |
| **4** | Templates (LiquidJS), tracker, unsubscribe, suppression model, SES provider + mode guard | 32 | S2 (SES), S3 | Test send through SES sandbox; unsubscribe flow |
| **5** | Campaign pipeline: scheduling, outbox, snapshot, state machine, throttling, recovery, metrics 🏁 | 29 | S4 | Campaign to simulator addresses; worker killed mid-send gives no duplicates |
| **6** | Event ingestion, open/click tracking, auto-suppression, reputation guard, reports | 31 | S5 | Bounce/complaint simulator → suppression and auto-pause |
| **7** | Operator console, tenant review and tiers, segments, privacy requests | 32 | S6 | Operator approves a tenant; segment-based campaign |
| **8** | Transactional API, REST API, SSRF-safe webhooks, billing, export | 32 | S7; payment decision (U2) | API send with idempotency; webhook SSRF tests |
| **9** | Hardening: security review, load test, production infrastructure, readiness gate 🏁 | 32 | S8 | Readiness checklist (`07` §4) signed off → **MVP release candidate** |

Total ≈ 305 points over 20 weeks. If Sprint 0 starts in the week of 2026-10-19, the release candidate lands around **early March 2027** (to be re-forecast after Sprint 1). Flex items (P2) slip to Release 2 first.

**Safety rule across sprints:** **`live` sending is impossible until the Sprint 9 readiness gate.** Before then, mail is delivered only through `sink` (local and CI) or `sandbox` (staging: SES simulator and verified team addresses).

---

## Sprint 0 — Foundation (27 pts)

**Objective:** a developer can run the whole stack locally, the database enforces tenant isolation, and CI proves it.

| ID | Story | Pts | AC |
|---|---|---|---|
| S0.1 | Repo and local environment | 3 | (1) `git init` with `.gitignore`, `.editorconfig`, `.nvmrc`, README. (2) `pnpm infra:up` starts postgres, valkey-queue, valkey-cache, mailpit and elasticmq, and every service with a health check reports healthy. (3) The README local-setup steps are followed on this Windows machine and work. *(Amended and approved by the PO 2026-10-14: "`pnpm dev` starts every app" moved to S0.8; S3 emulator removed and tracked as T1 for Sprint 3.)* **Status: closed with carry-over (PO approved 2026-10-14). AC (2) and (3) need Docker and are tracked as S0.1-C, which must pass before S0.4.** |
| S0.2 | CI pipeline | 3 | (1) Each PR runs frozen-lockfile install, lint, typecheck, unit tests, integration tests (Testcontainers) and gitleaks. (2) Any failure blocks the merge. (3) Runtime is under 15 min. **Status 2026-10-14: implemented and validated locally. Running on GitHub and merge enforcement need the GitHub repository (B6).** |
| S0.3 | Toolchain pinning | 2 | (1) Exact versions from `03-tech-stack.md` are installed on Node 26.4. (2) Peer-dependency warnings are reviewed, and any accepted ones are documented. (3) Any version change from the plan is recorded in ADR-006 with its reason. **Status 2026-10-14: done, approved by the PO.** The full set was verified in a scratch workspace; the repository installs only the `@dm/config` toolchain; the pins are in the `pnpm-workspace.yaml` catalog. |
| S0.4 | DB foundation and RLS | 5 | (1) The SQL migration creates the roles in `04` §2 and the first tables (tenants, users, memberships, contacts) with FORCE RLS. (2) `app_user` is neither owner nor `BYPASSRLS`; asserted by a test. (3) `withTenant` uses transaction-local `set_config`. (4) A query outside `withTenant` returns 0 rows. (5) `/ready` probes from `@dm/shared` pass against the running Postgres and both Valkey instances, and fail when each is stopped (moved from S0.6, approved 2026-10-14). **Status 2026-10-15: done (PO instruction to complete all remaining steps); see PROGRESS.md "S0.4 report".** |
| S0.5 | Isolation harness and catalog tests | 5 | (1) The reusable suite asserts that cross-tenant SELECT, INSERT, UPDATE and DELETE are blocked, that a spoofed `tenant_id` is rejected, and that an unset tenant sees 0 rows. (2) The catalog test fails on any table with `tenant_id` that lacks forced RLS. (3) The catalog test fails on any `SECURITY DEFINER` function that lacks a pinned `search_path` or is executable by PUBLIC. (4) A deliberately broken table makes CI fail; demonstrated once. **Status 2026-10-15: AC 1-3 done; AC 4 demonstrated locally and in an automated test; the GitHub CI demonstration needs a PR from branch `demo/s0.5-broken-table` (see PROGRESS.md "S0.5 report").** |
| S0.6 | Config, logging, health | 3 | (1) The zod config loader fails fast with a clear message. (2) `.env.example` is complete. (3) pino JSON logs include `request_id`. (4) Secrets are redacted; tested. (5) `/health` and `/ready` exist for each app, and `/ready` checks the DB and both Valkey instances. (6) `SENDING_MODE` defaults to `sink`, and `live` is rejected outside production; tested. **Status 2026-10-14: done, approved by the PO.** *(Amendment S0.6-A, approved 2026-10-14: AC (5) is met by the reusable `/health` and `/ready` plugin and probes in `@dm/shared`. Per-app wiring moves to S0.8; verifying `/ready` against a running Postgres and Valkey moves to S0.4.)* |
| S0.7 | Queue spike (BullMQ 6 + Valkey) | 3 | (1) Verified: retry with backoff, delayed jobs, repeatable jobs, stalled-job recovery after the worker is killed, and `noeviction` on valkey-queue. (2) The spike report is written. (3) The BullMQ 6 vs 5 decision is recorded in ADR-004. (4) A worker sample job runs inside `withTenant`; integration-tested (moved from S0.8, approved 2026-10-14; needs S0.4). **Status 2026-10-15: done; BullMQ 6 kept (see `docs/spikes/S0.7-queue-spike.md`).** |
| S0.8 | App skeletons | 3 | (0) `pnpm dev` starts every app (moved from S0.1, approved 2026-10-14). (0b) Every app exposes `/health` and `/ready` via `@dm/shared`, with the checks relevant to that app (moved from S0.6, approved 2026-10-14). (1) api, tracker, worker, webhook-worker, admin and web build. (2) A Playwright smoke test loads the web health page. (3) A worker sample job runs inside `withTenant`; integration-tested. **Status 2026-10-14: done, approved by the PO.** *(Amendment S0.8-A, approved 2026-10-14: AC (3) moved to S0.7.)* |

## Sprint 1 — Identity, organisations, system email (27 pts)

**Objective:** users can sign up, verify their email, log in and create an organisation. All email goes to the Mailpit sink.

**Status 2026-10-15: all 9 stories implemented and verified (PO instruction: "complete this project"). Exit demo passed in a real browser. See PROGRESS.md "Sprint 1 report".**

| ID | Story | Pts | AC |
|---|---|---|---|
| S1.1 | Signup and email verification | 5 | (1) Passwords hashed with Argon2id; minimum 10 characters; checked against a breached-password list (k-anonymity API or a local list). (2) Terms and AUP acceptance stored with their version. (3) The response is identical whether or not the email already exists; an existing user receives a "you already have an account" email instead. (4) The verification token is 32 bytes, stored hashed, single use and valid for 24 h. (5) An integration test reads the email from Mailpit and completes verification. (6) Unverified users can't create an organisation. |
| S1.2 | Login, logout, sessions | 3 | (1) `__Host-` cookie: HttpOnly, Secure, SameSite=Lax. (2) Idle timeout 12 h, absolute 14 days. (3) The session ID rotates on login. (4) Logout deletes the server-side session. (5) State-changing requests without a valid Origin are rejected with 403; tested. |
| S1.3 | Password reset | 3 | (1) Same response whether or not the account exists. (2) Token hashed, valid 1 h, single use. (3) A successful reset revokes every session. (4) The email arrives in Mailpit in the test. |
| S1.4 | Rate limiting and lockout | 2 | (1) Login: 5 attempts per minute per account+IP, with progressive delay, then 429 with `Retry-After`. (2) Reset and verification resend: 3 per hour per email. (3) Limits are stored in valkey-cache; tested. |
| S1.5 | ChannelProvider, sink, mode guard, system mail | 3 | (1) The `ChannelProvider` interface exists. (2) `SinkProvider` delivers to Mailpit. (3) `SendingModeGuard` blocks non-allowlisted recipients in `sandbox` and everything external in `sink`; unit tests cover every mode and recipient class. (4) Verify, reset and invite templates exist. **SES is not called in this sprint.** |
| S1.6 | Create organisation | 3 | (1) A verified user creates a tenant with status `pending_review`, tier `sandbox`, mode `sandbox`, and becomes Owner, all in one transaction. (2) The slug is unique. (3) Defaults: INR, Asia/Kolkata, en-IN, ap-south-1. |
| S1.7 | Membership lookup function and org list | 3 | (1) `list_user_memberships` follows the `04` §4 rules. (2) Its tests cover: other users' memberships are not returned, PUBLIC can't execute it, and the documented columns only. |
| S1.8 | RBAC enforcement | 3 | (1) The permission matrix in code matches `02` §5. (2) Every route declares a permission, and a test fails for any route without one (default deny). (3) Each role is tested against each route registered so far. |
| S1.9 | Audit log writer | 2 | (1) Append-only: an UPDATE or DELETE by `app_user` fails; tested. (2) Signup, login (success and failure), reset, MFA and org events are recorded with actor, IP and user agent. |

## Sprint 2 — Team, keys, domains, staging (31 pts) 🏁 *Milestone: real AWS integration*

**Objective:** a team collaborates, domains are verified in real SES on staging, and the SES assumptions are proven.

| ID | Story | Pts | AC |
|---|---|---|---|
| S2.1 | TOTP MFA | 5 | (1) Enrolment with a QR code and confirmation code. (2) Secret envelope-encrypted. (3) 10 hashed, single-use recovery codes. (4) ±1 time-step window, and reuse of the same step is rejected. (5) Owner can require MFA for every member. (6) The MFA challenge on login is tested. |
| S2.2 | Invitations | 5 | (1) Owner or Admin invites by email with a role, never higher than their own. (2) Token hashed, valid 7 days, resolved through `lookup_invitation`. (3) The accepting user's verified email must match. (4) Invitations can be revoked. (5) Audited. (6) The email goes to the sink (local) or sandbox (staging). |
| S2.3 | API keys | 3 | (1) Format `dm_live_` / `dm_test_` plus prefix and secret. (2) The secret is shown once and stored as SHA-256. (3) Scopes are enforced. (4) `auth_api_key` returns a tenant only for an active key with a matching hash; tested with a wrong hash, a revoked key and an expired key. (5) Revocation takes effect within 60 s. |
| S2.4 | Add sending domain | 5 | (1) Creates an SES identity (Easy DKIM 2048, MAIL FROM with `RejectMessage`) and associates it with the tenant's SES tenant. A fake adapter is used in CI. (2) The UI shows the DKIM CNAMEs, MAIL FROM MX and SPF records, and DMARC guidance. (3) Free-mail domains and domains verified by another tenant are rejected. |
| S2.5 | Domain verification and monitoring | 5 | (1) A manual check plus a check every 24 h. (2) Status per record (DKIM, MAIL FROM, DMARC parse). (3) `verified` only when all three pass. (4) A regression sets `degraded`, blocks sending and notifies the tenant. (5) Tests use a stubbed DNS resolver. |
| S2.6 | Staging v1 and SES spike | 6 | (1) Terraform staging account: VPC, RDS, Valkey ×2, ECS, ALB, SNS→SQS, SES (kept in the SES sandbox); CI deploys `main`. (2) Spike report covering: SES tenant creation and association; `TenantName` send to the simulator; tenant-level suppression with the `OnTenantSuppressionList` event; **whether Easy DKIM signs the `List-Unsubscribe` headers**; Feedback-ID behaviour; RDS PG18 availability; ElastiCache Valkey version and persistence. (3) ADR-003 and ADR-010 finalised from the spike results. |
| S2.7 | Cost validation and SES requests | 2 | (1) AWS Pricing Calculator estimate **for Option B** (PO preference, D5) attached to `08`; any variance over 20% reported to the product owner. **No AWS resources are provisioned before this estimate is verified and accepted.** (2) SES production access requested for the production account (approval tracked as blocker B4). |

## Sprint 3 — Audience (32 pts)

| ID | Story | Pts | AC |
|---|---|---|---|
| S3.1 | Organisation switcher | 2 | (1) Lists memberships through the function. (2) Switching rotates the session's tenant. (3) Access to a tenant the user no longer belongs to is refused. |
| S3.2 | Account settings | 3 | (1) Change password (requires the current one; revokes other sessions). (2) Change email (verifies the new address, notifies the old one). (3) List and revoke active sessions. |
| S4.1 | Contacts CRUD | 5 | (1) Create, read, update and soft-delete. (2) Normalisation as in `04` §1. (3) Uniqueness per tenant. (4) Consent is stored. (5) `display_status` is derived, never written directly by the user. (6) Isolation and authz tests. |
| S4.2 | Custom fields | 3 | (1) Typed fields (text, number, date, boolean, enum). (2) Values validated against the type. (3) Deleting a field cleans up its values asynchronously. |
| S4.3 | Lists, tags, bulk actions | 5 | (1) List and tag CRUD. (2) Bulk add or remove across 10k contacts runs as a background job with progress. (3) Results are tested. |
| S4.4 | Search and pagination | 3 | (1) Search by email or name prefix; filter by list, tag or status. (2) Cursor pagination. (3) p95 < 500 ms on 100k contacts locally. |
| S5.1 | Upload and mapping | 5 | (0) Prerequisite: the local S3 emulator is selected (T1), added to Docker Compose and passes its health check. (1) Presigned upload of CSV only, ≤ 50 MB. (2) Preview of the first 20 rows. (3) Column mapping. (4) **Consent attestation is required**. (5) The file is stored under `tenants/{id}/`. |
| S5.2 | Background import | 6 | (1) Streams the file in chunks. (2) Deduplicates, validates syntax, flags role and disposable addresses. (3) Platform-suppressed addresses are marked not sendable. (4) Progress and a downloadable error report. (5) 100k rows import in under 5 min locally. (6) An unknown-address rate ≥ 5% flags the import for review. (7) Idempotent if the job is retried. (8) A domain is recorded as invalid platform-wide only after NXDOMAIN or null MX is confirmed twice at least 24 h apart; a DNS timeout or SERVFAIL never creates a shared entry (tested with a stubbed resolver). |

## Sprint 4 — Content, unsubscribe, provider (32 pts)

| ID | Story | Pts | AC |
|---|---|---|---|
| S7.1 | Template editor and preview | 8 | (1) Block editor plus an MJML/HTML code mode. (2) MJML 5 compiles on save, and errors are shown. (3) The preview runs in a sandboxed iframe on the preview origin, and a test confirms scripts don't run. (4) Desktop and mobile previews. |
| S7.2 | LiquidJS rendering | 3 | (1) The settings in `02` §10. (2) Tests: `<script>` in contact data comes out escaped; `include` and `render` are refused; render limits are enforced; CR/LF in the subject is removed; a missing variable renders as empty, or as the `default` filter's value. |
| S7.3 | Compliance lint and plain text | 2 | (1) Saving or sending fails without the unsubscribe placeholder and the postal address in the footer. (2) A plain-text part is generated automatically. |
| S7.4 | Test send | 2 | (1) Only to the sender's team addresses, under the current mode. (2) Staging delivers through the SES sandbox. (3) Rate limited. |
| S9.1 | Tracker service and signed tokens | 3 | (1) Token format and key rotation per `02` §8. (2) Tampered tokens or unknown key IDs get a generic response. (3) A WAF rule exists on staging. |
| S10.1 | Unsubscribe flow | 5 | (1) GET shows a page and **never changes state**; tested with GET, HEAD and prefetch-style requests. (2) The one-click POST unsubscribes immediately, without a cookie or CSRF token. (3) Confirm POST plus resubscribe. (4) Idempotent. (5) The header and footer generated for every marketing message match the spec. (6) The change is visible to sending within 1 minute. |
| S10.2 | Suppression model and `isSendable` | 3 | (1) `tenant_suppressions`, `platform_suppressions` (HMAC only, no plaintext) and the functions. (2) `isSendable` is the single decision point, covered by a truth-table test. (3) Tenants can't read platform rows, and `platform_suppressed()` returns nothing for contact IDs of another tenant or arbitrary addresses; tested. (4) No plaintext address exists in `platform_suppressions` (schema test). |
| S8.1 | SES provider | 4 | (1) `SendEmail` with `TenantName`, configuration set and `EmailTags`. (2) Errors are classified as definite, retryable or ambiguous, with unit tests for each class. (3) The mode guard is applied inside the adapter. (4) A staging test sends to the simulator successfully, and a send to a non-allowlisted address is blocked by our guard (before SES). |
| S10.3 | Engagement and consent basics | 2 | (1) `last_engaged_at` is updated by events (wired in S6). (2) The sunset flag is computed for contacts inactive for 6 months. |

## Sprint 5 — Campaign pipeline (29 pts) 🏁 *Milestone: end-to-end send in sandbox*

| ID | Story | Pts | AC |
|---|---|---|---|
| S8.2 | Campaign builder and pre-send checklist | 5 | (1) Choose audience (lists; segments come in S7), content and from-address. (2) The checklist enforces FR-2, including the postal address, a verified domain and quota. (3) Content is snapshotted at schedule time. |
| S8.3 | DB-backed scheduling and controls | 5 | (1) `scheduled_at` is stored in the tenant's timezone. (2) The scheduler, through `claim_due_campaigns`, moves campaigns to `preparing` and writes the outbox row in the same transaction. (3) Pause, resume and cancel take effect at batch boundaries. (4) Flushing valkey-queue **does not lose scheduled campaigns**; tested. |
| S8.4 | Audience snapshot and batching | 5 | (1) The snapshot creates `campaign_recipients`, excluding non-sendable contacts (marked `skipped` with a reason). (2) Batch jobs carry a deterministic `jobId`. (3) A 100k-recipient snapshot completes in under 2 min locally. |
| S8.5 | Recipient state machine and reconciliation | 5 | (1) The transitions in `02` §6.2 are enforced by a trigger; every allowed and disallowed transition is tested. (2) **Kill test:** the worker is killed at random points during a 5k-recipient campaign and restarted; there are **0 duplicate provider calls** per (campaign, contact), and every recipient ends `sent`, `failed`, `skipped` or `unknown`. (3) Expired leases become `unknown`, never `pending`. |
| S8.6 | Throttling and quotas | 3 | (1) Lua token buckets at platform, tenant and recipient-domain level; unit-tested. (2) Daily and hourly quotas are enforced; tested at the boundaries. (3) Tenant pause or suspension is checked before every batch. |
| S8.7 | Outbox relay and reconciler | 3 | (1) Relay latency under 2 s. (2) The reconciler re-enqueues stalled campaigns. (3) Duplicate batch jobs are harmless; tested. |
| S15.1 | Metrics and alerts baseline | 3 | (1) The queue, sending and scheduler metrics from `07` §2 are emitted. (2) Staging dashboards exist. (3) Queue-backlog and scheduler-silent alarms fire in a test. |

## Sprint 6 — Feedback loop and reporting (31 pts)

| ID | Story | Pts | AC |
|---|---|---|---|
| S9.2 | SES event ingestion | 5 | (1) SNS→SQS→worker; the SNS signature is verified. (2) Deduplication on `processed_provider_events`. (3) `Send` events reconcile `unknown` recipients. (4) Bounce, complaint, delivery and delay events are stored. (5) A DLQ alarm exists. (6) The ElasticMQ injector is used locally, and the SES simulator on staging. |
| S9.3 | Open and click tracking | 5 | (1) Pixel and redirect use signed tokens. (2) Redirects go only to URLs registered in `links` (no open redirect); tested. (3) Machine opens and clicks are flagged. (4) The tenant can turn tracking off, after which nothing is tracked or rewritten; tested. |
| S10.4 | Auto-suppression and bounce classifier | 5 | (1) A versioned classifier implements `06` §7.2. A fixture suite covers every SES bounce type and subtype and the status-code families 4xx, 5.1.x, 5.2.x, 5.3.x, 5.4.x and 5.7.x. **Only the qualifying cases create shared entries**, and each records `rule_id` and `classifier_version`. (2) Complaints → tenant suppression only. (3) 3 soft bounces over 7 or more days → tenant suppression. (4) SES suppression-list bounces are mirrored to the tenant only. (5) Temporary failures never create a shared entry (negative tests). |
| S10.5 | Suppression management UI | 3 | (1) List, search, add and CSV-import tenant suppressions. (2) Removing a complaint is blocked. (3) Platform suppressions appear only as "Undeliverable (platform)". (4) A "Request re-check" action with a reason, through `request_platform_recheck`, only for the tenant's own contacts. |
| S14.1 | Reputation guard and circuit breaker | 5 | (1) A pure `evaluate(metrics, settings)` function implements `06` §4 (ADR-015). (2) Unit tests cover: below minimum volume (no rate-based pause), absolute backstops, the Wilson lower-bound gate, serious-incident immediate pause, and an ingestion-lag hold. (3) Settings are read from versioned `deliverability_settings`. (4) Auto-pause stops batches, notifies the tenant and operators, and pauses the SES tenant. (5) Unpausing needs an operator and a reason. (6) The campaign circuit breaker works. (7) Demonstrated on staging with the bounce and complaint simulators. |
| S11.1 | Campaign report | 5 | (1) Sent, delivered, unique and total opens (machine opens separated), clicks, CTR, bounces, complaints, unsubscribes, `unknown`, and clicks per link. (2) Numbers match the raw events in a reconciliation test. |
| S11.2 | Account health dashboard | 3 | (1) 30-day trends of bounce and complaint rates against thresholds. (2) Domain status. (3) Quota usage. |

## Sprint 7 — Platform operations and segmentation (32 pts)

| ID | Story | Pts | AC |
|---|---|---|---|
| S14.2 | Operator identity and console | 5 | (1) A separate `operators` table, login and hostname. (2) Mandatory MFA. (3) 30-min idle and 8-h absolute session limits. (4) Every action is audited. (5) Tenant credentials are refused; tested. |
| S14.3 | Tenant review, tiers, quotas, suppression re-checks | 5 | (1) Review queue showing domain, postal address and an import-quality summary. (2) Approve (creates the SES tenant, sets tier `new`), reject, or edit quotas and deliverability settings (with a reason) through `admin_*` functions. (3) A platform-suppression re-check queue with remove or uphold; bulk reversal by classifier version with a dry-run count. (4) A 30-day re-validation job for domain-level entries. (5) Everything audited. |
| S14.4 | Suspension and SES status sync | 3 | (1) Operator suspend and unsuspend. (2) SES EventBridge tenant status and findings are ingested and reflected; tested with sample events. |
| S6.1 | Segment builder | 8 | (1) AND/OR rules on fields, tags, lists and engagement. (2) Live count under 3 s on 1M contacts (staging data set). (3) Usable as a campaign audience. |
| S6.2 | Segment safety | 3 | (1) The rule tree is schema-validated. (2) Compiled SQL is parameterised. (3) Fuzz tests with injection payloads. (4) RLS still applies; tested. |
| S4.5 | Data export and erasure | 3 | (1) Export a contact's data as JSON. (2) Erasure deletes the contact, pseudonymises `messages.to_address` and event IPs, and keeps the suppression entry (as a hash) so the person isn't re-mailed. (3) Recorded in `data_requests`. |
| S9.4 | Contact activity timeline | 3 | Paginated events per contact, with isolation tests. |
| S10.6 | Retention jobs | 2 | (1) IP and user agent nulled after 90 days. (2) Partitions archived after 13 months. (3) Soft-deleted contacts purged after 30 days. Each job is tested. |

## Sprint 8 — Developer platform and billing (32 pts)

| ID | Story | Pts | AC |
|---|---|---|---|
| S12.1 | Transactional send API | 5 | (1) `POST /v1/messages/email`. (2) `Idempotency-Key` semantics per `04` §5.5: replay, 422 and 409, all tested. (3) Uses the `cs-txn` stream. (4) Ignores unsubscribes but honours bounce and complaint suppressions. (5) Under the mode guard. |
| S12.2 | REST contacts and lists API, OpenAPI | 5 | (1) CRUD with scopes. (2) OpenAPI generated and published. (3) Cross-tenant ID tests. |
| S12.3 | Outbound webhooks | 8 | (1) Every control in `02` §9. (2) SSRF test suite: private IPv4 and IPv6, mapped and embedded IPv4, decimal/hex/octal IP literals, `localhost`, a DNS-rebinding stub (first lookup public, second private), redirects to private addresses, non-443 ports, userinfo, metadata IPs. **All are blocked.** (3) Standard Webhooks signatures. (4) Retries and auto-disable. (5) Delivery log. |
| S13.1 | Plans and quota enforcement | 3 | Plan limits feed `tenant_sending_policies` and contact limits, with tests at the boundaries. |
| S13.2 | Subscription provider | 5 | (1) Provider adapter (Razorpay assumed, pending decision U2). (2) Checkout. (3) Signed webhook sync. (4) Failed payment leads to a grace period, then a pause. (*If U2 isn't decided by Sprint 8 planning, this moves to Release 1.1 and beta billing is waived.*) |
| S13.3 | Usage metering and GST data | 3 | (1) Monthly counters. (2) Invoice data includes GSTIN, place of supply and CGST/SGST or IGST split. (3) Tested against fixtures. |
| S5.3 | CSV export | 3 | (1) Export a list or segment as a background job. (2) Formula-injection escaping; tested. (3) A presigned download link that expires in 15 min. |

## Sprint 9 — Hardening and release candidate (32 pts) 🏁 *Milestone: readiness gate*

| ID | Story | Pts | AC |
|---|---|---|---|
| S15.2 | Security review and fixes | 8 | (1) ASVS L2 checklist completed. (2) Independent review or pen test. (3) High and critical findings fixed and re-tested. |
| S15.3 | Load and capacity test | 5 | (1) Staging run to SES simulator addresses at the SES quota. (2) Measured sustained throughput and bottlenecks. (3) valkey-queue failover during a send gives no duplicates and full recovery. (4) Results recorded in `06` §2. |
| S15.4 | Production infrastructure and restore drill | 8 | (1) Terraform for production (Option A or B, decision U3). (2) Point-in-time restore drill with measured RPO/RTO. (3) Secrets and KMS. (4) WAF. |
| S15.5 | E2E critical path suite | 3 | Playwright on staging: signup → MFA → domain → import → template → campaign (sandbox) → report → unsubscribe. |
| S15.6 | Runbooks, alerts, CERT-In logging | 3 | (1) Runbooks 1–9 written. (2) Every alarm fired in a test. (3) 180-day log retention in ap-south-1 verified. |
| S2.8 | Audit log viewer | 2 | Owner and Admin can filter and export the audit log; isolation tested. |
| S2.9 | Ownership transfer and organisation deletion | 3 | (1) Transfer requires the new owner's acceptance. (2) The last owner can't leave. (3) Deletion has a 30-day grace period, then a purge job runs and the SES tenant is deleted. |

## Release 2 backlog (not scheduled)

- A/B subject tests (formerly S8.6)
- Double opt-in improvements and a preference centre with topics
- SMS (DLT), WhatsApp
- Automation journeys and forms
- Dedicated IPs and warm-up, custom tracking domains
- ClickHouse
- Stripe and international billing
- `mailto:` unsubscribe (if SES inbound becomes available)
