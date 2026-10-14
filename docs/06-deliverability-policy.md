# 06 — Deliverability and Sending Policy

**Status:** v1.0 — **approved** (Phase 1 approval, 2026-10-14). Defaults approved as **configurable initial guardrails** (D4, 2026-10-14). Safeguards applied for shared suppression (§7, ADR-012) and guardrail evaluation (§4, ADR-015).
**Last updated:** 2026-10-14

> Every number in this document is an **initial guardrail**, not a fixed law. Values live in versioned `deliverability_settings` (platform defaults) with per-tenant overrides in `tenant_sending_policies`. Only operators can change them, and every change is audited with a reason. We review them after the first beta month and then quarterly, using real data.

## 1. Sending modes (test-only restrictions)

| Mode | Where | What can be delivered | Enforced by |
|---|---|---|---|
| `sink` | Local, CI, automated tests | **Nothing leaves the system.** Mail goes to Mailpit (SMTP) or an in-memory sink. | `SENDING_MODE=sink` default; `SinkProvider` |
| `sandbox` | Staging, plus any tenant not yet approved for live sending | Only (a) SES mailbox simulator addresses (`*@simulator.amazonses.com`) and (b) **platform-verified team addresses** on the allowlist | `SendingModeGuard` in `packages/channels`. Staging's SES account also stays in the **SES sandbox**, a second, AWS-enforced layer. |
| `live` | Production only | Any sendable recipient within quota | Requires the readiness gate (§8) **and** an operator-approved tenant |

**Rules:**
- **Most restrictive mode wins:** effective mode = the stricter of (platform mode, tenant `send_mode`).
- **The guard is the last step before the network.** `SendingModeGuard` runs inside the provider adapter, so no code path can skip it.
- **Production can't silently become `live`.** It refuses to start in `live` mode without `SENDING_LIVE_APPROVED_AT` and `SENDING_LIVE_APPROVED_BY`. Non-production environments reject `live` at start-up.
- **Platform mail** (verification, reset, invitations) follows the same modes.

## 2. Tenant tiers and default quotas (initial guardrails)

| Tier | Entry | `send_mode` | Daily limit | Hourly limit | Max contacts | SES reputation policy |
|---|---|---|---|---|---|---|
| `sandbox` | Signup (`pending_review`) | sandbox | 50 (allowlist only) | 20 | 1,000 | Strict |
| `new` | Operator approval (domain verified, postal address present, AUP accepted, business checked) | live | **500** on day 1, rising with warm-up (§3) | 20% of daily | 10,000 | Strict |
| `standard` | 14 days in `new` + ≥ 10,000 delivered + health within guardrails + operator approval | live | Plan quota (default **20,000**) | 25% of daily | Plan | Standard |
| `trusted` | Operator decision | live | Operator-set | Operator-set | Plan | Standard |

**Platform-wide caps:**
- The global send rate is at most **80% of the SES account's max send rate**, read from SES `GetAccount` at start-up and every hour.
- Per-recipient-domain token buckets start conservatively and are tuned during the Sprint 9 load test and beta.

**No throughput is promised.** Any customer-facing figure must come from the Sprint 9 load test and the SES quota actually granted.

## 3. Warm-up (tier `new`)

- **Limit growth:** the next day's limit is `min(previous × 1.5, tier ceiling)`, but **only if** both of these hold:
  - the previous day had no warnings (§4);
  - the previous day reached the **minimum evaluable volume** (§4.2).
  If there isn't enough data to judge the tenant's health, the limit **does not grow**. That is conservative by design.
- **Holds and resets:** any warning holds the limit for 3 days. A pause resets the limit to the last healthy value.
- **First sends:** the first campaigns should go to the most engaged contacts (guidance in the UI). Lists with no engagement in 12 months need an operator review before sending.

## 4. Deliverability guardrails (ADR-015)

### 4.1 Rate-based guardrails

Rates are measured per tenant over **rolling 24 h and 7 d windows**.

| Metric | Definition | Warn | Auto-pause | Minimum volume for the rate to count |
|---|---|---|---|---|
| Hard bounce rate | qualifying hard bounces / sends | ≥ **2%** | ≥ **4%** | 500 sends |
| Complaint rate | complaints / delivered (providers that report complaints; Gmail excluded) | ≥ **0.08%** | ≥ **0.2%** | 1,000 delivered |
| Unknown-user rate at import | invalid addresses at validation | ≥ 5% of the file | Import held for operator review | 500 rows |
| Unsubscribe rate (per campaign) | unsubscribes / delivered | ≥ 1% (warning only) | — | 1,000 delivered |
| Deferral rate per recipient domain | 4xx deferrals / attempts to that domain | ≥ 10% | **Throttle down, not pause:** that domain's bucket rate is halved, then recovers gradually | 200 attempts |

