// Drizzle schema (docs/04-database-design.md §5). Table DDL is generated from this file with
// `pnpm --filter @dm/db db:generate`. Row-level security, grants and triggers are not expressible
// here, so they live in hand-written SQL migrations next to the generated ones (migrations/).
import { sql } from 'drizzle-orm';
import { boolean, char, check, customType, index, integer, jsonb, pgSchema, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const app = pgSchema('app');

/** Raw bytes (token and secret hashes). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const TENANT_STATUSES = ['pending_review', 'active', 'paused', 'suspended', 'closed'] as const;
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'marketer', 'developer', 'viewer'] as const;
export const TOKEN_PURPOSES = ['verify_email', 'reset_password', 'change_email'] as const;
export const TENANT_TIERS = ['sandbox', 'new', 'standard', 'trusted'] as const;
export const TENANT_SEND_MODES = ['sandbox', 'live'] as const;
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
  /** Acceptable Use Policy acceptance (S1.1 AC 2), recorded separately from the terms. */
  aupAcceptedAt: timestamp('aup_accepted_at', { withTimezone: true }),
  aupVersion: text('aup_version'),
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
    // For app.list_user_memberships (pre-tenant lookup by user); the one index that cannot lead with tenant_id.
    index('memberships_user_id_idx').on(t.userId),
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

/** Global. Verification, reset and email-change tokens: 32 random bytes, stored only as a SHA-256 hash. */
export const userTokens = app.table(
  'user_tokens',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    purpose: text('purpose', { enum: TOKEN_PURPOSES }).notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('user_tokens_purpose_check', sql`${t.purpose} IN (${oneOf(TOKEN_PURPOSES)})`),
    check('user_tokens_hash_length', sql`octet_length(${t.tokenHash}) = 32`),
    index('user_tokens_user_purpose_idx').on(t.userId, t.purpose),
  ],
);

/**
 * Tenant table 🔒, one row per tenant (docs/04 §5.1). Defaults are the `sandbox` tier from
 * docs/06 §2. Tenants may read their row; only operator functions change it after creation.
 */
export const tenantSendingPolicies = app.table(
  'tenant_sending_policies',
  {
    tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
    tier: text('tier', { enum: TENANT_TIERS }).notNull().default('sandbox'),
    sendMode: text('send_mode', { enum: TENANT_SEND_MODES }).notNull().default('sandbox'),
    dailyLimit: integer('daily_limit').notNull().default(50),
    hourlyLimit: integer('hourly_limit').notNull().default(20),
    maxRatePerSec: integer('max_rate_per_sec').notNull().default(1),
    maxContacts: integer('max_contacts').notNull().default(1000),
    warmupDay: integer('warmup_day'),
    pauseReason: text('pause_reason'),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    /** References operators(id) once the operators table exists (S14.2). */
    reviewedByOperatorId: uuid('reviewed_by_operator_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenant_sending_policies_tier_check', sql`${t.tier} IN (${oneOf(TENANT_TIERS)})`),
    check('tenant_sending_policies_mode_check', sql`${t.sendMode} IN (${oneOf(TENANT_SEND_MODES)})`),
    check('tenant_sending_policies_limits_check', sql`${t.dailyLimit} >= 0 AND ${t.hourlyLimit} >= 0 AND ${t.maxRatePerSec} >= 0 AND ${t.maxContacts} >= 0`),
  ],
);
