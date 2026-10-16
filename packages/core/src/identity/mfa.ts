// TOTP MFA (S2.1). Codes are accepted within ±1 time step, a step can be used once (checked and
// recorded atomically in the database), recovery codes are hashed and single use.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mfaFactors, users, type Database } from '@dm/db';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { generateSecret, generateURI, verify } from 'otplib';
import { renderSVG } from 'uqr';
import { recordAudit, type RequestContext } from '../audit.ts';
import { decrypt, encrypt, type KeyEncryptionKey } from '../crypto/envelope.ts';
import type { Result } from './service.ts';

export const MFA_ISSUER = 'Dhanuka Mails';
export const RECOVERY_CODE_COUNT = 10;
const STEP_SECONDS = 30;
/** ±1 step (AC 4). otplib takes the tolerance in seconds. */
const TOLERANCE_SECONDS = STEP_SECONDS;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_MAX_ATTEMPTS = 5;

/** Unambiguous alphabet (no 0/O, 1/I/L). 10 characters ≈ 50 bits per code. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < 10; i++) code += RECOVERY_ALPHABET.charAt(randomInt(RECOVERY_ALPHABET.length));
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Case- and dash-insensitive, so users can type codes loosely. */
const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashRecoveryCode = (code: string) => createHash('sha256').update(normalizeRecoveryCode(code)).digest();
const isTotpCode = (code: string) => /^\d{6}$/.test(code.trim());

/**
 * node-pg cannot serialise an array of Buffers (the raw bytes end up in the array literal), so the
 * hashes travel as one comma-separated hex string and are decoded in SQL.
 */
const byteaArray = (values: Buffer[]) =>
  sql`array(select decode(h, 'hex') from unnest(string_to_array(${values.map((v) => v.toString('hex')).join(',')}, ',')) as h)::bytea[]`;

export interface MfaDependencies {
  db: Database;
  cache: Redis;
  /** The first KEK encrypts new secrets; all of them can decrypt (rotation). */
  keks: readonly [KeyEncryptionKey, ...KeyEncryptionKey[]];
  /** Unix time in seconds; injectable for tests. */
  nowSeconds?: () => number;
}

export interface Enrolment {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
}

export class MfaService {
  readonly #db: Database;
  readonly #cache: Redis;
  readonly #keks: MfaDependencies['keks'];
  readonly #now: () => number;

  constructor(deps: MfaDependencies) {
    this.#db = deps.db;
    this.#cache = deps.cache;
    this.#keks = deps.keks;
    this.#now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  /** AC 1: starts (or restarts) enrolment and returns the QR code. Not active until confirmed. */
  async startEnrolment(userId: string, email: string): Promise<Result<Enrolment, 'already_enabled'>> {
    const [existing] = await this.#db.select({ confirmedAt: mfaFactors.confirmedAt }).from(mfaFactors).where(eq(mfaFactors.userId, userId));
    if (existing?.confirmedAt != null) return { ok: false, error: 'already_enabled' };
    const secret = generateSecret();
    const encrypted = await encrypt(this.#keks[0], Buffer.from(secret, 'utf8'), `mfa:${userId}`);
    await this.#db
      .insert(mfaFactors)
      .values({ userId, secretCiphertext: encrypted.ciphertext, keyId: encrypted.keyId })
      .onConflictDoUpdate({
        target: mfaFactors.userId,
        set: { secretCiphertext: encrypted.ciphertext, keyId: encrypted.keyId, lastUsedStep: null, recoveryCodesHashed: sql`'{}'::bytea[]` },
        where: isNull(mfaFactors.confirmedAt),
      });
    const otpauthUri = generateURI({ issuer: MFA_ISSUER, label: email, secret });
    return { ok: true, secret, otpauthUri, qrSvg: renderSVG(otpauthUri, { ecc: 'M' }) };
  }

  /** AC 1 and 3: the first valid code activates MFA and returns 10 recovery codes, shown once. */
  async confirmEnrolment(userId: string, code: string, ctx: RequestContext): Promise<Result<{ recoveryCodes: string[] }, 'no_pending_enrolment' | 'invalid_code'>> {
    const [factor] = await this.#db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNull(mfaFactors.confirmedAt)));
    if (factor === undefined) return { ok: false, error: 'no_pending_enrolment' };
    const step = await this.#checkTotp(factor, code);
    if (step === undefined) return { ok: false, error: 'invalid_code' };
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.#db.transaction(async (tx) => {
      await tx.update(mfaFactors)
        .set({ confirmedAt: new Date(), lastUsedStep: step, recoveryCodesHashed: byteaArray(recoveryCodes.map(hashRecoveryCode)) })
        .where(eq(mfaFactors.id, factor.id));
      await tx.update(users).set({ mfaEnabled: true, updatedAt: new Date() }).where(eq(users.id, userId));
      await recordAudit(tx, { tenantId: null, actorType: 'user', actorId: userId, action: 'auth.mfa_enabled' }, ctx);
    });
    return { ok: true, recoveryCodes };
  }

