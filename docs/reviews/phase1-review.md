# Phase 1 Planning Review

**Date:** 2026-10-14
**Scope:** `docs/01-prd.md`, `02-architecture.md`, `03-tech-stack.md`, `04-database-design.md`, `05-backlog.md`, `PROGRESS.md`, `README.md`
> **Update 2026-10-14 (v0.2):** the product owner approved these recommendations in principle. All critical and major findings have been applied to the planning documents; see **§9 Resolution status**. Two recommendations in this report were **changed** during revision:
> - **C4:** the SES suppression approach. The recommendation was to disable account-level suppression; it is now **SES tenant-level suppression** (ADR-003).
> - **§8 item 3:** `corepack enable` does not work, because corepack is not bundled with the installed Node 26. Install pnpm with `npm install -g --allow-scripts=pnpm pnpm@12.11.2`.

**Outcome:** The plan's overall direction holds up. **6 critical** and **11 major** issues must be fixed in the documents before Sprint 0. Phase 1 is **not approved** until the product owner confirms.

Severity: 🔴 Critical (a design flaw that would cause a security, data or deliverability failure) · 🟠 Major (wrong or missing; costly to fix later) · 🟡 Minor (clarity or consistency)

---

## 1. Critical findings

| # | Area | Finding | Recommended change |
|---|---|---|---|
| C1 | Tenant isolation | **Several lookups have to happen before the tenant is known, and RLS blocks every one of them:** API-key authentication (lookup by prefix), invitation acceptance (lookup by token), "list my organisations" after login (`memberships` is filtered by `tenant_id`), SES bounce/complaint events (lookup by `provider_message_id`), and tracker or unsubscribe tokens. As written, either these features break or a developer reaches for the `BYPASSRLS` role. | Add a small set of narrow **`SECURITY DEFINER` lookup functions** (for example `auth_resolve_api_key(prefix)` and `resolve_message_tenant(provider_msg_id)`) that return only the `tenant_id` and the minimum fields needed. Add a second `memberships` policy based on `app.user_id`. Embed `tenant_id` in every signed tracker or unsubscribe token. Write this down as **ADR-002a**. |
| C2 | Database | **Unique constraints on partitioned tables must include the partition key.** `messages` is partitioned by `created_at`, so the planned `UNIQUE (tenant_id, campaign_id, contact_id)` and the per-tenant `idempotency_key` uniqueness **cannot be created**. Duplicate-send protection (FR-5) would silently disappear for campaigns or retries that cross a month boundary. The FK from `message_events` to `messages` hits the same problem. | Enforce campaign idempotency in **`campaign_recipients`**, which is not partitioned and already keyed by `(tenant_id, campaign_id, contact_id)`, using a status state machine. Add a non-partitioned **`idempotency_keys`** table (with a TTL) for the transactional API. Have `message_events` store `message_id` and `message_created_at` without an FK, and check integrity in the application. |
| C3 | Privacy / isolation | **The global suppression list is readable by every tenant.** The policy `tenant_id IS NULL` exposes every address that complained or bounced on any tenant, which is a cross-tenant data leak. Separately, **putting a complaint against tenant A on the global list** blocks that person from every other tenant's mail. That is not industry practice and will draw disputes. | Tenants never read global rows. Sending code checks them through a `SECURITY DEFINER` function that returns booleans only. Global scope applies only to **hard bounces, invalid syntax or domain, and known spam traps** (with re-validation after a TTL). **Complaints and unsubscribes stay tenant-scoped.** |
| C4 | Deliverability | **The SES account-level suppression list is shared by all tenants**, because they all use one AWS account. A bounce on one tenant's mail would quietly suppress that address for everyone, outside our control and invisible in our data. | Turn off account-level suppression for each configuration set (`SuppressionOptions` empty) and keep our own suppression lists as the single source of truth. Run a Sprint 2 spike to evaluate SES's per-tenant reputation and isolation features against our own configuration-set approach. |
| C5 | Infrastructure | **One Redis instance cannot safely serve queues and caches at the same time.** BullMQ needs `maxmemory-policy noeviction`, while caches and rate limiters need an eviction policy. Under memory pressure, either jobs get evicted (lost sends) or every write fails (an outage). | Use **two Redis/Valkey instances**: `redis-queue` (noeviction, AOF persistence, Multi-AZ) and `redis-cache` (allkeys-lru) for sessions, rate limits and caches. Mirror the same split in Docker Compose. |
| C6 | Security | **SSRF through outbound webhooks.** Tenants supply webhook URLs, so they could point us at `169.254.169.254`, internal services or the VPC. | Allow only HTTPS. Resolve DNS and block private, loopback, link-local and metadata ranges, and re-check at connect time to defeat DNS rebinding. Use egress from an isolated subnet or proxy. Do not follow redirects. Apply the same guard to any future fetch-from-URL feature. |

