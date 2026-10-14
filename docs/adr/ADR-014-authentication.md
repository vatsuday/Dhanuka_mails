# ADR-014: Self-built authentication on vetted primitives

**Status:** Accepted (Phase 1 approval, 2026-10-14) · **Date:** 2026-10-14

## Decision
- **Primitives:** Argon2id (`@node-rs/argon2`), TOTP (`otplib`), server-side sessions in valkey-cache, and hashed single-use tokens. The parameters are in `02-architecture.md` §5.
- **Operators** have a separate identity store and mandatory MFA.
- **Review:** an independent security review in Sprint 9 covers authentication specifically.

## Rationale
- Multi-tenant memberships, roles and RLS context need tight control.
- The surface area is small.
- No per-user vendor cost.

## Revisit
Use Better Auth or a hosted identity provider if SSO/SAML (Release 3) or WebAuthn requirements outgrow this approach.
