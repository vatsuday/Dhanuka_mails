// Drizzle schema (docs/04-database-design.md §5). Table DDL is generated from this file with
// `pnpm --filter @dm/db db:generate`. Row-level security, grants and triggers are not expressible
// here, so they live in hand-written SQL migrations next to the generated ones (migrations/).
import { sql } from 'drizzle-orm';
import { boolean, char, check, index, jsonb, pgSchema, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const app = pgSchema('app');

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const TENANT_STATUSES = ['pending_review', 'active', 'paused', 'suspended', 'closed'] as const;
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'marketer', 'developer', 'viewer'] as const;
export const CONTACT_DISPLAY_STATUSES = ['subscribed', 'unsubscribed', 'bounced', 'complained', 'undeliverable'] as const;

const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** Tenant table 🔒: the policy matches `id`, not `tenant_id`. Cross-tenant lookups go through functions. */
export const tenants = app.table(
  'tenants',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status', { enum: TENANT_STATUSES }).notNull().default('pending_review'),
    dataRegion: text('data_region').notNull().default('ap-south-1'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    locale: text('locale').notNull().default('en-IN'),
    /** Required before any campaign send (enforced by the send path, not here). */
    postalAddress: jsonb('postal_address'),
    gstin: text('gstin'),
    sesTenantName: text('ses_tenant_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenants_status_check', sql`${t.status} IN (${oneOf(TENANT_STATUSES)})`),
    // Indian GSTIN: 2-digit state code, PAN, entity number, 'Z', checksum character.
    check('tenants_gstin_format', sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`),
  ],
);

/** Global (no tenant_id, no RLS). The runtime role may only SELECT and UPDATE it. */
export const users = app.table('users', {
  id: id(),
  email: text('email').notNull(),
  emailNormalized: text('email_normalized').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  termsVersion: text('terms_version'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Tenant table 🔒. A deferred constraint trigger keeps at least one owner per tenant. */
export const memberships = app.table(
  'memberships',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role', { enum: MEMBERSHIP_ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('memberships_tenant_user_key').on(t.tenantId, t.userId),
    check('memberships_role_check', sql`${t.role} IN (${oneOf(MEMBERSHIP_ROLES)})`),
  ],
);

/** Tenant table 🔒. Contacts are soft-deleted, then purged after 30 days. */
export const contacts = app.table(
  'contacts',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    email: text('email'),
    emailNormalized: text('email_normalized'),
    phoneE164: text('phone_e164'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    attributes: jsonb('attributes').notNull().default({}),
    /** Derived cache for the UI only. Never used for send decisions (FR-3). */
    displayStatus: text('display_status', { enum: CONTACT_DISPLAY_STATUSES }),
    source: text('source'),
    /** `{basis, captured_at, ip, notice_version, attested_by}` */
    consent: jsonb('consent'),
    lastEngagedAt: timestamp('last_engaged_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('contacts_email_or_phone', sql`${t.emailNormalized} IS NOT NULL OR ${t.phoneE164} IS NOT NULL`),
    check('contacts_display_status_check', sql`${t.displayStatus} IN (${oneOf(CONTACT_DISPLAY_STATUSES)})`),
    check('contacts_phone_e164_format', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    uniqueIndex('contacts_tenant_email_key')
      .on(t.tenantId, t.emailNormalized)
      .where(sql`${t.deletedAt} IS NULL AND ${t.emailNormalized} IS NOT NULL`),
    uniqueIndex('contacts_tenant_phone_key')
      .on(t.tenantId, t.phoneE164)
      .where(sql`${t.deletedAt} IS NULL AND ${t.phoneE164} IS NOT NULL`),
    // GIN cannot lead with tenant_id without btree_gin; RLS still filters by tenant first.
    index('contacts_attributes_gin').using('gin', t.attributes),
  ],
);
