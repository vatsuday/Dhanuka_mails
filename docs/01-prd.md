# 01 — Product Requirements Document (PRD)

**Product (working name):** Dhanuka Mails
**Type:** Multi-tenant SaaS for email marketing and multichannel (Email, SMS, WhatsApp) customer communication
**Status:** v1.0 — **approved** (Phase 1 approval: D1–D4, 2026-10-14). Changes from now on go through change control: update the doc, the ADR if relevant, and PROGRESS.md.
**Last updated:** 2026-10-14
**Change log:** v0.2 applies the Phase 1 review (`docs/reviews/phase1-review.md`) and the product decisions recorded in §9.

---

## 1. Problem statement

Small and mid-sized businesses, starting in **India**, need to reach customers reliably across email, SMS and WhatsApp. Today they juggle several tools, struggle with deliverability (SPF/DKIM/DMARC, bounces, spam complaints), and face growing rules: Gmail, Yahoo and Microsoft bulk-sender requirements, India's DPDP Act 2023 and DPDP Rules 2025, CERT-In directions, TRAI rules for SMS, and GDPR or CAN-SPAM when they mail recipients abroad.

## 2. Vision

One workspace where a business manages its audience, designs messages, sends campaigns and automated journeys across channels, and measures results, with deliverability and compliance built in by default.

## 3. Personas

| Persona | Description | Primary needs |
|---|---|---|
| **Owner / Admin** | Business owner or marketing lead | Billing, team, sending domains, compliance settings |
| **Marketer** | Creates campaigns | Fast editor, segmentation, scheduling, reports |
| **Developer** | Integrates the tenant's app | API keys, transactional send API, webhooks |
| **Contact** | Receives messages | Relevant content, working unsubscribe, privacy |
| **Platform Operator** | Our staff | Tenant review, abuse prevention, reputation, support |

## 4. Market and launch strategy

- **India first.** Data is hosted in AWS **ap-south-1 (Mumbai)**. Defaults are INR, `Asia/Kolkata` and `en-IN`.
- **Ready for international expansion.** Every tenant record carries `data_region`, `currency`, `timezone` and `locale`. No India-only assumption is hard-coded in the domain logic, and payment and SMS providers sit behind interfaces.
- **Controlled beta.** Tenants join by invitation and operator approval. Every tenant has **configurable quotas** (see `06-deliverability-policy.md`). **No throughput figure is promised to customers** until the Sprint 9 load test and real SES quotas have validated capacity.

## 5. Goals and success metrics (MVP)

Targets marked *design target* are engineering goals to be validated. They are not customer commitments.

| Goal | Metric | Target |
|---|---|---|
| Reliable delivery | Provider-accepted rate of sendable messages | ≥ 99.5% |
| No duplicate campaign mail | Duplicate sends per (campaign, contact) caused by the platform | 0 in all automated tests. In production, only the documented provider-ambiguity window applies (§6, FR-5) |
| Healthy reputation | Platform hard-bounce rate / complaint rate | < 2% / < 0.05% |
| Tenant isolation | Cross-tenant data access defects | 0, enforced by DB RLS and a CI isolation suite |
| Activation | Signup → verified domain → first (sandbox) campaign | < 30 min |
| Availability | Dashboard and API uptime | 99.9% (*design target*) |
| Throughput | Platform-wide sustained send rate | *Design target only.* Measured in the Sprint 9 load test and capped by the actual SES quota. Per-tenant rates are set by quota. |

## 6. Scope

### 6.1 MVP (Release 1): email first

