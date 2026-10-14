# apps/

Deployable processes (ADR-001). These are created as skeletons in Sprint 0 story S0.8:

| App | Purpose |
|---|---|
| `web` | Next.js dashboard |
| `api` | Fastify tenant and public API |
| `tracker` | Open, click and unsubscribe endpoints |
| `worker` | BullMQ processors, scheduler, reconciler, outbox relay |
| `webhook-worker` | Outbound tenant webhooks, on isolated egress |
| `admin` | Operator console and API (separate deployment) |