## 2. Major findings

| # | Area | Finding | Recommended change |
|---|---|---|---|
| M1 | Sending reliability | Docs contradict each other: **"exactly once"** (S8.3 acceptance criteria) vs. **"at-least-once" jobs** (architecture) vs. **"at most once"** (FR-5). Exactly-once delivery to an external provider is impossible: if the worker crashes after SES accepts a message but before we record it, retrying sends a duplicate. | Choose **at-most-once for marketing email**. Mark a recipient `sending` before calling SES. On recovery, set stale `sending` rows to `unknown` and reconcile them against SES events (tagged with the recipient ID) rather than blindly resending. Reword FR-5 and the S8.3/S8.4 acceptance criteria to match. |
| M2 | Background jobs | **API → DB → queue is a dual write.** If enqueueing fails after the DB commits, a campaign is stuck in `queued`. Scheduled campaigns held only as BullMQ delayed jobs are lost if Redis is lost. | Make **Postgres the source of truth**: a transactional `outbox` table plus a relay, and a scheduler that runs every minute and enqueues due campaigns with `jobId = campaignId` (deduplicated). A reconciler re-enqueues stuck states. |
| M3 | Background jobs | Per-tenant and per-recipient-domain throttling **is not a built-in feature of open-source BullMQ** (group rate limits are a paid Pro feature). | Build token buckets as Redis Lua scripts in `packages/channels` and test them on their own. Workers also re-check tenant status (suspended or paused) **before every batch**. |
| M4 | Bounce/complaint pipeline | Delivering SNS events straight to an HTTPS endpoint loses them during an API outage once SNS stops retrying. | **SES → SNS → SQS → worker**, with an SQS dead-letter queue. This is a small, intentional exception to ADR-004 for durable intake from the provider. |
| M5 | Unsubscribe | Gaps: (a) automated link scanners request **GET** URLs, so a GET must **never** unsubscribe; it shows a confirmation page that submits a POST. (b) The one-click POST must work with no cookie or auth, be idempotent, and take effect immediately (Gmail allows at most 2 days). (c) Tokens must not expire quickly. (d) The scope of an unsubscribe is undefined. (e) Rules for **transactional** mail are undefined. | Signed, long-lived tokens carrying `{tenant, contact, campaign, channel}`. In the MVP, an unsubscribe covers **all marketing email from that tenant**; topics come with the preference centre in Release 2. Transactional sends ignore marketing unsubscribes but **honour bounce and complaint suppressions**. Record all of this in the PRD. |
| M6 | Data model | **Three overlapping sources of truth** decide whether a contact can be emailed: `contacts.status`, `contact_channel_subscriptions` and `suppressions`. | Define one rule, `sendable = subscription.status='subscribed' AND NOT suppressed(tenant) AND NOT suppressed(global)`, behind a single `isSendable` function. `contacts.status` becomes a derived display cache. |
| M7 | Security | **Rendering tenant HTML in the dashboard:** sanitising the preview alone is not enough. **Merge tags:** contact data is inserted into HTML, and in Release 2 that data comes from public forms, which makes it an XSS and phishing vector. | Show previews in a `sandbox` iframe (no scripts) served from a separate origin. Use **LiquidJS** with `outputEscape: 'escape'`, `ownPropertyOnly` and strict filters. Also fix the inconsistency that the tech stack says "Handlebars" while the backlog uses Liquid syntax. |
| M8 | Security | Missing: **platform-operator identity** (how operators log in, mandatory MFA, separation from tenant users), a **role/permission matrix**, CSV **formula injection** on export, presigned **upload size and type limits**, **public image hosting** for emails (the S3 bucket is private), encryption key rotation, account enumeration on signup, and protection of the `app_admin` (BYPASSRLS) credentials. | Add the matrix and operator model to the architecture doc. Run the operator console as a separate app or route with its own credentials. Add a public assets bucket behind a CDN with content-type checks. Escape CSV fields that start with `= + - @`. The full list is in §6. |
| M9 | Deliverability | Thresholds are too loose: an **auto-pause at 0.3% complaints** is Gmail's hard limit, and Gmail's guidance is to stay below 0.1%. DMARC is only "recommended", but **Gmail, Yahoo and Microsoft require DMARC for bulk senders**. Rates are not meaningful on small volumes. | Warn at 0.08% complaints and pause at 0.2%. Warn at 2% bounces and pause at 4%. Require a minimum sample size (for example ≥ 500 sends in the window). **Require a DMARC record** (`p=none` is enough) before a domain can send bulk mail. Add Microsoft's 2025 bulk-sender rules to the PRD. |
| M10 | Capacity | The PRD's target of **50k emails/hour per tenant** is about 14 messages/second, which equals **SES's default rate for an entire account**. One tenant would use the whole platform's capacity. | Request SES quota increases as a Sprint 0 action. Make the throughput target platform-wide, with per-tenant rates set by plan. Size the target only after the launch-scale answer (decision U5). |
| M11 | System email | Verification, invite and password-reset emails (Sprint 1) need a mail provider, but `ChannelProvider` arrives only in Sprint 4. They must also not share reputation with tenant marketing mail. | Move the minimal `ChannelProvider` (SMTP/Mailpit plus an SES stub) to **Sprint 1**. Send platform mail from a separate SES configuration set and our own domain. |