1. **Accounts:** sign-up with email verification and acceptance of the Terms and Acceptable Use Policy; login; password reset; TOTP MFA; session management; change email and password.
2. **Tenancy:** organisations, invitations, roles (Owner, Admin, Marketer, Developer, Viewer), ownership transfer, an organisation switcher, API keys, an audit log.
3. **Sending domains:** DKIM (SES Easy DKIM), a custom MAIL FROM subdomain, and a **required DMARC record**. Free-mail From domains are blocked. Domains are re-verified daily.
4. **Contacts:** CRUD, custom fields, lists, tags, CSV import and export, consent records, per-channel subscription status.
5. **Segments:** a rule builder with live counts.
6. **Templates:** a block editor plus MJML/HTML, **LiquidJS** merge tags, preview, test send.
7. **Campaigns:** build, schedule, pause, resume, cancel. Scheduling is database-backed and sending is throttled and quota-limited.
8. **Tracking:** opens, clicks, bounces, complaints, unsubscribes. Tenants can turn tracking off.
9. **Compliance and deliverability:** one-click unsubscribe (RFC 8058), a mandatory footer, tenant-private suppression lists, a strictly qualified shared list for invalid addresses and permanent hard bounces (HMAC-stored, with false-positive correction), automatic suppression, reputation guards, sending modes (`sink`/`sandbox`/`live`).
10. **Reports:** a campaign report and an account health dashboard.
11. **Developer API:** a transactional send endpoint with idempotency keys, contacts and lists endpoints, signed outbound webhooks with SSRF protection.
12. **Billing:** plans, quotas, usage metering, a subscription provider (Razorpay assumed for India), and data for GST-compliant invoices.
13. **Platform admin:** separate operator identity, tenant review, tiers and quotas, suspension, health views.

### 6.2 Release 2: multichannel and automation

- SMS (TRAI TCCCPR / DLT: entity, header and template registration) and WhatsApp (Meta Cloud API, template approval, 24-hour session rule)
- Automation journeys, forms, preference centre with topics, double opt-in improvements
- Dedicated IPs and warm-up, custom tracking domains, A/B tests, ClickHouse analytics
- International rollout: Stripe for non-INR billing, additional AWS regions if data residency requires them

### 6.3 Release 3 and later

AI-assisted content, send-time optimisation, integrations (Shopify, WooCommerce, Zapier), SSO/SAML, white-labelling.

### 6.4 Out of scope

Inbound email or helpdesk, voice, push notifications, a landing-page builder, CRM pipelines.

## 7. Functional requirements: key rules

- **FR-1 Isolation:** every tenant-owned record has `tenant_id`, and PostgreSQL RLS prevents cross-tenant access. Lookups that must happen before the tenant is known use only the narrow functions listed in `04-database-design.md` §4.
- **FR-2 Send preconditions:** a campaign is sent only when all of these hold:
  - the From domain is `verified` (DKIM, MAIL FROM and DMARC all passing);
  - the footer has an unsubscribe link and the tenant's postal address;
  - the tenant is `active`, not paused or suspended;
  - quota is available;
  - the effective sending mode allows the recipient (FR-8).
- **FR-3 Sendability:** a contact is sendable on a channel only if `subscription = subscribed AND NOT tenant-suppressed AND NOT platform-suppressed`. One function, `isSendable`, decides this everywhere.
- **FR-4 Unsubscribe:**
  - Every marketing email carries `List-Unsubscribe` (an https URL) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  - **A GET request never unsubscribes.** It shows a confirmation page.
  - The one-click POST takes effect immediately, at most 1 minute and always well within Gmail's 2-day limit.
  - In the MVP, an unsubscribe covers **all marketing email from that tenant**.
