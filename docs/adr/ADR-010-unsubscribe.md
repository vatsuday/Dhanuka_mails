# ADR-010: Unsubscribe handling

**Status:** Accepted (Phase 1 approval, 2026-10-14); header DKIM coverage to be confirmed by spike S2.6 · **Date:** 2026-10-14 · Resolves review finding M5

## Decision
- **GET never changes state.** It shows a confirmation page. HEAD and prefetch requests also never change state.
- **RFC 8058 one-click:** a `POST` with `List-Unsubscribe=One-Click` unsubscribes immediately, with no cookie or CSRF token required. It is idempotent and takes effect within 1 minute.
- **Confirmation-page POST:** unsubscribes and offers resubscription, which needs another click and is recorded as consent.
- **Scope (MVP):** all marketing email from that tenant. Topics come in Release 2. Transactional mail is unaffected.
- **Token:** `v1.{kid}.{payload}.{hmac}`, carrying the tenant, contact, message, channel and stream.
  - No email address in the token; no expiry.
  - Keys rotate yearly, and old keys stay valid for verification for at least 24 months.
  - Invalid tokens get a generic response, so the endpoint can't be used as an oracle.
- **Headers:** `List-Unsubscribe` (https) and `List-Unsubscribe-Post`. No `mailto:` in the MVP, because SES inbound receiving in ap-south-1 is unconfirmed.
- **DKIM coverage:** RFC 8058 requires both headers to be covered by DKIM. The spike verifies whether Easy DKIM covers them. **If not, we switch the tenant identities to BYODKIM** and sign those headers ourselves.
