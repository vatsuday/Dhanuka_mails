# ADR-009: SSRF-safe outbound webhooks

**Status:** Accepted (Phase 1 approval, 2026-10-14) · **Date:** 2026-10-14 · Resolves review finding C6

## Decision
Every control below is specified in `02-architecture.md` §9.
- **URL rules:** HTTPS on port 443 only; no userinfo; IP literals rejected in every notation; a DNS name is required.
- **Validation timing:** checked at registration **and** at every delivery.
- **DNS:** all A and AAAA records are resolved, and the request is rejected if **any** address is in a blocked range (private, loopback, link-local and metadata, CGNAT, documentation, multicast and reserved ranges, IPv4-mapped and embedded IPv6, our VPC).
- **IP pinning:** the connection goes to the validated IP, so DNS rebinding can't take effect.
- **No redirects.**
- **Limits:** connect timeout 3 s, total 10 s, response body 8 KB. TLS verification stays on.
- **Isolation:** a dedicated `webhook-worker` service in a subnet whose egress is limited to port 443, excluding the VPC and `169.254.0.0/16`.
- **Signing and retries:** Standard Webhooks signatures; 8 retries over about 24 h, then auto-disable.
- **Reuse:** the same SSRF-safe HTTP client (`packages/security`) is required for any future feature that fetches a user-supplied URL.

## Tests
Sprint 8 story S12.3 lists the payloads that must be blocked.
