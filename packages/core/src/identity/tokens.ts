// One-time tokens (docs/02 §5): 32 random bytes, sent base64url-encoded, stored only as SHA-256.
import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Goes into the email link. Never stored. */
  token: string;
  /** What the database keeps. */
  hash: Buffer;
}

export function issueToken(): IssuedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** A well-formed token is exactly 43 base64url characters (32 bytes); anything else is rejected unhashed. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
