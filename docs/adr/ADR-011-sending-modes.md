# ADR-011: Sending modes and the live-sending gate

**Status:** Accepted (Phase 1 approval, 2026-10-14) · **Date:** 2026-10-14

## Decision
- **Three modes:**
  - `sink`: local and CI; nothing is delivered externally.
  - `sandbox`: only the SES simulator and platform-verified team addresses.
  - `live`.
- **Effective mode** = the stricter of the platform mode and the tenant mode.
- **Enforcement** happens in `SendingModeGuard`, inside the provider adapter, immediately before the network call.
- **Defence in depth:** staging's SES account stays in the AWS SES sandbox.
- **Start-up checks:**
  - Production refuses to start in `live` mode without `SENDING_LIVE_APPROVED_AT` and `SENDING_LIVE_APPROVED_BY`, which the release pipeline sets after the readiness gate (`07` §4).
  - Non-production environments refuse `live` at start-up.
- **New tenants** start in `sandbox` until an operator approves them.
- **System mail** (verification, reset, invitations) follows the same modes.

## Consequences
Before Sprint 9, no real recipient can receive mail from any environment.
