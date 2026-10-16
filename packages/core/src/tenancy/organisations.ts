// Organisations (S1.6, S1.7). A tenant is created with its owner membership, its sending policy and
// an audit row in one withTenant transaction, so RLS checks every insert against the new tenant.
import { randomBytes, randomUUID } from 'node:crypto';
import { memberships, tenants, tenantSendingPolicies, users, withTenant, withUser, type Database } from '@dm/db';
import { and, eq, sql } from 'drizzle-orm';
import { recordAudit, type RequestContext } from '../audit.ts';
import type { Result } from '../identity/service.ts';
import type { Role } from './permissions.ts';

export interface Membership {
  tenantId: string;
  tenantName: string;
  role: Role;
  tenantStatus: string;
}

export const MAX_ORG_NAME = 120;

/** URL-safe slug from a name: lowercase ASCII letters, digits and single hyphens, at most 48 characters. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug === '' ? 'org' : slug;
}

const isUniqueViolation = (error: unknown, constraint: string): boolean => {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
  return cause?.code === '23505' && cause.constraint === constraint;
};

export class OrganisationService {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** S1.6: a verified user creates an organisation and becomes its owner. */
  async create(
    userId: string,
    rawName: string,
    ctx: RequestContext,
  ): Promise<Result<{ tenantId: string; slug: string }, 'email_not_verified' | 'invalid_name'>> {
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > MAX_ORG_NAME) return { ok: false, error: 'invalid_name' };
    const [user] = await this.#db.select({ verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
    if (user?.verifiedAt == null) return { ok: false, error: 'email_not_verified' };

    // Other tenants' slugs are invisible under RLS, so uniqueness is detected by the constraint;
    // on a clash, retry with a short random suffix.
    const base = slugify(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base.slice(0, 43)}-${randomBytes(3).toString('hex').slice(0, 4)}`;
      const tenantId = randomUUID();
      try {
        await withTenant(this.#db, tenantId, async (tx) => {
          // Defaults (docs/04 §5.1, docs/06 §2): pending_review, INR, Asia/Kolkata, en-IN, ap-south-1; tier and mode sandbox.
          await tx.insert(tenants).values({ id: tenantId, name, slug });
          await tx.insert(memberships).values({ tenantId, userId, role: 'owner' });
          await tx.insert(tenantSendingPolicies).values({ tenantId });
          await recordAudit(tx, { tenantId, actorType: 'user', actorId: userId, action: 'org.created', targetType: 'tenant', targetId: tenantId, metadata: { slug } }, ctx);
        });
        return { ok: true, tenantId, slug };
      } catch (error) {
        if (!isUniqueViolation(error, 'tenants_slug_unique')) throw error;
      }
    }
    throw new Error('could not find a free organisation slug');
  }

  /** S1.7: the user's organisations, through app.list_user_memberships. */
  async list(userId: string): Promise<Membership[]> {
    const result = await withUser(this.#db, userId, (tx) =>
      tx.execute<{ tenant_id: string; tenant_name: string; role: Role; tenant_status: string }>(
        sql`select tenant_id, tenant_name, role, tenant_status from app.list_user_memberships(${userId})`,
      ),
    );
    return result.rows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name, role: r.role, tenantStatus: r.tenant_status }));
  }

  /** The user's role in a tenant, or undefined if they are not a member. */
  async role(tenantId: string, userId: string): Promise<Role | undefined> {
    return (await this.access(tenantId, userId))?.role;
  }

  /**
   * Everything the access check needs, in one transaction, on every tenant request: the member's role,
   * whether the organisation requires MFA, and whether the user has it (S2.1 AC 5).
   */
  async access(tenantId: string, userId: string): Promise<{ role: Role; requireMfa: boolean; userMfaEnabled: boolean } | undefined> {
    const [row] = await withTenant(this.#db, tenantId, (tx) =>
      tx.select({ role: memberships.role, requireMfa: tenants.requireMfa, userMfaEnabled: users.mfaEnabled })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId))),
    );
    return row;
  }

  /** S2.1 AC 5: the owner requires MFA for every member. The owner needs MFA first, or they would lock themselves out. */
  async setRequireMfa(tenantId: string, userId: string, required: boolean, ctx: RequestContext): Promise<Result<object, 'enable_mfa_first'>> {
    const [user] = await this.#db.select({ mfaEnabled: users.mfaEnabled }).from(users).where(eq(users.id, userId));
    if (required && user?.mfaEnabled !== true) return { ok: false, error: 'enable_mfa_first' };
    await withTenant(this.#db, tenantId, async (tx) => {
      await tx.update(tenants).set({ requireMfa: required, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
      await recordAudit(tx, { tenantId, actorType: 'user', actorId: userId, action: 'org.mfa_requirement_changed', metadata: { required } }, ctx);
    });
    return { ok: true };
  }

  async get(tenantId: string): Promise<{ id: string; name: string; slug: string; status: string; currency: string; timezone: string; locale: string; dataRegion: string; requireMfa: boolean } | undefined> {
    const [row] = await withTenant(this.#db, tenantId, (tx) =>
      tx.select({
        id: tenants.id, name: tenants.name, slug: tenants.slug, status: tenants.status,
        currency: tenants.currency, timezone: tenants.timezone, locale: tenants.locale, dataRegion: tenants.dataRegion,
        requireMfa: tenants.requireMfa,
      }).from(tenants),
    );
    return row;
  }
}