### 4.2 Small samples and insufficient data

Rates computed from small samples are unreliable in both directions: they can trigger false pauses, and they can miss real problems. So:

1. **Below the minimum volume, rate-based rules don't trigger a pause.** Instead the following apply.
2. **Absolute-count backstops** apply at any volume:
   - **≥ 3 complaints** within 24 h from a `new`-tier tenant, or ≥ 10 from any tenant → **pause and review**;
   - **≥ 25 qualifying hard bounces** within 24 h when total sends are under 500 → **pause and review**.
3. **Statistical gate at or above the minimum volume:** a rate counts as "over threshold" only when the **lower bound of its 95% Wilson score interval** exceeds the threshold. That prevents a pause caused by noise. Warnings use the simple point estimate, so they fire early.
4. **Conservative defaults while data is insufficient:**
   - warm-up doesn't advance (§3);
   - a `new` tenant's single campaign larger than **2× its current daily limit**, or larger than 5,000 recipients, is **held for operator review**;
   - the first campaign of a newly approved tenant is capped at 500 recipients.
5. **Unknown is not healthy:** if provider event ingestion is delayed (SQS age > 15 min) or broken (DLQ > 0), **new campaigns are held** platform-wide until it recovers. We never send blind.

### 4.3 Serious incidents: immediate pause, no minimum volume

Any one of these pauses the tenant immediately and opens an operator review:
- an SES **high-severity** reputation finding for the tenant, or SES pausing the tenant;
- an operator-confirmed **spam-trap hit**, or a blocklist listing (for example Spamhaus DBL/ZEN) attributable to the tenant's domain or content;
- an abuse report verified by an operator (phishing, malware, purchased lists);
- an import containing operator-confirmed spam-trap addresses (held before any send);
- message content or links that match URL or domain blocklists (checked at schedule time);
- a sudden volume spike: a tenant in the `new` tier sending more than 3× its 7-day average.

### 4.4 Provider signals

| Signal | Source | How it's used |
|---|---|---|
| SES tenant reputation findings and status | EventBridge | Low severity → warn. High severity → pause (§4.3). SES's own pause is mirrored. |
| SES account bounce and complaint rates | CloudWatch | Platform alarms at 2.5% bounce and 0.05% complaint (AWS review thresholds are 5% and 0.1%). Pages on-call. |
| Bounce, deferral and complaint events | SES events | Rates in §4.1, suppression in §7 |
| Gmail Postmaster Tools | Manual weekly review in beta; API integration later | Gmail sends no complaints to SES. Keep the spam rate < 0.1% and never ≥ 0.3%. A drop in domain reputation → operator review of that tenant. |
| Blocklists (Spamhaus DBL for tenant and tracking domains) | Daily lookups | A listing → serious incident (§4.3) |
| Engagement | Our events | No opens or clicks in 6 months → sunset flag. Apple MPP opens counted as machine opens. |

### 4.5 Pausing and unpausing

- **Pausing:** running campaigns stop at the next batch boundary. The tenant gets an email and an in-app notice, an operator alert is raised, and the SES tenant is paused.
- **Unpausing:** **only an operator can unpause**, and must record a reason. After unpausing, the tenant returns to its last healthy daily limit. A second pause within 30 days requires an admin-level operator.
- **Campaign circuit breaker:** after the first 1,000 sends of a campaign (and every 1,000 after that), the campaign pauses itself if the hard bounce rate exceeds **5%** or the complaint rate exceeds **0.3%** (Wilson lower bound, as in §4.2). It needs an explicit resume.

## 5. Domain authentication requirements

A domain becomes `verified` only when **all** of the following pass. It is re-checked every 24 hours. Any regression sets it to `degraded`, blocks sending from it and notifies the tenant.

| Check | Requirement |
|---|---|
| Ownership + DKIM | SES Easy DKIM with **2048-bit** keys; all three CNAMEs resolve |
| Custom MAIL FROM | `bounce.<domain>`: MX → `feedback-smtp.ap-south-1.amazonses.com`, TXT `v=spf1 include:amazonses.com ~all`, **`BehaviorOnMxFailure = RejectMessage`** |
| DMARC | A valid `v=DMARC1` record at `_dmarc.<organisational domain>`. `p=none` is accepted; `quarantine` or `reject` is recommended. **Required.** |
| Alignment | DKIM `d=` is the From domain. SPF aligns through the MAIL FROM subdomain (relaxed). |
| Blocked From domains | Free-mail and consumer domains, and our own platform domains |
| Ownership conflicts | A domain verified by another tenant is rejected. Parent/child domain conflicts go to operator review. |
| DNS failure handling | A **temporary** DNS failure (SERVFAIL or timeout) does not degrade a domain. Only 2 consecutive failed checks at least 1 h apart do. |

## 6. Unsubscribe and consent

