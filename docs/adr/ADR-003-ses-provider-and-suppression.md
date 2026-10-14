# ADR-003: Amazon SES with tenant management, and the suppression configuration

**Status:** Accepted (Phase 1 approval, 2026-10-14); key assumptions to be confirmed by spike S2.6 · **Date:** 2026-10-14 · Revises review finding C4

## Context
- By default, SES's **account-level suppression list** is shared by every tenant in the AWS account. One tenant's bounce **or complaint** would suppress that address for all tenants.
- AWS documentation (read 2026-10-14) shows that **SES tenant management** (launched August 2025) supports:
  - isolated tenants with associated identities and configuration sets;
  - per-tenant reputation policies (Standard, Strict, None) with automatic pausing;
  - EventBridge notifications for tenant status changes and findings;
  - **tenant-level suppression lists** (`SuppressionScope=TENANT`).
- Under tenant scope: hard bounces go to the tenant list **and** the SES global list; complaints go to the tenant list only; Gmail sends no complaint data to SES; suppressed sends still count toward the sending quota.
- Pricing (verified): $0.005 per tenant per month plus $0.005 per 1,000 emails.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. Keep account-level suppression (default) | Zero work; strong reputation backstop | Complaints leak across tenants; tenants see suppressions they can't explain |
| B. Disable SES suppression; rely only on our DB | Full control | **No backstop if our checks have a bug.** Repeated hard bounces damage the shared reputation. **Rejected as unsafe.** |
| **C. SES tenant per platform tenant, `SuppressionScope=TENANT`, reasons `BOUNCE`+`COMPLAINT`** | Privacy model matches ours; keeps an AWS-side backstop; per-tenant reputation enforcement | Newer feature; small cost; still needs verification in ap-south-1 |

## Decision
**Option C.**
- **Mapping:** one SES tenant per platform tenant, named `t-{tenantId}` and created on approval. Tenant domains are associated with it, along with the shared configuration sets `cs-mkt-new`, `cs-mkt-std` and `cs-txn`.
- **Reputation policy:** Strict for the `sandbox` and `new` tiers; Standard for the others.
- **Platform system mail** uses `cs-system` on our own domain with **account-level** suppression (BOUNCE+COMPLAINT). Only our own mail uses it, so nothing leaks.
- **Our database is the primary suppression check.** SES suppression is the backstop. SES-side suppression events (`OnTenantSuppressionList`, `OnAccountSuppressionList`) are mirrored into our tables.
- **Gmail:** complaint metrics exclude Gmail, so we monitor through Gmail Postmaster Tools and apply engagement sunsetting.

## Fallback (if the spike finds C unavailable or unreliable in ap-south-1)
- Per-tenant configuration sets with suppression overridden to **account scope, `BOUNCE` only**. Hard bounces describe the address itself, so sharing them reveals nothing tenant-specific.
- Complaints are handled only in our database.
- Per-tenant pausing is then enforced only by our reputation guard.
- **Safeguard (ADR-012):** SES counts some policy rejections as Permanent bounces. In the fallback, entries on the SES account list are **not** copied into our shared list unless our classifier qualifies the bounce. A weekly job removes SES account-list entries that don't qualify (`DeleteSuppressedDestination`), so temporary failures and policy blocks don't suppress an address for other tenants.

## Note on the SES global suppression list
Under either option, SES adds hard bounces to its own AWS-wide global suppression list. AWS manages that list, not us. We never copy it into `platform_suppressions` unless our classifier qualifies the underlying bounce.

## Spike S2.6 must confirm
- Tenant creation and resource association.
- `TenantName` on `SendEmail` through SDK v3.
- Tenant suppression behaviour and its bounce subtype.
- EventBridge events.
- Whether Easy DKIM signs `List-Unsubscribe` and `List-Unsubscribe-Post` (affects ADR-010).
- Feedback-ID header handling.

## Sources
- https://docs.aws.amazon.com/ses/latest/dg/tenants.html
- https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list-tenant-level.html
- https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html
- https://aws.amazon.com/ses/pricing/
