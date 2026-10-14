# ADR-015: Deliverability thresholds as configurable guardrails

**Status:** Accepted (D4, 2026-10-14, with safeguards) · **Date:** 2026-10-14
**Policy detail:** `06-deliverability-policy.md` §2–§4

## Context
The product owner approved the default quotas and thresholds as **configurable initial guardrails**, on condition that they:
- take minimum volume into account;
- use provider signals;
- pause conservatively for serious incidents or when data is insufficient.

## Decision
1. **Configurable, versioned and audited:**
   - platform defaults live in `deliverability_settings` (versioned rows);
   - per-tenant overrides live in `tenant_sending_policies`;
   - only operators can change either, and must give a reason.
   Values are reviewed after the first beta month and then quarterly.
2. **Minimum-volume rule:** rate thresholds count only above a minimum volume (500 sends for bounces, 1,000 delivered for complaints). Above that, a pause needs the **95% Wilson lower bound** to exceed the threshold. Warnings use point estimates.
3. **Insufficient data means conservative behaviour:**
   - absolute-count backstops apply (≥ 3 complaints in 24 h for `new` tenants; ≥ 25 hard bounces when sends < 500);
   - warm-up doesn't advance without enough evaluable volume;
   - unusually large campaigns from `new` tenants are held for review;
   - the first campaign is capped;
   - if provider event ingestion is delayed or broken, new campaigns are held.
4. **Serious incidents pause immediately, with no minimum volume:** SES high-severity findings or an SES pause, confirmed spam traps or blocklist listings, verified abuse, blocklisted content or URLs, and sudden volume spikes from `new` tenants.
5. **Provider signals used:**
   - SES tenant findings and status (EventBridge);
   - SES account metrics (CloudWatch alarms below AWS review thresholds);
   - deferral rates per recipient domain (throttle down, not pause);
   - Gmail Postmaster Tools (manual weekly in beta);
   - daily blocklist lookups;
   - engagement-based sunsetting.
6. **Unpausing is always an operator decision** with a recorded reason. A repeat pause within 30 days escalates to an admin-level operator.

## Consequences
- **Guardrail evaluator:** a pure, unit-tested function `evaluate(metrics, settings) → {ok | warn | pause, reasons[]}`, tested at boundaries, small samples and missing data.
- **Delivered in:** Sprint 6, story S14.1, extended with these AC.
- **Reviewing thresholds:** dashboards show each tenant's metrics together with sample sizes and confidence bounds, so operators can see whether a threshold is working.