## 3. Minor inconsistencies

- The architecture module table lists a `sessions` **table**, but the DB doc keeps sessions in Redis. Use Redis.
- `tenants` has no RLS policy defined. Add `id = app.tenant_id` for `app_user`.
- RLS policies should use `(SELECT current_setting(...))`, which Postgres evaluates once per query (an initplan) rather than once per row. Without it, performance on large tables suffers.
- PgBouncer in transaction mode breaks named prepared statements unless PgBouncer is ≥ 1.21 with `max_prepared_statements`. Use no pooler in the MVP, or a pinned version.
- `contacts.email` must become nullable in Release 2 (SMS-only contacts). Plan the constraint as `CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)` now.
- Soft-deleted contacts conflict with the right to erasure. Purge after 30 days and pseudonymise `messages.to_address` and event IP addresses.
- PII in `message_events` (IP, user agent) needs a retention period. Add a tenant setting to **disable open/click tracking** (needed for EU recipients).
- The architecture leaves "web on Vercel **or** ECS" undecided. Decide AWS-only (see §5).
- PRD §5.1 lists A/B testing as a stretch goal, but S8.6 is never scheduled. Mark it explicitly as post-MVP.
- `Feedback-ID`: SES may set or modify this header. Verify in the Sprint 4 spike before relying on it.

## 4. Technology version check (npm registry, 2026-10-14)

