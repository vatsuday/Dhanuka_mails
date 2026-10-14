# ADR-012: Suppression scope — tenant-private lists and a strictly qualified platform list

**Status:** Accepted (D2, 2026-10-14, with safeguards) · **Date:** 2026-10-14 · Resolves review finding C3
**Policy detail:** `06-deliverability-policy.md` §7

## Context
In v0.1, a complaint against one tenant was suppressed for every tenant, and every tenant could read the global list, which was a privacy leak.

The product owner approved tenant-private complaints and unsubscribes, plus a shared list, **on condition that** the shared list:
- covers only reliably classified invalid addresses and permanent hard bounces;
- protects address privacy;
- never lets a temporary failure create a shared entry;
- has documented false-positive correction.

## Decision

1. **Tenant-private (`tenant_suppressions`, RLS):** unsubscribes, complaints, repeated soft bounces or transient failures, policy blocks (`5.7.x`), manual entries, and SES tenant-list mirrors.
2. **Shared (`platform_suppressions`), qualified only by:**
   - an SES Permanent bounce of subtype General or NoEmail **with** a matching enhanced status code (`5.1.1`, `5.1.10`, or `5.1.0`/`5.1.2` with a diagnostic confirming non-existence);
   - an invalid domain (NXDOMAIN or null MX) **confirmed twice at least 24 h apart**;
   - invalid syntax;
   - an operator-confirmed spam trap or abuse case.
   **Excluded:** transient or undetermined bounces, 4xx, `5.2.x`, `5.3.x`, `5.4.x`, `5.7.x`, content and size rejections, SES suppression-list bounces, DNS timeouts, role and disposable addresses, complaints and unsubscribes.
   Each entry records `rule_id` and `classifier_version`.
3. **Privacy:**
   - Only `HMAC-SHA256(pepper, normalized_address)` is stored, with the pepper in KMS and Secrets Manager. No plaintext.
   - Tenants query only through `platform_suppressed()`, which answers **only for addresses already among the calling tenant's own contacts**, returns booleans, and is rate-limited.
   - No source tenant, date or diagnostic is ever shown.
4. **False-positive correction:**
   - Tenant re-check requests, with an operator review SLA.
   - Audited operator removal; an address is re-added only on new qualifying evidence.
   - Automatic 30-day re-validation of domain-level entries.
   - Bulk reversal by `classifier_version` or `rule_id`, with a dry-run count first.
   - A route for recipients to raise a case through support.
   - Monthly monitoring of removal and re-bounce rates.
5. Mailbox-level entries don't expire automatically, because recycled addresses become spam traps.

## Consequences
- **Plaintext:** operators handling a removal must be given the address by the requester. They compute its HMAC; they can't browse the list.
- **Unit tests** cover every classification rule, using SES bounce fixtures for each type, subtype and status code.
- **Integration tests** confirm that a tenant can't query addresses outside its own contacts.

## Alternative considered
Tenant-only bounce lists. Every tenant would then bounce once on every dead address, which hurts the shared IP reputation that all tenants rely on.
