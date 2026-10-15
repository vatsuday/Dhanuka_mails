// audit_logs is range-partitioned by month, which drizzle-kit cannot generate, so its DDL is
// hand-written (migrations/0003_audit_logs.sql) and this definition is kept out of drizzle.config.ts.
// It exists only so inserts and selects are typed.
import { inet, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { app } from './schema.ts';

export const AUDIT_ACTOR_TYPES = ['user', 'api_key', 'system', 'operator'] as const;

/** Tenant table 🔒 (tenant_id null = user- or platform-level event, never visible to tenants). Append-only. */
export const auditLogs = app.table('audit_logs', {
  id: uuid('id').notNull(),
  tenantId: uuid('tenant_id'),
  actorType: text('actor_type', { enum: AUDIT_ACTOR_TYPES }).notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
