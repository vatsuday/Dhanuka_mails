# apps/

Deployable processes (ADR-001), created as skeletons in S0.8. Each exposes `GET /health` (liveness) and `GET /ready` (readiness).

| App | Port | Runs as | `/ready` checks |
|---|---|---|---|
| `web` | 3000 | Next.js 16, `next build` → standalone server | none (no direct DB or Valkey access) |
| `api` | 3001 | Node, TypeScript source (ADR-016) | postgres, valkey-queue, valkey-cache |
| `tracker` | 3002 | Node, TypeScript source | postgres, valkey-queue, valkey-cache |
| `worker` | 3003 | Node, TypeScript source. BullMQ processors; first one is the `tenant-sample` job (S0.7) | postgres, valkey-queue |
| `webhook-worker` | 3004 | Node, TypeScript source (isolated egress, ADR-009) | postgres, valkey-queue |
| `admin` | 3005 | Node, TypeScript source (separate deployment) | postgres, valkey-cache |

Ports bind to 127.0.0.1 by default. Set `HOST`/`HOSTNAME=0.0.0.0` inside containers.
