# ADR-008: MJML 5 + LiquidJS with sandboxed rendering

**Status:** Accepted (Phase 1 approval, 2026-10-14) · **Date:** 2026-10-14 · Resolves review finding M7 (the Handlebars vs Liquid inconsistency)

## Decision
- **MJML 5.4** compiles to HTML when a template is saved. **LiquidJS 10.29** (pinned in S0.3 under the 14-day rule; see ADR-006) renders it per recipient at send time.
- **LiquidJS settings:**
  - `outputEscape: 'escape'` for HTML;
  - `ownPropertyOnly: true` and `strictFilters: true`;
  - file-system tags (`include`, `render`, `layout`) disabled through a custom fs that throws;
  - `parseLimit`, `renderLimit` and `memoryLimit` set.
- **Subject and plain-text part:** no HTML escaping, but CR and LF are stripped from the subject to prevent header injection.
- **Previews** render in a sandboxed iframe (no `allow-scripts`) on a separate preview origin.

## Rejected
Handlebars: its helpers allow more code execution, and the backlog already used Liquid syntax.
