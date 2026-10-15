// Audit writer (S1.9). Append-only: the runtime role can only INSERT and SELECT audit_logs.
import { randomUUID } from 'node:crypto';
import { auditLogs, type Database } from '@dm/db';

export type AuditActorType = 'user' | 'api_key' | 'system' | 'operator';

/** Request metadata recorded with every event. */
export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuditEvent {
  /** null for user-level events with no organisation (sign-up, login). Never visible to tenants. */
  tenantId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  /** dotted lower_snake, e.g. `auth.login_failed`. */
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/** Anything that can insert: the database or a transaction (pass the withTenant transaction for tenant events). */
export type Inserter = Pick<Database, 'insert'>;

const MAX_USER_AGENT = 512;

export async function recordAudit(db: Inserter, event: AuditEvent, context: RequestContext = {}): Promise<void> {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    tenantId: event.tenantId,
    actorType: event.actorType,
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    metadata: event.metadata ?? {},
    ip: context.ip ?? null,
    userAgent: context.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
    createdAt: new Date(),
  });
}
