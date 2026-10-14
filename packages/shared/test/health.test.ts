import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { createServer } from 'node:net';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { postgresCheck, registerHealthRoutes, runReadiness, valkeyCheck, type ReadinessCheck } from '../src/health.ts';
import { createLogger } from '../src/logger.ts';
import { memoryStream } from './helpers.ts';

const ok = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve() });
const failing = (name: string, message: string): ReadinessCheck => ({
  name,
  check: () => Promise.reject(new Error(message)),
});

/** A TCP port with nothing listening on it, so connections are refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  return address.port;
}

describe('runReadiness', () => {
  it('is ready when every check passes', async () => {
    const report = await runReadiness([ok('postgres'), ok('valkey-queue')]);
    expect(report.status).toBe('ready');
    expect(report.checks.map((c) => c.status)).toEqual(['ok', 'ok']);
  });

  it('is not ready when any check fails, and keeps the error for logging', async () => {
    const report = await runReadiness([ok('postgres'), failing('valkey-cache', 'ECONNREFUSED')]);
    expect(report.status).toBe('not_ready');
    expect(report.checks).toEqual([
      expect.objectContaining({ name: 'postgres', status: 'ok' }),
      expect.objectContaining({ name: 'valkey-cache', status: 'fail' }),
    ]);
    expect(report.errors.map((e) => e.name)).toEqual(['valkey-cache']);
  });

  it('fails a hanging check after the timeout and aborts its signal', async () => {
    let aborted = false;
    const hanging: ReadinessCheck = {
      name: 'slow',
      check: (signal) =>
        new Promise(() => {
          signal.addEventListener('abort', () => { aborted = true; });
        }),
    };
    const started = Date.now();
    const report = await runReadiness([hanging], 100);
    expect(report.status).toBe('not_ready');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(aborted).toBe(true);
  });
});

describe('health routes', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
  });

  function buildApp(checks: ReadinessCheck[]) {
    const out = memoryStream();
    const app = Fastify({ loggerInstance: createLogger({ service: 'api', env: 'test', level: 'info', destination: out.stream }) });
    registerHealthRoutes(app, { checks, timeoutMs: 200 });
    close = () => app.close();
    return { app, out };
  }

  it('GET /health returns 200 even when dependencies are down (liveness)', async () => {
    const { app } = buildApp([failing('postgres', 'down')]);
    const response = await app.inject('/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready returns 200 when all checks pass', async () => {
    const { app } = buildApp([ok('postgres'), ok('valkey-queue'), ok('valkey-cache')]);
    const response = await app.inject('/ready');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
  });

  it('GET /ready returns 503 without leaking error details, and logs them server-side', async () => {
    const detail = 'password authentication failed for user "dm_secret_user"';
    const { app, out } = buildApp([ok('valkey-queue'), failing('postgres', detail)]);
    const response = await app.inject('/ready');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'not_ready' });
    expect(response.body).not.toContain('dm_secret_user');
    const warning = out.lines().find((line) => line.msg === 'readiness check failed');
    expect(warning).toMatchObject({ level: 'warn', check: 'postgres' });
  });
});

describe('dependency probes', () => {
  it('postgresCheck runs "select 1"', async () => {
    const queries: string[] = [];
    await postgresCheck({ query: (sql) => { queries.push(sql); return Promise.resolve(); } }).check(new AbortController().signal);
    expect(queries).toEqual(['select 1']);
  });

  it('valkeyCheck fails on an unexpected PING reply', async () => {
    await expect(valkeyCheck({ ping: () => Promise.resolve('NOPE') }, 'valkey-queue').check(new AbortController().signal)).rejects.toThrow();
  });

  it('a real pg Pool pointed at a closed port makes /ready fail promptly', async () => {
    const port = await closedPort();
    const pool = new pg.Pool({ connectionString: `postgres://u:p@127.0.0.1:${String(port)}/db`, connectionTimeoutMillis: 500 });
    try {
      const report = await runReadiness([postgresCheck(pool)], 2000);
      expect(report.status).toBe('not_ready');
    } finally {
      await pool.end();
    }
  });

  it('a real ioredis client pointed at a closed port makes /ready fail promptly', async () => {
    const port = await closedPort();
    const client = new Redis({ host: '127.0.0.1', port, retryStrategy: () => null, maxRetriesPerRequest: 0 });
    client.on('error', () => undefined);
    try {
      const report = await runReadiness([valkeyCheck(client, 'valkey-queue')], 2000);
      expect(report.status).toBe('not_ready');
    } finally {
      client.disconnect();
    }
  });
});
