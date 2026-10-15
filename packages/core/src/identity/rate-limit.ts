// Fixed-window rate limits in valkey-cache (S1.4). Keys are hashed so they never contain raw
// email addresses or IPs.
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts in the current window, including this one. */
  count: number;
  /** Milliseconds until the window resets (for Retry-After when not allowed). */
  retryAfterMs: number;
}

/** S1.4 AC 1: login, per account + IP. */
export const LOGIN_LIMIT: RateLimitRule = { name: 'login', limit: 5, windowMs: 60_000 };
/** S1.4 AC 2: password reset and verification resend, per email. */
export const RESET_LIMIT: RateLimitRule = { name: 'reset', limit: 3, windowMs: 60 * 60_000 };
export const VERIFY_RESEND_LIMIT: RateLimitRule = { name: 'verify-resend', limit: 3, windowMs: 60 * 60_000 };
/** Sign-up per IP, against mass account creation. */
export const SIGNUP_LIMIT: RateLimitRule = { name: 'signup', limit: 10, windowMs: 60 * 60_000 };

// INCR, set the window on the first hit, return count and remaining TTL atomically.
const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}`;

export class RateLimiter {
  readonly #redis: Redis;

  constructor(redis: Redis) {
    this.#redis = redis;
  }

  async hit(rule: RateLimitRule, ...subject: string[]): Promise<RateLimitResult> {
    const digest = createHash('sha256').update(subject.join('\u0000')).digest('hex');
    const [count, ttl] = (await this.#redis.eval(SCRIPT, 1, `rl:${rule.name}:${digest}`, String(rule.windowMs))) as [number, number];
    return { allowed: count <= rule.limit, count, retryAfterMs: Math.max(ttl, 0) };
  }

  async reset(rule: RateLimitRule, ...subject: string[]): Promise<void> {
    const digest = createHash('sha256').update(subject.join('\u0000')).digest('hex');
    await this.#redis.del(`rl:${rule.name}:${digest}`);
  }
}

/** Progressive delay for failed logins inside the window: 0, 0, 250, 500, 1000 ms. */
export function loginFailureDelayMs(attempt: number): number {
  return attempt <= 2 ? 0 : Math.min(250 * 2 ** (attempt - 3), 2000);
}
