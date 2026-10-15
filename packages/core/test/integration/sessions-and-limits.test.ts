// Sessions (S1.2) and rate limits (S1.4 AC 3) against a real valkey-cache.
import { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOGIN_LIMIT, RateLimiter, RESET_LIMIT } from '../../src/identity/rate-limit.ts';
import { SessionStore } from '../../src/identity/sessions.ts';

let valkey: StartedTestContainer;
let redis: Redis;

beforeAll(async () => {
  valkey = await new GenericContainer('valkey/valkey:8.1.10')
    .withCommand(['valkey-server', '--maxmemory', '256mb', '--maxmemory-policy', 'allkeys-lru', '--save', '', '--appendonly', 'no'])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  redis = new Redis(`redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`);
});
afterAll(async () => {
  redis.disconnect();
  await valkey.stop();
});

describe('SessionStore', () => {
  it('creates, reads and destroys a session; stores only a hash of the ID', async () => {
    const store = new SessionStore(redis);
    const id = await store.create({ userId: 'u1' });
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.get(id)).toMatchObject({ userId: 'u1' });
    expect(await redis.keys(`*${id}*`)).toEqual([]);
    await store.destroy(id);
    expect(await store.get(id)).toBeUndefined();
  });

  it('rotates on login: the previous ID stops working', async () => {
    const store = new SessionStore(redis);
    const first = await store.create({ userId: 'u2' });
    const second = await store.create({ userId: 'u2' }, first);
    expect(second).not.toBe(first);
    expect(await store.get(first)).toBeUndefined();
    expect(await store.get(second)).toBeDefined();
  });

  it('rotates on privilege change, carrying the new tenant', async () => {
    const store = new SessionStore(redis);
    const id = await store.create({ userId: 'u3' });
    const rotated = await store.rotate(id, { tenantId: 't1' });
    expect(rotated).toBeDefined();
    expect(await store.get(id)).toBeUndefined();
    expect(await store.get(rotated ?? '')).toMatchObject({ userId: 'u3', tenantId: 't1' });
  });

  it('expires after the idle timeout, and the idle timer slides on use', async () => {
    let now = 1_000_000;
    const store = new SessionStore(redis, { idleTimeoutMs: 1000, absoluteTimeoutMs: 10_000, now: () => now });
    const id = await store.create({ userId: 'u4' });
    now += 900;
    expect(await store.get(id)).toBeDefined(); // slides
    now += 900;
    expect(await store.get(id)).toBeDefined(); // 1800 ms after creation, but only 900 idle
    now += 1000;
    expect(await store.get(id)).toBeUndefined();
  });

  it('expires at the absolute timeout even when active', async () => {
    let now = 1_000_000;
    const store = new SessionStore(redis, { idleTimeoutMs: 1000, absoluteTimeoutMs: 2500, now: () => now });
    const id = await store.create({ userId: 'u5' });
    for (let i = 0; i < 4; i++) {
      now += 600;
      expect(await store.get(id)).toBeDefined();
    }
    now += 600; // 3000 ms after creation
    expect(await store.get(id)).toBeUndefined();
  });

  it('sets the Valkey TTL so abandoned sessions disappear on their own', async () => {
    const store = new SessionStore(redis, { idleTimeoutMs: 5000 });
    await store.create({ userId: 'u6' });
    const [key] = await redis.keys('sess:*').then(async (keys) => {
      const ttls = await Promise.all(keys.map(async (k) => [k, await redis.pttl(k)] as const));
      return ttls.filter(([, ttl]) => ttl > 0 && ttl <= 5000).map(([k]) => k);
    });
    expect(key).toBeDefined();
  });

  it('destroyAllForUser logs the user out everywhere, and only that user', async () => {
    const store = new SessionStore(redis);
    const a1 = await store.create({ userId: 'ua' });
    const a2 = await store.create({ userId: 'ua' });
    const b = await store.create({ userId: 'ub' });
    expect(await store.destroyAllForUser('ua')).toBe(2);
    expect(await store.get(a1)).toBeUndefined();
    expect(await store.get(a2)).toBeUndefined();
    expect(await store.get(b)).toBeDefined();
  });

  it('rejects malformed IDs without touching Valkey', async () => {
    expect(await new SessionStore(redis).get('../../etc/passwd')).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  it('allows 5 logins per minute per account+IP, then reports Retry-After', async () => {
    const limiter = new RateLimiter(redis);
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await limiter.hit(LOGIN_LIMIT, 'asha@example.in', '203.0.113.1'));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);
    expect(results[5]?.retryAfterMs).toBeGreaterThan(0);
    expect(results[5]?.retryAfterMs).toBeLessThanOrEqual(60_000);
    // A different IP or account has its own window.
    expect((await limiter.hit(LOGIN_LIMIT, 'asha@example.in', '203.0.113.2')).allowed).toBe(true);
    expect((await limiter.hit(LOGIN_LIMIT, 'ravi@example.in', '203.0.113.1')).allowed).toBe(true);
  });

  it('allows 3 resets per hour per email', async () => {
    const limiter = new RateLimiter(redis);
    const allowed = [];
    for (let i = 0; i < 4; i++) allowed.push((await limiter.hit(RESET_LIMIT, 'reset@example.in')).allowed);
    expect(allowed).toEqual([true, true, true, false]);
  });

  it('stores hashed keys only, with the window as TTL', async () => {
    const limiter = new RateLimiter(redis);
    await limiter.hit(RESET_LIMIT, 'private@example.in');
    const keys = await redis.keys('rl:reset:*');
    expect(keys.some((k) => k.includes('private'))).toBe(false);
    const ttls = await Promise.all(keys.map((k) => redis.pttl(k)));
    expect(ttls.every((t) => t > 0 && t <= RESET_LIMIT.windowMs)).toBe(true);
  });

  it('reset clears the window', async () => {
    const limiter = new RateLimiter(redis);
    for (let i = 0; i < 5; i++) await limiter.hit(LOGIN_LIMIT, 'x@example.in', 'ip');
    await limiter.reset(LOGIN_LIMIT, 'x@example.in', 'ip');
    expect((await limiter.hit(LOGIN_LIMIT, 'x@example.in', 'ip')).count).toBe(1);
  });
});
