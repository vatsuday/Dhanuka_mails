// Identity module (S1.1–S1.4, S1.9). Framework-agnostic: the API maps results to HTTP.
// Anti-enumeration: sign-up, resend and reset return the same result whether or not the account exists.
import { userTokens, users, type Database, type TOKEN_PURPOSES } from '@dm/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { recordAudit, type RequestContext } from '../audit.ts';
import type { SystemMailer } from '../mailer.ts';
import { normalizeEmail } from './email.ts';
import { checkPasswordPolicy, DEFAULT_ARGON2, hashPassword, verifyPassword, type Argon2Params, type BreachedPasswordChecker, type PasswordProblem } from './passwords.ts';
import { LOGIN_LIMIT, loginFailureDelayMs, RESET_LIMIT, SIGNUP_LIMIT, VERIFY_RESEND_LIMIT, type RateLimiter } from './rate-limit.ts';
import type { SessionStore } from './sessions.ts';
import { isWellFormedToken, issueToken, hashToken } from './tokens.ts';

/** The legal documents a user must accept at sign-up. Bump when either document changes. */
export const CURRENT_TERMS_VERSION = '2026-10-15';
export const CURRENT_AUP_VERSION = '2026-10-15';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

type Purpose = (typeof TOKEN_PURPOSES)[number];

export interface Logger {
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface IdentityDependencies {
  db: Database;
  sessions: SessionStore;
  limiter: RateLimiter;
  mailer: SystemMailer;
  breached: BreachedPasswordChecker;
  logger: Logger;
  argon2?: Argon2Params;
  sleep?: (ms: number) => Promise<void>;
}

export interface Failure<E extends string> {
  ok: false;
  error: E;
  retryAfterMs?: number;
}
export type Result<T, E extends string> = ({ ok: true } & T) | Failure<E>;

export interface SignupInput {
  email: string;
  password: string;
  name?: string | undefined;
  termsVersion: string;
  aupVersion: string;
}

export type SignupError = 'invalid_email' | 'outdated_terms' | 'rate_limited' | `password_${PasswordProblem}`;

export class IdentityService {
  readonly #d: Required<IdentityDependencies>;
  /** Verified against when the account doesn't exist, so a failed login always costs one Argon2 verify. */
  #dummyHash: Promise<string> | undefined;

  constructor(deps: IdentityDependencies) {
    this.#d = {
      argon2: DEFAULT_ARGON2,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...deps,
    };
  }

  async signup(input: SignupInput, ctx: RequestContext): Promise<Result<object, SignupError>> {
    const { db, limiter, mailer } = this.#d;
    const limit = await limiter.hit(SIGNUP_LIMIT, ctx.ip ?? 'unknown');
    if (!limit.allowed) return { ok: false, error: 'rate_limited', retryAfterMs: limit.retryAfterMs };
    const email = normalizeEmail(input.email);
    if (email === undefined) return { ok: false, error: 'invalid_email' };
    if (input.termsVersion !== CURRENT_TERMS_VERSION || input.aupVersion !== CURRENT_AUP_VERSION) {
      return { ok: false, error: 'outdated_terms' };
    }
    const problem = await checkPasswordPolicy(input.password, this.#d.breached);
    if (problem !== undefined) return { ok: false, error: `password_${problem}` };

    // Always hash, so both branches below take about the same time.
    const passwordHash = await hashPassword(input.password, this.#d.argon2);
    const now = new Date();
    const name = input.name?.trim().slice(0, 200);
    const created = await db
      .insert(users)
      .values({
        email: input.email.trim(),
        emailNormalized: email,
        passwordHash,
        name: name === '' ? null : name,
        termsAcceptedAt: now,
        termsVersion: input.termsVersion,
        aupAcceptedAt: now,
        aupVersion: input.aupVersion,
      })
      .onConflictDoNothing({ target: users.emailNormalized })
      .returning({ id: users.id });

    const newUser = created[0];
    if (newUser === undefined) {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.emailNormalized, email));
      await mailer.accountExists(email);
      await recordAudit(db, { tenantId: null, actorType: 'user', actorId: existing?.id ?? null, action: 'auth.signup_existing_account' }, ctx);
      return { ok: true };
    }
    const token = await this.#issue(db, newUser.id, 'verify_email', VERIFY_TTL_MS);
    await mailer.verifyEmail(email, token, name);
    await recordAudit(db, { tenantId: null, actorType: 'user', actorId: newUser.id, action: 'auth.signup', metadata: { termsVersion: input.termsVersion, aupVersion: input.aupVersion } }, ctx);
    return { ok: true };
  }

