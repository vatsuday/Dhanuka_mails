// Password hashing and policy (S1.1 AC 1; docs/02 §5).
import { readFileSync } from 'node:fs';
import { hash, verify } from '@node-rs/argon2';

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * 64 MiB, 3 passes: about 70 ms on a 2026 developer laptop. docs/02 §5 targets about 250 ms on
 * production hardware; re-measure on staging (S2.6) and raise timeCost there. Stored hashes carry
 * their parameters, so raising them later needs no migration.
 */
export const DEFAULT_ARGON2: Argon2Params = { memoryCost: 65536, timeCost: 3, parallelism: 1 };
/** For tests only: fast, still Argon2id. */
export const TEST_ARGON2: Argon2Params = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 10;
/** Bounds the hashing work an attacker can request. */
export const MAX_PASSWORD_LENGTH = 256;

export function hashPassword(password: string, params: Argon2Params = DEFAULT_ARGON2): Promise<string> {
  // @node-rs/argon2 defaults to Argon2id (its Algorithm enum is a const enum, unusable with isolated
  // modules); a unit test asserts the stored hash starts with $argon2id$.
  return hash(password, params);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Checks a candidate password against known-breached passwords. */
export interface BreachedPasswordChecker {
  isBreached: (password: string) => Promise<boolean>;
}

/**
 * A bundled list of very common passwords of at least 10 characters (data/common-passwords.txt).
 * Offline, so it works in CI and local development. Production can add the k-anonymity checker.
 */
export function localBreachedList(file = new URL('../../data/common-passwords.txt', import.meta.url)): BreachedPasswordChecker {
  const list = new Set(
    readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l !== '' && !l.startsWith('#')),
  );
  return { isBreached: (password) => Promise.resolve(list.has(password.toLowerCase())) };
}

/**
 * Have I Been Pwned range API (k-anonymity): only the first 5 hex characters of the SHA-1 leave the
 * process. Fails open (returns false) if the service is unreachable, so sign-up never depends on it.
 */
export function pwnedPasswordsChecker(fetchImpl: typeof fetch = fetch): BreachedPasswordChecker {
  return {
    isBreached: async (password) => {
      const { createHash } = await import('node:crypto');
      const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);
      try {
        const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
          headers: { 'Add-Padding': 'true' },
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return false;
        const body = await response.text();
        return body.split(/\r?\n/).some((line) => {
          const [hashSuffix, count] = line.trim().split(':');
          return hashSuffix === suffix && Number(count) > 0;
        });
      } catch {
        return false;
      }
    },
  };
}

export function anyBreached(...checkers: BreachedPasswordChecker[]): BreachedPasswordChecker {
  return {
    isBreached: async (password) => {
      for (const checker of checkers) if (await checker.isBreached(password)) return true;
      return false;
    },
  };
}

export type PasswordProblem = 'too_short' | 'too_long' | 'breached';

export async function checkPasswordPolicy(password: string, breached: BreachedPasswordChecker): Promise<PasswordProblem | undefined> {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (password.length > MAX_PASSWORD_LENGTH) return 'too_long';
  if (await breached.isBreached(password)) return 'breached';
  return undefined;
}