  /**
   * Checks a TOTP code or a recovery code for an enrolled user and consumes it: the TOTP step is
   * recorded (AC 4, no reuse), a recovery code is removed (AC 3, single use). Both atomically.
   */
  async verify(userId: string, code: string, ctx: RequestContext): Promise<boolean> {
    const [factor] = await this.#db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.confirmedAt)));
    if (factor === undefined) return false;
    if (isTotpCode(code)) {
      const step = await this.#checkTotp(factor, code);
      if (step === undefined) return false;
      // Only succeeds if no other request recorded this or a later step first.
      const updated = await this.#db.update(mfaFactors)
        .set({ lastUsedStep: step })
        .where(and(eq(mfaFactors.id, factor.id), or(isNull(mfaFactors.lastUsedStep), lt(mfaFactors.lastUsedStep, step))))
        .returning({ id: mfaFactors.id });
      return updated.length === 1;
    }
    const hash = hashRecoveryCode(code);
    const updated = await this.#db.update(mfaFactors)
      .set({ recoveryCodesHashed: sql`array_remove(${mfaFactors.recoveryCodesHashed}, ${hash}::bytea)` })
      .where(and(eq(mfaFactors.id, factor.id), sql`${hash}::bytea = any(${mfaFactors.recoveryCodesHashed})`))
      .returning({ remaining: sql<number>`cardinality(${mfaFactors.recoveryCodesHashed})` });
    const row = updated[0];
    if (row === undefined) return false;
    await recordAudit(this.#db, { tenantId: null, actorType: 'user', actorId: userId, action: 'auth.mfa_recovery_code_used', metadata: { remaining: row.remaining } }, ctx);
    return true;
  }

  /** Turning MFA off needs a current code (or recovery code). */
  async disable(userId: string, code: string, ctx: RequestContext): Promise<Result<object, 'invalid_code'>> {
    if (!(await this.verify(userId, code, ctx))) return { ok: false, error: 'invalid_code' };
    await this.#db.transaction(async (tx) => {
      await tx.delete(mfaFactors).where(eq(mfaFactors.userId, userId));
      await tx.update(users).set({ mfaEnabled: false, updatedAt: new Date() }).where(eq(users.id, userId));
      await recordAudit(tx, { tenantId: null, actorType: 'user', actorId: userId, action: 'auth.mfa_disabled' }, ctx);
    });
    return { ok: true };
  }

  async remainingRecoveryCodes(userId: string): Promise<number | undefined> {
    const [row] = await this.#db
      .select({ n: sql<number>`cardinality(${mfaFactors.recoveryCodesHashed})` })
      .from(mfaFactors)
      .where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.confirmedAt)));
    return row?.n;
  }

  // --- Login challenge (AC 6): password accepted, second factor pending. Stored in valkey-cache. ---

  async createChallenge(userId: string, previousSessionId?: string): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.#cache.set(challengeKey(id), JSON.stringify({ userId, previousSessionId, attempts: 0 }), 'PX', CHALLENGE_TTL_MS);
    return id;
  }

  /** Returns the user once the challenge is answered; the challenge is gone after success or 5 failures. */
  async answerChallenge(challengeId: string, code: string, ctx: RequestContext): Promise<Result<{ userId: string; previousSessionId?: string }, 'invalid_challenge' | 'invalid_code'>> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(challengeId)) return { ok: false, error: 'invalid_challenge' };
    const key = challengeKey(challengeId);
    const raw = await this.#cache.get(key);
    if (raw === null) return { ok: false, error: 'invalid_challenge' };
    const challenge = JSON.parse(raw) as { userId: string; previousSessionId?: string; attempts: number };
    if (await this.verify(challenge.userId, code, ctx)) {
      await this.#cache.del(key);
      return { ok: true, userId: challenge.userId, ...(challenge.previousSessionId === undefined ? {} : { previousSessionId: challenge.previousSessionId }) };
    }
    const attempts = challenge.attempts + 1;
    if (attempts >= CHALLENGE_MAX_ATTEMPTS) await this.#cache.del(key);
    else await this.#cache.set(key, JSON.stringify({ ...challenge, attempts }), 'KEEPTTL');
    await recordAudit(this.#db, { tenantId: null, actorType: 'user', actorId: challenge.userId, action: 'auth.mfa_failed', metadata: { attempts } }, ctx);
    return { ok: false, error: 'invalid_code' };
  }

  /** The matching time step for a code (±1 step, after the last used step), or undefined. */
  async #checkTotp(factor: typeof mfaFactors.$inferSelect, code: string): Promise<number | undefined> {
    if (!isTotpCode(code)) return undefined;
    const secret = (await decrypt(this.#keks, { ciphertext: factor.secretCiphertext, keyId: factor.keyId }, `mfa:${factor.userId}`)).toString('utf8');
    const now = this.#now();
    const result = await verify({
      secret,
      token: code.trim(),
      epoch: now,
      epochTolerance: TOLERANCE_SECONDS,
      ...(factor.lastUsedStep === null ? {} : { afterTimeStep: factor.lastUsedStep }),
    });
    // The matched step is the current step plus the reported drift (delta is -1, 0 or +1).
    return result.valid ? Math.floor(now / STEP_SECONDS) + result.delta : undefined;
  }
}

const challengeKey = (id: string) => `mfa-chal:${createHash('sha256').update(id).digest('hex')}`;
