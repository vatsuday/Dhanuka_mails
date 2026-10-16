# ADR-017: Brevo as an additional email provider (tenant-owned accounts)

**Status:** Accepted (PO instruction 2026-10-16: "do best what we can have") · **Date:** 2026-10-16 · Extends ADR-003, ADR-011

## Context
- The PO wants bulk sending to work "the way Brevo does", and real sending is blocked until the AWS account, a domain and the D5 cost approval exist (B4, B5).
- All email already goes through the `ChannelProvider` interface behind the sending-mode guard (ADR-011), so a second provider is an adapter, not a redesign.
- Brevo's transactional API (`POST https://api.brevo.com/v3/smtp/email`, header `api-key`) sends single messages or batches of up to **1,000 `messageVersions` per call**, at most 2,000 recipients per request, and 100 calls a minute (6,000 an hour). Read 2026-10-16: https://developers.brevo.com/docs/batch-send-transactional-emails, https://developers.brevo.com/reference/sendtransacemail.
- **Unverified:** whether Brevo's terms allow one platform account to send for many unrelated businesses. Nothing found in the Terms of Use (version 2025-10-01) either way.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. SES only (ADR-003) | Cheapest at volume; per-tenant SES reputation and suppression | Nothing real can be sent until AWS is ready |
| B. One platform Brevo account for every tenant | Sending works early | One abusive tenant can get the shared account suspended for everyone; reselling terms unverified; no per-tenant isolation |
| **C. Tenants connect their own Brevo account (API key); SES stays the platform default** | Sending works early; each tenant's reputation, quota, billing and Brevo-side suppression are their own; no reselling question | Tenants need a Brevo account; Brevo also keeps contact data (tenants' own contract with Brevo) |

## Decision
**Option C.**
- `BrevoProvider` in `@dm/channels` implements `send` (one message) and `sendBatch` (up to 1,000 messages in one call as `messageVersions`).
- **The guard still applies to every message**, including each recipient in a batch, which is checked before the call (all or nothing). In `sink` mode Brevo is never called; in `sandbox` only allowlisted recipients are allowed.
- **Batching rule:** Brevo applies `headers` to the whole request, not per version. A batch is accepted only when every message has the same sender and the same headers. Messages with per-recipient headers (for example per-contact `List-Unsubscribe` URLs, ADR-010) are sent one by one. The send pipeline (S8) decides which applies.
- Errors are `ProviderError`s marked `retryable` (network, timeout, HTTP 429 and 5xx) or not (400, 401, 403, other 4xx), so the worker can retry or fail without parsing messages. **API keys never appear in errors or logs.**
- Tenant API keys will be stored envelope-encrypted with the S2.1 KEK machinery (`crypto/envelope.ts`), bound to `brevo:<tenantId>`. The connection UI and storage are a new story, **S2.11 Connect a Brevo account**, after S2.4.
- Our own suppression, consent, unsubscribe and guardrail checks (ADR-010, ADR-012, ADR-015) run **before** any provider. Brevo's own blocklist is a backstop, as SES's is.
- Platform system mail (verification, reset, invitations) keeps the platform provider (sink locally, SES later), never a tenant's Brevo account.

## Consequences
- Real bulk sending can be demonstrated with a tenant's Brevo key before AWS exists.
- Bounce, complaint and unsubscribe events from Brevo arrive by Brevo webhooks. Mapping them onto our events is part of S10 (event ingestion), alongside SES.
- Two providers mean two sets of delivery events and limits to test; the provider name is stored on every message record.

## To verify before a tenant uses Brevo in `live` mode
- A real send with a test key (single and batch) and the response IDs.
- Whether Brevo signs our custom headers with DKIM, and how its own unsubscribe footer interacts with ADR-010.
- Brevo's error codes for exhausted credits and suspended accounts, and the 429 behaviour.
