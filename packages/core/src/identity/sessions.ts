// Server-side sessions in valkey-cache (docs/02 §5, S1.2). The cookie holds a random ID; Valkey keys
// use its SHA-256, so a leaked cache dump does not contain usable session IDs.
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

export const SESSION_COOKIE = '__Host-dm_session';
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;

export interface Session {
  userId: string;
  /** The organisation the user is working in; set after membership is checked. */
  tenantId?: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface SessionStoreOptions {
  idleTimeoutMs?: number;
  absoluteTimeoutMs?: number;
  now?: () => number;
}

const key = (id: string) => `sess:${createHash('sha256').update(id).digest('hex')}`;
const userKey = (userId: string) => `user-sess:${userId}`;

export class SessionStore {
  readonly #redis: Redis;
  readonly #idle: number;
  readonly #absolute: number;
  readonly #now: () => number;

  constructor(redis: Redis, options: SessionStoreOptions = {}) {
    this.#redis = redis;
    this.#idle = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.#absolute = options.absoluteTimeoutMs ?? ABSOLUTE_TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Creates a session with a fresh ID. Pass the previous ID to rotate (it is destroyed). */
  async create(session: Omit<Session, 'createdAt' | 'lastSeenAt'>, previousId?: string): Promise<string> {
    if (previousId !== undefined) await this.destroy(previousId);
    const id = randomBytes(32).toString('base64url');
    const now = this.#now();
    await this.#write(id, { ...session, createdAt: now, lastSeenAt: now });
    await this.#redis.sadd(userKey(session.userId), key(id));
    await this.#redis.pexpire(userKey(session.userId), this.#absolute);
    return id;
  }

  /** Returns the session and slides its idle timeout, or undefined if missing or expired. */
  async get(id: string): Promise<Session | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return undefined;
    const raw = await this.#redis.get(key(id));
    if (raw === null) return undefined;
    const session = JSON.parse(raw) as Session;
    const now = this.#now();
    if (now - session.createdAt >= this.#absolute || now - session.lastSeenAt >= this.#idle) {
      await this.destroy(id);
      return undefined;
    }
    const touched = { ...session, lastSeenAt: now };
    await this.#write(id, touched);
    return touched;
  }

  /** Replaces the session with a new ID carrying `changes` (privilege change, e.g. switching organisation). */
  async rotate(id: string, changes: Partial<Pick<Session, 'tenantId'>>): Promise<string | undefined> {
    const session = await this.get(id);
    if (session === undefined) return undefined;
    await this.destroy(id);
    const newId = randomBytes(32).toString('base64url');
    await this.#write(newId, { ...session, ...changes });
    await this.#redis.sadd(userKey(session.userId), key(newId));
    return newId;
  }

  async destroy(id: string): Promise<void> {
    const raw = await this.#redis.getdel(key(id));
    if (raw !== null) await this.#redis.srem(userKey((JSON.parse(raw) as Session).userId), key(id));
  }

  /** Logs the user out everywhere (password reset, S1.3 AC 3). */
  async destroyAllForUser(userId: string): Promise<number> {
    const keys = await this.#redis.smembers(userKey(userId));
    if (keys.length > 0) await this.#redis.del(...keys);
    await this.#redis.del(userKey(userId));
    return keys.length;
  }

  async #write(id: string, session: Session): Promise<void> {
    const ttl = Math.min(this.#idle, this.#absolute - (session.lastSeenAt - session.createdAt));
    await this.#redis.set(key(id), JSON.stringify(session), 'PX', Math.max(1, ttl));
  }
}
