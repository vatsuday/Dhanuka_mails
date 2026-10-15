// Sample tenant job (S0.7 AC 4): the pattern every tenant job follows. The payload carries the
// tenant ID, and the handler does all database work inside withTenant (ADR-002), so row-level
// security scopes every query to that tenant.
import { contacts, withTenant, type Database } from '@dm/db';
import { count, isNull } from 'drizzle-orm';

export const TENANT_SAMPLE_QUEUE = 'tenant-sample';

export interface TenantSampleJob {
  tenantId: string;
}

export interface TenantSampleResult {
  activeContacts: number;
}

export async function processTenantSample(db: Database, data: TenantSampleJob): Promise<TenantSampleResult> {
  return withTenant(db, data.tenantId, async (tx) => {
    const [row] = await tx.select({ n: count() }).from(contacts).where(isNull(contacts.deletedAt));
    return { activeContacts: row?.n ?? 0 };
  });
}
