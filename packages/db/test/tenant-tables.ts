// Registry of tenant tables for the isolation suite (Definition of Done item 3: every new tenant
// table is added here). isolation.test.ts fails if a table with tenant_id is missing from this list.

export interface IsolationFixtures {
  /** Creates a global user (as the superuser) and returns its ID. */
  newUser: () => Promise<string>;
  unique: () => string;
}

export interface TenantTable {
  /** Schema-qualified name, as the catalog reports it. */
  name: string;
  /** The column the policy compares with the current tenant. */
  tenantColumn: 'tenant_id' | 'id';
  /** A valid new row owned by `tenantId`. Used to seed each tenant and for spoofed inserts. */
  row: (tenantId: string, fx: IsolationFixtures) => Promise<Record<string, unknown>>;
}

/** In dependency order: a table's parents come before it. */
export const TENANT_TABLES: readonly TenantTable[] = [
  {
    name: 'app.tenants',
    tenantColumn: 'id',
    row: (tenantId) => Promise.resolve({ id: tenantId, name: 'Isolation tenant', slug: `iso-${tenantId}` }),
  },
  {
    name: 'app.memberships',
    tenantColumn: 'tenant_id',
    row: async (tenantId, fx) => ({ tenant_id: tenantId, user_id: await fx.newUser(), role: 'owner' }),
  },
  {
    name: 'app.contacts',
    tenantColumn: 'tenant_id',
    row: (tenantId, fx) => Promise.resolve({ tenant_id: tenantId, email_normalized: `${fx.unique()}@example.in` }),
  },
];