| Component | Proposed | Latest | Verdict |
|---|---|---|---|
| **Node.js** | 24 LTS | 24 enters *maintenance* **2026-10-20**; **26 becomes LTS 2026-10-28** | 🔄 **Switch to Node 26 LTS.** The MVP ships around Feb 2027, so 26 will be the active LTS by then. Your machine already runs v26.4, which also clears that known issue. |
| **TypeScript** | 5.x | **7.0.2** | ⚠️ **Pin 6.0.x.** typescript-eslint 8.71 supports only TypeScript `<6.1`, so TS 7 would break linting. |
| typescript-eslint / ESLint | — | 8.71 / 10.12 | ✅ Compatible (ESLint ^10 is supported). |
| Next.js / React | Next (App Router) | 16.4 / 19.3 | ✅ Needs Node ≥ 20.9. |
| Tailwind | — | 4.3 | ✅ shadcn/ui supports v4. |
| Fastify | — | 5.12 | ✅ |
| zod + fastify-type-provider-zod | — | 4.6 + 7.0 | ✅ The provider requires zod ≥ 4.1.5 and fastify ^5.5. |
| Drizzle ORM | — | **0.45.4 stable; 1.0 is still RC** | ⚠️ Pin 0.45.x. Revisit when 1.0 reaches GA. The migration and RLS APIs differ between versions, so don't build on the RC. |
| BullMQ | — | **6.3** (major released 2026-07-30) | ⚠️ The current major is only 2.5 months old. Use 6.x but run a Sprint 0 spike covering retries, delayed jobs, and Valkey/ElastiCache compatibility. Fall back to 5.x if anything fails. |
| MJML | MJML | **5.4** | ✅ Use v5. |
| LiquidJS | (unspecified) | 10.30 | ✅ Adopt it (see M7). |
| Vitest | — | 5.0 | ✅ Needs Node 22.12+, 24 or ≥ 26. |
| Testcontainers | — | 12.2 | ✅ Needs Node ≥ 22.22 **and Docker** (blocker B2). |
| Playwright | — | 1.64 | ✅ |
| Postgres | 16+ | — | 🔄 Target the newest major that RDS supports in our region (17 or 18). 18 adds native `uuidv7()`. Pin it in Sprint 0. |
| Redis | 7 | — | 🔄 Use **Valkey 8** (ElastiCache's default engine, BSD-licensed) or Redis OSS 7.2. Avoid newer Redis builds under licences that are a poor fit for a SaaS. |
| pnpm / Turborepo | — | 12.11 / 2.11 | ✅ Pin through `packageManager` in `package.json`. |

Everything else in the stack (`@node-rs/argon2` 2.x, otplib 13, pino 10, AWS SDK v3, ioredis 6) is current and compatible. **Rule for Sprint 0:** pin exact versions and commit the lockfile. Upgrades go through Renovate PRs only.

## 5. Sprint plan review

**Dependency problems:**

1. **The mail provider comes too late:** the Sprint 1 auth emails and the Sprint 3 test send need `ChannelProvider` (Sprint 4). Move it to Sprint 1 (M11).
2. **Unsubscribe and the footer before the tracker:** S7.4 (Sprint 3) and S10.1 (Sprint 4) need the tracker app and signed tokens, but S9.1 is in Sprint 5. Move the tracker skeleton and token signing into Sprint 3.
3. **Real sends without bounce handling:** Sprint 4 sends campaigns, but bounce and complaint processing (S9.2, S10.2) arrive in Sprint 5. **Rule:** until Sprint 5 is done, staging may only send to Mailpit or the SES mailbox simulator. Add a platform feature flag `real_sending_enabled`.
4. **The audit log is needed from day one** (FR-7), but S2.6 is in Sprint 7. Move the audit *writer* to Sprint 1 and leave the viewer in Sprint 7.
5. **New-tenant sending caps** (S14.2) are in Sprint 6. The fields and the enforcement check must exist by Sprint 4; the operator UI can stay in Sprint 6.
6. **Staging and infrastructure arrive in Sprint 8**, but real SES domain verification (Sprint 2) and the end-to-end send (Sprint 4) need a staging environment. Pull a **minimal staging environment into Sprint 2 or 3**.
7. **Sprint 8 is overloaded** at about 43 points against a ~30 velocity, and saves hardening for the end. Spread observability and E2E tests across every sprint (added to the Definition of Done) and **add a Sprint 9** for load testing, security review and the release candidate.

**Acceptance criteria:** only Sprint 0 and about a third of the stories have explicit acceptance criteria. Recommendation:
- Add acceptance criteria now for every **P0** story.
- Plan each sprint's objectives, tasks, dependencies and test plan in detail at that sprint's planning session, so later sprints aren't over-specified before earlier ones teach us anything.
- Add **sprint-level exit criteria**: a demo, every new tenant table added to the isolation suite, and staging green.

**Missing stories:** change email address; delete account/organisation; transfer ownership (the last owner cannot leave); list and revoke sessions; operator login with MFA; outbox/scheduler (M2); SQS intake (M4); public asset hosting; per-tenant tracking toggle; data-retention jobs; Terms of Service and Acceptable Use Policy acceptance at signup.

## 6. Decisions that need your input

| # | Decision | Why it's yours | My recommendation |
|---|---|---|---|
| U1 | **Target markets and legal entity** (India only, or India + global) | Drives payments, compliance (DPDP, GDPR, TRAI DLT) and AWS region | India + global, with the AWS region in **ap-south-1 (Mumbai)** |
| U2 | **Payment provider** | Commercial: note that **Stripe India accounts are invite-only**, while Razorpay covers INR/UPI | Razorpay for India, plus Stripe (through a non-India entity) only if you sell globally |
| U3 | **Cloud account and budget** (AWS ownership, rough monthly budget) | Spend and ownership | AWS, which you own; I'll write a cost estimate once U5 is known |
| U4 | **Email provider**: SES or an existing contract | Commercial | SES |
| U5 | **Launch scale**: number of tenants and emails per month in the first 6 months | Drives sizing and SES quota requests | — |
| U6 | **Pricing and plans**: free trial vs. free tier, plan limits | Product and commercial | Trial plus manual review, no free tier |
| U7 | **Who reviews new tenants** for abuse, and how fast | Operational staffing | — |
| U8 | **Editor scope for the MVP** | Product scope (adds about 1–2 sprints) | Block editor plus MJML/HTML for the MVP; full drag-and-drop in Release 2 |
| U9 | **Brand and domains**: app, tracking, bounce and platform-mail domains | Ownership | — |
| U10 | **Legal documents**: ToS, AUP, privacy policy, DPA, DPDP consent wording | Requires a legal owner | Have counsel review before beta |
| U11 | **Unsubscribe scope and global suppression policy** (M5, C3) | Product and legal stance | As in M5 and C3; please confirm |

## 7. Technical decisions I will make (unless you object)

- Node **26 LTS**, TypeScript **6.0.x**, Drizzle **0.45.x**, BullMQ **6.x** (after a spike), MJML 5, **LiquidJS**, Postgres 17/18 (pinned in Sprint 0), **Valkey** with separate queue and cache instances.
- Everything on **AWS** (ECS Fargate for all four apps). No Vercel for `web`, so cookies, CORS and networking stay on one platform. The browser talks to the API through a **same-origin `/api` rewrite**.
- Fixes C1–C6 and M1–M11 as described above, recorded as ADRs.
- Rolling-wave sprint planning, a revised 10-sprint plan (0–9), and observability and E2E tests in the Definition of Done for every sprint.
- Keep authentication self-built on vetted primitives (Argon2id, otplib, Redis sessions), with an external security review in Sprint 9.

## 8. Blocking questions (needed before Sprint 0 can start)

Only these block the **start** of Sprint 0. The rest of §6 is needed by Sprint 2 (U3, U4, U9), Sprint 7 (U2, U6) or beta (U7, U10).

1. **Do you approve the corrections in §1–§5?** I will then update docs 01–05 and the ADRs, and you confirm Phase 1.
2. **U1 (markets) and U5 (scale):** these shape the schema (phone and consent fields, region) and capacity targets.
3. **Environment:** can you install **Docker Desktop** (WSL2) and run `corepack enable`? Without Docker, the database isolation tests cannot run locally.

---

## 9. Resolution status (v0.2, 2026-10-14)

| Finding | Resolution | Where |
|---|---|---|
| C1 Pre-tenant lookups vs RLS | NOLOGIN `rls_lookup` and `app_admin_fn` roles own narrow `SECURITY DEFINER` functions with pinned `search_path`, explicit `GRANT`s and per-function tests; a catalog test guards them. Tracker and unsubscribe tokens embed `tenant_id`. | ADR-002, `02` §4, `04` §2 and §4, S0.5, S1.7, S2.2, S2.3 |
| C2 Partitioned uniqueness | Idempotency moved to non-partitioned `campaign_recipients` (PK), `idempotency_keys` and `processed_provider_events`. `message_events` has no FK. | ADR-005, ADR-007, `04` §5.4–5.5 |
| C3 Global suppression leak | Split into `tenant_suppressions` (private) and `platform_suppressions` (hard bounces, invalid addresses, spam traps; no grants; boolean-only function). Complaints and unsubscribes are never platform-wide. | ADR-012 (**needs PO approval U11**), `04` §5.6 |
| C4 SES account-level suppression | **Revised.** Option B (disabling it) was rejected as unsafe. Chosen: an SES tenant per platform tenant with `SuppressionScope=TENANT` (BOUNCE+COMPLAINT), with our database as the primary check. Fallback: account scope, BOUNCE only. | ADR-003, `02` §7, spike S2.6 |
| C5 Queue vs cache Redis | valkey-queue (noeviction) and valkey-cache (LRU), locally and in AWS | ADR-004, `02` §6.4, `07` §1.1 |
| C6 Webhook SSRF | Full control set, including DNS pinning against rebinding, an isolated egress subnet, no redirects, and a test list | ADR-009, `02` §9, S12.3 |
| M1 Delivery guarantee conflict | At most once per (campaign, contact); `unknown` state plus `Send`-event reconciliation; "exactly once" removed everywhere | ADR-007, PRD FR-5, `02` §6, S8.5 |
| M2 Dual write and scheduling | Outbox, DB-backed scheduler, reconciler, lease sweeper | ADR-004, S8.3, S8.7 |
| M3 Throttling | Lua token buckets at three levels | ADR-004, S8.6 |
| M4 SNS→HTTP durability | SNS → SQS + DLQ | ADR-004, S9.2 |
| M5 Unsubscribe | GET never changes state; RFC 8058 POST; signed tokens that never expire; MVP scope defined; transactional rule (FR-9); DKIM header coverage checked in the spike | ADR-010, `02` §8, S10.1 |
| M6 Sendability sources | A single `isSendable` function; `display_status` is a derived cache only | PRD FR-3, `04` §5.3, S10.2 |
| M7 Preview XSS and merge tags | LiquidJS (escape by default, sandboxed); preview iframe on a separate origin | ADR-008, S7.1, S7.2 |
| M8 Security gaps | Operator identity, permission matrix, CSV formula escaping, upload limits, public asset bucket, key rotation, enumeration protection | `02` §4.4, §5, §11; S14.2, S5.3, S1.1 |
| M9 Thresholds and DMARC | Warn 0.08% / pause 0.2% complaints; 2% / 4% bounces with minimum volumes; DMARC required; campaign circuit breaker | `06` §4 and §5, S14.1, S2.5 |
| M10 Capacity claims | No throughput promise; quotas configurable; capacity measured in the S9 load test | PRD §4–5, `06` §2, S15.3 |
| M11 Auth email timing | Sprint 1 uses `SinkProvider` (Mailpit); staging sandbox from Sprint 2; SES provider in Sprint 4; `live` only after Sprint 9 | ADR-011, S1.5, S2.2, S8.1 |
| Minor findings | All addressed (sessions in Redis, `tenants` RLS, `(SELECT current_setting())`, pooler rules, nullable email, erasure purge, PII retention, tracking toggle, AWS-only, A/B moved to R2, Feedback-ID in the spike) | `02`, `04`, backlog |
| Sprint dependencies 1–7 | Provider moved earlier; tracker in S4; `live` blocked until S9; audit writer in S1; quotas in S5; staging in S2; Sprint 9 added; observability and E2E in the DoD | `05` |
| Acceptance criteria | Every MVP story now has AC | `05` |

### New findings raised during revision

| # | Finding | Action |
|---|---|---|
| N1 | corepack isn't bundled with Node 26 | Install pnpm with npm (`03` §1) |
| N2 | SES tenant management and tenant-level suppression exist (documented by AWS) | Adopted, subject to spike (ADR-003) |
| N3 | Gmail sends no complaint data to SES | Postmaster Tools monitoring, sunsetting, conservative thresholds (`06` §4) |
| N4 | RFC 8058 requires DKIM coverage of the unsubscribe headers; unknown whether SES Easy DKIM provides it | Spike S2.6; BYODKIM fallback (ADR-010) |
| N5 | India: CERT-In 6-hour incident reporting and 180-day log retention in India; DPDP Rules 2025; GST invoicing | PRD §8, `07` §2.3, S13.3, S15.6 |
| N6 | ElastiCache likely lacks AOF on current engines | Durability by design through Postgres reconciliation; MemoryDB as the upgrade path (ADR-004) |
| N7 | SES inbound (`mailto:` unsubscribe) not confirmed in ap-south-1 | https-only one-click in the MVP (ADR-010) |

---

## 10. Phase 1 approval (2026-10-14)

The product owner approved D1–D4, with two safeguards that have now been applied:
- **Shared suppression** is strictly qualified, privacy-protected and correctable (ADR-012, `06` §7).
- **Thresholds** are configurable guardrails with minimum-volume rules, provider signals and conservative pausing (ADR-015, `06` §4).

Before approval was recorded, a consistency check confirmed:
- status headers are updated;
- no stale suppression wording remains;
- the sprint point totals match the plan table (305 points);
- every MVP story has acceptance criteria;
- the ADR index is complete.

Phase 1 is marked **approved**. D5–D13 remain open and are scheduled by sprint in `PROGRESS.md`.