Defined fully in `02-architecture.md` §8 and ADR-010:
- A GET request never unsubscribes; it shows a confirmation page.
- The one-click POST (RFC 8058) unsubscribes immediately, at most 1 minute after the request.
- In the MVP, an unsubscribe covers all marketing email from that tenant (D3, approved).
- Tokens never expire.

Every import requires a consent attestation.

## 7. Suppression (ADR-012; D2 approved with safeguards)

### 7.1 Tenant-private (`tenant_suppressions`)

Unsubscribes, complaints, repeated soft bounces (3 over 7 or more days), mailbox-full or other transient failures past the threshold, policy blocks, manual entries, and SES `OnTenantSuppressionList` mirrors.

### 7.2 Shared platform list (`platform_suppressions`): strict qualification

An address is added **only** with one of these pieces of reliable evidence:

| Evidence | Qualifies when |
|---|---|
| **Permanent mailbox bounce** | SES `bounceType = Permanent`, `bounceSubType ∈ {General, NoEmail}`, **and** the recipient MTA's enhanced status code is one of `5.1.1` (bad mailbox), `5.1.10` (null MX / recipient address has null MX), or `5.1.2` / `5.1.0` with a diagnostic confirming the address doesn't exist |
| **Invalid domain** | NXDOMAIN or a null MX (RFC 7505), **confirmed by 2 checks at least 24 h apart** |
| **Invalid syntax** | The address fails RFC 5321/5322 syntax validation, or its domain is not a valid domain name |
| **Spam trap or abuse** | Operator-confirmed only |

These **never** go on the shared list. They stay tenant-private, or are only counted:
- transient or undetermined bounces;
- any 4xx response;
- `5.2.x` (mailbox full or over quota);
- `5.4.x` (routing or DNS problems);
- `5.7.x` (policy, spam or reputation blocks; these describe the **sender**, not the address);
- `5.3.x` (system problems);
- `MessageTooLarge`, `ContentRejected`, `AttachmentRejected`, `UnsupportedAttachment`;
- SES `Suppressed`, `OnAccountSuppressionList` and `OnTenantSuppressionList` (those are suppressions, not bounce evidence);
- DNS SERVFAIL or timeout;
- role or disposable addresses (tenant-level flag only);
- complaints and unsubscribes.

Each entry stores the `rule_id` and `classifier_version` that qualified it, so a classifier bug can be reversed in bulk (§7.4).

### 7.3 Address privacy

- The shared list stores **no plaintext address**. It stores `address_hmac = HMAC-SHA256(platform_pepper, normalized_address)`, where the pepper is held in KMS and Secrets Manager, plus the domain only when the entry is domain-level.
- **Tenants can't probe arbitrary addresses.** `platform_suppressed()` answers only for addresses that already exist as contacts **in the calling tenant**, in the current transaction's tenant context, and it is rate-limited.
- **No other tenant information is disclosed.** It returns a boolean. The UI shows "Undeliverable (platform)" with no source tenant, date or bounce text.
- Raw bounce diagnostics are kept only on the originating tenant's `message_events`, and shared rows reference them by ID.

### 7.4 False-positive correction

1. **Tenant request:** a tenant can choose "Request re-check" on a contact marked "Undeliverable (platform)" and give a reason, for example "customer confirmed by phone". Operators review within **2 business days** (SLA set in D12).
2. **Operator removal:** sets `removed_at`, `removed_by` and `removal_reason`, and is audited. The removal applies platform-wide. If the address hard-bounces again with qualifying evidence, it is re-added and the history is kept.
3. **Domain-level entries** (NXDOMAIN or null MX) are **automatically re-validated every 30 days** and removed if the domain now has valid MX records. Domains get re-registered.
4. **Mailbox-level entries don't expire automatically,** because abandoned addresses get recycled as spam traps. They are removed only by evidence-based review.
5. **Classifier bug:** entries are bulk-reversed by `classifier_version` or `rule_id` through an audited operator function, with a dry-run count shown first.
6. **Recipients:** a person who believes they are wrongly blocked can contact the tenant or our support address (published in the privacy policy). Operators verify ownership through a confirmation email sent **under the operator's control, outside the suppression path**.
7. **Monitoring:** removal rate, re-bounce-after-removal rate and classifier-rule hit counts are reviewed monthly. A rule whose removed entries mostly don't bounce again is a sign of false positives and gets fixed.

### 7.5 SES

Tenant-level suppression (scope `TENANT`, reasons `BOUNCE` and `COMPLAINT`) is a backstop. Our database is the primary check (ADR-003).

### 7.6 Transactional mail

Transactional mail ignores unsubscribes but honours every bounce and complaint suppression.

## 8. Production readiness gate for `live` sending

`live` mode is enabled only after the checklist in `07-operations-readiness.md` §4 is signed off by the product owner.
