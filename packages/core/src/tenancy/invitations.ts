// Invitations (S2.2). Owners and admins invite by email with a role no higher than their own; the
// token is 32 random bytes stored as SHA-256, valid 7 days, single use. Before the invitee belongs to
// the tenant the invitation is resolved only through app.lookup_invitation (docs/04 §4).
import { INVITABLE_ROLES, invitations, memberships, tenants, users, withTenant, type Database } from '@dm/db';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { recordAudit, type RequestContext } from '../audit.ts';
import { normalizeEmail } from '../identity/email.ts';
import type { RateLimiter, RateLimitRule } from '../identity/rate-limit.ts';
import type { Result } from '../identity/service.ts';
import { hashToken, isWellFormedToken, issueToken } from '../identity/tokens.ts';
import type { SystemMailer } from '../mailer.ts';
import type { Role } from './permissions.ts';

export type InvitableRole = (typeof INVITABLE_ROLES)[number];
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Invitations send email to addresses the platform has never seen: cap them per tenant. */
export const INVITE_LIMIT: RateLimitRule = { name: 'invite', limit: 20, windowMs: 60 * 60_000 };

const RANK: Record<Role, number> = { owner: 4, admin: 3, developer: 2, marketer: 2, viewer: 1 };

/** AC 1: a role can be granted only by someone whose own role is at least as high. Never owner. */
export function canGrant(own: Role, granted: string): granted is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(granted) && RANK[granted as InvitableRole] <= RANK[own];
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: InvitableRole;
  expiresAt: Date;
  createdAt: Date;
}

export interface InvitationPreview {
  tenantName: string;
  email: string;
  role: InvitableRole;
  expiresAt: Date;
}

export interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  mfaEnabled: boolean;
  joinedAt: Date;
}

interface LookupRow extends Record<string, unknown> {
  invitation_id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  role: InvitableRole;
  expires_at: Date;
}

export interface InvitationDependencies {
  db: Database;
  mailer: SystemMailer;
  limiter: RateLimiter;
  now?: () => Date;
}

export class InvitationService {
  readonly #db: Database;
  readonly #mailer: SystemMailer;
  readonly #limiter: RateLimiter;
  readonly #now: () => Date;

  constructor(deps: InvitationDependencies) {
    this.#db = deps.db;
    this.#mailer = deps.mailer;
    this.#limiter = deps.limiter;
    this.#now = deps.now ?? (() => new Date());
  }