  async verifyEmail(token: string, ctx: RequestContext): Promise<Result<object, 'invalid_token'>> {
    const userId = await this.#d.db.transaction(async (tx) => {
      const consumed = await this.#consume(tx, token, 'verify_email');
      if (consumed === undefined) return undefined;
      await tx.update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`, updatedAt: new Date() }).where(eq(users.id, consumed));
      return consumed;
    });
    if (userId === undefined) return { ok: false, error: 'invalid_token' };
    await recordAudit(this.#d.db, { tenantId: null, actorType: 'user', actorId: userId, action: 'auth.email_verified' }, ctx);
    return { ok: true };
  }

  async resendVerification(rawEmail: string, ctx: RequestContext): Promise<Result<object, 'rate_limited'>> {
    const email = normalizeEmail(rawEmail);
    const limit = await this.#d.limiter.hit(VERIFY_RESEND_LIMIT, email ?? rawEmail.trim().toLowerCase());
    if (!limit.allowed) return { ok: false, error: 'rate_limited', retryAfterMs: limit.retryAfterMs };
    if (email === undefined) return { ok: true };
    const [user] = await this.#d.db
      .select({ id: users.id, name: users.name, verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.emailNormalized, email));
    if (user?.verifiedAt === null) {
      const token = await this.#issue(this.#d.db, user.id, 'verify_email', VERIFY_TTL_MS);
      await this.#d.mailer.verifyEmail(email, token, user.name ?? undefined);
      await recordAudit(this.#d.db, { tenantId: null, actorType: 'user', actorId: user.id, action: 'auth.verification_resent' }, ctx);
    }
    return { ok: true };
  }

  async login(
    rawEmail: string,
    password: string,
    ctx: RequestContext,
    previousSessionId?: string,
  ): Promise<Result<{ sessionId: string; userId: string }, 'invalid_credentials' | 'rate_limited'>> {
    const { db, limiter, sessions } = this.#d;
    const email = normalizeEmail(rawEmail) ?? rawEmail.trim().toLowerCase();
    const limit = await limiter.hit(LOGIN_LIMIT, email, ctx.ip ?? 'unknown');
    if (!limit.allowed) {
      await recordAudit(db, { tenantId: null, actorType: 'user', actorId: null, action: 'auth.login_rate_limited' }, ctx);
      return { ok: false, error: 'rate_limited', retryAfterMs: limit.retryAfterMs };
    }
    const [user] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.emailNormalized, email));
    let valid = false;
    if (user === undefined) await verifyPassword(await this.#dummy(), password); // same cost as a real check
    else valid = await verifyPassword(user.passwordHash, password);
    if (user === undefined || !valid) {
      await this.#d.sleep(loginFailureDelayMs(limit.count));
      await recordAudit(db, {
        tenantId: null, actorType: 'user', actorId: user?.id ?? null, action: 'auth.login_failed',
        metadata: { reason: user === undefined ? 'unknown_account' : 'wrong_password' },
      }, ctx);
      return { ok: false, error: 'invalid_credentials' };
    }
    await limiter.reset(LOGIN_LIMIT, email, ctx.ip ?? 'unknown');
    const sessionId = await sessions.create({ userId: user.id }, previousSessionId);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await recordAudit(db, { tenantId: null, actorType: 'user', actorId: user.id, action: 'auth.login_succeeded' }, ctx);
    return { ok: true, sessionId, userId: user.id };
  }

  async logout(sessionId: string, userId: string, ctx: RequestContext): Promise<void> {
    await this.#d.sessions.destroy(sessionId);
    await recordAudit(this.#d.db, { tenantId: null, actorType: 'user', actorId: userId, action: 'auth.logout' }, ctx);
  }

  async requestPasswordReset(rawEmail: string, ctx: RequestContext): Promise<Result<object, 'rate_limited'>> {
    const email = normalizeEmail(rawEmail);
    const limit = await this.#d.limiter.hit(RESET_LIMIT, email ?? rawEmail.trim().toLowerCase());
    if (!limit.allowed) return { ok: false, error: 'rate_limited', retryAfterMs: limit.retryAfterMs };
    if (email === undefined) return { ok: true };
    const [user] = await this.#d.db.select({ id: users.id }).from(users).where(eq(users.emailNormalized, email));
    if (user !== undefined) {
      const token = await this.#issue(this.#d.db, user.id, 'reset_password', RESET_TTL_MS);
      await this.#d.mailer.passwordReset(email, token);
      await recordAudit(this.#d.db, { tenantId: null, actorType: 'user', actorId: user.id, action: 'auth.password_reset_requested' }, ctx);
    }
    return { ok: true };
  }

  async resetPassword(token: string, password: string, ctx: RequestContext): Promise<Result<object, 'invalid_token' | `password_${PasswordProblem}`>> {
    const problem = await checkPasswordPolicy(password, this.#d.breached);
    if (problem !== undefined) return { ok: false, error: `password_${problem}` };
    const passwordHash = await hashPassword(password, this.#d.argon2);
    const userId = await this.#d.db.transaction(async (tx) => {
      const consumed = await this.#consume(tx, token, 'reset_password');
      if (consumed === undefined) return undefined;
      // The reset link proved control of the inbox, so the address counts as verified.
      await tx.update(users)
        .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`, updatedAt: new Date() })
        .where(eq(users.id, consumed));
      return consumed;
    });
    if (userId === undefined) return { ok: false, error: 'invalid_token' };
    const revoked = await this.#d.sessions.destroyAllForUser(userId);
    await recordAudit(this.#d.db, { tenantId: null, actorType: 'user', actorId: userId, action: 'auth.password_reset', metadata: { sessionsRevoked: revoked } }, ctx);
    return { ok: true };
  }

  async getUser(userId: string): Promise<{ id: string; email: string; name: string | null; emailVerified: boolean } | undefined> {
    const [user] = await this.#d.db
      .select({ id: users.id, email: users.emailNormalized, name: users.name, verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId));
    return user === undefined ? undefined : { id: user.id, email: user.email, name: user.name, emailVerified: user.verifiedAt !== null };
  }

  /** Issues a token, invalidating any earlier unused token of the same purpose (only the latest link works). */
  async #issue(db: Database, userId: string, purpose: Purpose, ttlMs: number): Promise<string> {
    const { token, hash } = issueToken();
    await db.transaction(async (tx) => {
      await tx.update(userTokens).set({ usedAt: new Date() })
        .where(and(eq(userTokens.userId, userId), eq(userTokens.purpose, purpose), isNull(userTokens.usedAt)));
      await tx.insert(userTokens).values({ userId, purpose, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMs) });
    });
    return token;
  }

  /** Atomically marks a valid, unexpired, unused token as used. Single use even under concurrent requests. */
  async #consume(db: Pick<Database, 'update'>, token: string, purpose: Purpose): Promise<string | undefined> {
    if (!isWellFormedToken(token)) return undefined;
    const [row] = await db.update(userTokens).set({ usedAt: new Date() })
      .where(and(
        eq(userTokens.tokenHash, hashToken(token)),
        eq(userTokens.purpose, purpose),
        isNull(userTokens.usedAt),
        gt(userTokens.expiresAt, new Date()),
      ))
      .returning({ userId: userTokens.userId });
    return row?.userId;
  }

  #dummy(): Promise<string> {
    this.#dummyHash ??= hashPassword('dummy-password-for-timing', this.#d.argon2);
    return this.#dummyHash;
  }
}