- **FR-5 Duplicate prevention:** the platform calls the provider **at most once per (campaign, contact)**. If a provider call has an **ambiguous outcome** (timeout, or a crash after the request was sent), the recipient is marked `unknown` and is **never resent automatically**. The SES `Send` event reconciles it. **The platform does not claim exactly-once delivery** (ADR-007).
- **FR-6 Transactional idempotency:** API sends accept an `Idempotency-Key`. A repeat request with the same key and body within 24 hours returns the original result; the same key with a different body returns 422.
- **FR-7 Audit:** security-relevant and destructive actions are written to an append-only audit log, starting in Sprint 1.
- **FR-8 Sending modes:** `sink` (local and CI; no external delivery), `sandbox` (only the SES mailbox simulator and platform-verified team addresses), and `live`. The effective mode is the most restrictive of the platform mode and the tenant mode. `live` requires the production-readiness gate (`07-operations-readiness.md`).
- **FR-9 Transactional vs marketing:** transactional sends ignore marketing unsubscribes but **always honour** bounce and complaint suppressions.
- **FR-10 Imports:** imports of 100k or more rows run in the background with progress, deduplication and an error report. Consent is attested on every import.

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | OWASP ASVS L2 baseline: Argon2id, TOTP MFA, hashed tokens and API keys, CSRF protection (SameSite plus Origin check), strict CSP, rate limits, HMAC-signed webhooks, SSRF-safe outbound HTTP, sandboxed template previews, TLS 1.2+, encryption at rest |
| **Tenant isolation** | Shared schema, `tenant_id`, `FORCE ROW LEVEL SECURITY`, runtime role without `BYPASSRLS`. Pre-tenant lookups only through `SECURITY DEFINER` functions with a pinned `search_path` and explicit `GRANT`s, each covered by tests |
| **Deliverability** | Rules in `06-deliverability-policy.md`: DKIM, aligned MAIL FROM, required DMARC, one-click unsubscribe, quotas and warm-up, thresholds, SES tenant isolation |
| **Privacy (India)** | DPDP Act 2023 and DPDP Rules 2025 (phased commencement). Notice and consent records, purpose limitation, erasure on request, breach notification to the Data Protection Board and affected people within the required timelines, a published grievance contact. **Legal review is required** (U10). |
| **Cyber-security directions (India)** | CERT-In Directions (April 2022): report incidents within **6 hours**, keep ICT logs for **180 days within India**, synchronise clocks to NTP. |
| **International** | GDPR and CAN-SPAM handled at the tenant level for foreign recipients (footer, consent, erasure). The data-region field allows future regional deployments. |
| **Reliability** | Postgres is the source of truth for all durable state. Queue loss is recoverable by reconciliation. Job handlers are idempotent. RPO ≤ 15 min, RTO ≤ 4 h. |
| **Observability** | JSON logs with `tenant_id` and `request_id`, OpenTelemetry traces, deliverability and queue metrics, alerting (`07-operations-readiness.md`) |
| **Maintainability** | TypeScript strict mode, enforced module boundaries, ≥ 80% coverage on domain logic, ADRs for significant decisions |
| **Performance** (*design targets*) | Dashboard p95 < 500 ms. API p95 < 300 ms. Segment count < 3 s on 1M contacts. Validated in Sprint 9. |
| **Accessibility** | WCAG 2.1 AA for the dashboard |

## 9. Decisions

### Confirmed by the product owner (2026-10-14)

| Topic | Decision |
|---|---|
| Market | India first, with an architecture that supports international expansion |
| Launch scale | Controlled beta with configurable tenant quotas. No promise of 50k emails/hour per tenant. |
| Infrastructure | AWS preferred, subject to the cost estimate (`08-aws-cost-estimate.md`) and a practical local development environment |
| Methodology | Agile: small tasks, acceptance criteria, automated tests, approval at milestones |
| Review | Phase 1 review recommendations approved in principle |

### Approved at Phase 1 close (2026-10-14)

| # | Decision |
|---|---|
| D1 | v0.2 plan and sprint plan approved |
| D2 | Suppression scope approved, **with a safeguard**: the shared list covers only reliably classified invalid addresses and permanent hard bounces, stores no plaintext, never records temporary failures, and has documented false-positive correction (ADR-012, `06` §7) |
| D3 | In the MVP, an unsubscribe covers all marketing email from that tenant |
| D4 | Default quotas and thresholds approved as **configurable initial guardrails**, with minimum volumes, provider signals and conservative pausing (ADR-015, `06` §4) |

### Still pending

D5–D13 are listed in `docs/PROGRESS.md`, each with the sprint it is needed by.

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Platform abuse by spammers | Shared reputation damage, SES enforcement | Invite-only beta, operator review, sandbox mode for new tenants, quotas and warm-up, reputation guard, SES tenant isolation |
| SES limits (sandbox, quota, send rate) | Launch blocked or throughput capped | Request production access and quota increases early (Sprint 2), with no throughput promises |
| Cross-tenant data leak | Critical legal and security incident | RLS, narrow lookup functions, CI isolation suite, security review |
| Ambiguous provider outcomes | Rare duplicates or missed sends | `unknown` state plus SES `Send`-event reconciliation; never auto-resend |
| Gmail complaints are not reported to SES | Complaint rate under-counted | Gmail Postmaster Tools monitoring, conservative thresholds, engagement-based sunsetting |
| New SES features (tenant management, tenant suppression) | Behaviour in ap-south-1 unproven | Sprint 2 spike with a documented fallback (ADR-003) |
| Regulatory change (DPDP Rules phases, mailbox-provider rules) | Rework | Compliance requirements are isolated in the policy docs and reviewed each release |