  /** AC 1, 5, 6. Inviting the same email again replaces the pending invitation (the old link stops working). */
  async create(
    tenantId: string,
    inviter: { userId: string; role: Role },
    rawEmail: string,
    role: string,
    ctx: RequestContext,
  ): Promise<Result<{ invitationId: string }, 'invalid_email' | 'role_not_allowed' | 'already_member' | 'rate_limited'>> {
    const email = normalizeEmail(rawEmail);
    if (email === undefined) return { ok: false, error: 'invalid_email' };
    if (!canGrant(inviter.role, role)) return { ok: false, error: 'role_not_allowed' };
    const limit = await this.#limiter.hit(INVITE_LIMIT, tenantId);
    if (!limit.allowed) return { ok: false, error: 'rate_limited', retryAfterMs: limit.retryAfterMs };

    const { token, hash } = issueToken();
    const created = await withTenant(this.#db, tenantId, async (tx) => {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, tenantId), eq(users.emailNormalized, email)));
      if (member !== undefined) return undefined;
      const now = this.#now();
      const replaced = await tx
        .update(invitations)
        .set({ revokedAt: now })
        .where(and(eq(invitations.tenantId, tenantId), eq(invitations.emailNormalized, email), pending()))
        .returning({ id: invitations.id });
      const [row] = await tx
        .insert(invitations)
        .values({ tenantId, emailNormalized: email, role, tokenHash: hash, invitedBy: inviter.userId, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) })
        .returning({ id: invitations.id });
      if (row === undefined) throw new Error('invitation insert returned nothing');
      await recordAudit(tx, {
        tenantId, actorType: 'user', actorId: inviter.userId, action: 'org.invitation_created',
        targetType: 'invitation', targetId: row.id, metadata: { role, replaced: replaced.map((r) => r.id) },
      }, ctx);
      const [org] = await tx.select({ name: tenants.name }).from(tenants);
      return { invitationId: row.id, organisation: org?.name ?? 'an organisation' };
    });
    if (created === undefined) return { ok: false, error: 'already_member' };

    const [sender] = await this.#db.select({ name: users.name, email: users.emailNormalized }).from(users).where(eq(users.id, inviter.userId));
    await this.#mailer.invitation(email, token, { organisation: created.organisation, inviter: sender?.name ?? sender?.email ?? 'A teammate', role });
    return { ok: true, invitationId: created.invitationId };
  }

  /** Pending invitations, including expired ones not yet replaced (the UI shows them as expired). */
  async listPending(tenantId: string): Promise<InvitationSummary[]> {
    return withTenant(this.#db, tenantId, (tx) =>
      tx
        .select({ id: invitations.id, email: invitations.emailNormalized, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
        .from(invitations)
        .where(pending())
        .orderBy(asc(invitations.createdAt)),
    );
  }

  /** AC 4. */
  async revoke(tenantId: string, actorId: string, invitationId: string, ctx: RequestContext): Promise<Result<object, 'not_found'>> {
    const revoked = await withTenant(this.#db, tenantId, async (tx) => {
      const rows = await tx
        .update(invitations)
        .set({ revokedAt: this.#now() })
        .where(and(eq(invitations.id, invitationId), pending()))
        .returning({ id: invitations.id });
      if (rows.length === 0) return false;
      await recordAudit(tx, { tenantId, actorType: 'user', actorId, action: 'org.invitation_revoked', targetType: 'invitation', targetId: invitationId }, ctx);
      return true;
    });
    return revoked ? { ok: true } : { ok: false, error: 'not_found' };
  }

  /** What the accept page shows. Only for pending, unexpired invitations (AC 2). */
  async preview(token: string): Promise<InvitationPreview | undefined> {
    const row = await this.#lookup(token);
    return row === undefined ? undefined : { tenantName: row.tenant_name, email: row.email, role: row.role, expiresAt: new Date(row.expires_at) };
  }

  /** AC 2, 3, 5: the signed-in user's verified email must match; the invitation is consumed atomically. */
  async accept(
    userId: string,
    token: string,
    ctx: RequestContext,
  ): Promise<Result<{ tenantId: string }, 'invalid_token' | 'email_not_verified' | 'email_mismatch' | 'already_member'>> {
    const invitation = await this.#lookup(token);
    if (invitation === undefined) return { ok: false, error: 'invalid_token' };
    const [user] = await this.#db.select({ email: users.emailNormalized, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
    if (user?.verifiedAt == null) return { ok: false, error: 'email_not_verified' };
    if (user.email !== invitation.email) return { ok: false, error: 'email_mismatch' };

    const tenantId = invitation.tenant_id;
    const outcome = await withTenant(this.#db, tenantId, async (tx) => {
      const [existing] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
      if (existing !== undefined) return 'already_member' as const;
      // Re-checks every condition, so a concurrent accept, revoke or expiry wins cleanly.
      const consumed = await tx
        .update(invitations)
        .set({ acceptedAt: this.#now(), acceptedBy: userId })
        .where(and(eq(invitations.id, invitation.invitation_id), eq(invitations.tokenHash, hashToken(token)), pending(), gt(invitations.expiresAt, this.#now())))
        .returning({ id: invitations.id });
      if (consumed.length === 0) return 'invalid_token' as const;
      await tx.insert(memberships).values({ tenantId, userId, role: invitation.role });
      await recordAudit(tx, {
        tenantId, actorType: 'user', actorId: userId, action: 'org.invitation_accepted',
        targetType: 'invitation', targetId: invitation.invitation_id, metadata: { role: invitation.role },
      }, ctx);
      return 'accepted' as const;
    });
    return outcome === 'accepted' ? { ok: true, tenantId } : { ok: false, error: outcome };
  }

  async members(tenantId: string): Promise<Member[]> {
    return withTenant(this.#db, tenantId, (tx) =>
      tx
        .select({ userId: memberships.userId, email: users.emailNormalized, name: users.name, role: memberships.role, mfaEnabled: users.mfaEnabled, joinedAt: memberships.createdAt })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .orderBy(asc(memberships.createdAt)),
    );
  }

  async #lookup(token: string): Promise<LookupRow | undefined> {
    if (!isWellFormedToken(token)) return undefined;
    const result = await this.#db.execute<LookupRow>(sql`select * from app.lookup_invitation(${hashToken(token)})`);
    return result.rows[0];
  }
}

const pending = () => and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));
