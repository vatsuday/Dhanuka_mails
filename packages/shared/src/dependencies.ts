import { Redis } from 'ioredis';
import pg from 'pg';
import type { Logger } from 'pino';
import { postgresCheck, valkeyCheck, type ReadinessCheck } from './health.ts';
import { redactUrl } from './logger.ts';

export interface DependencyUrls {
  databaseUrl?: string;
  valkeyQueueUrl?: string;
  valkeyCacheUrl?: string;
}

export interface Dependencies {
  postgres?: pg.Pool;
  valkeyQueue?: Redis;
  valkeyCache?: Redis;
  /** Readiness checks for exactly the dependencies this process connected to. */
  checks: ReadinessCheck[];
  /** Closes every connection; safe to call more than once. */
  close: () => Promise<void>;
}

/**
 * Creates the Postgres pool and Valkey clients a process asks for, plus their readiness checks.
 * Connections are established lazily or in the background, so a missing dependency makes /ready fail
 * instead of crashing the process. Errors are logged once per distinct message, so a dependency
 * that is down doesn't flood the logs.
 */
export function connectDependencies(urls: DependencyUrls, logger: Logger): Dependencies {
  const checks: ReadinessCheck[] = [];
  const closers: (() => Promise<void>)[] = [];
  const result: Omit<Dependencies, 'checks' | 'close'> = {};

  if (urls.databaseUrl !== undefined) {
    const pool = new pg.Pool({ connectionString: urls.databaseUrl, max: 10, connectionTimeoutMillis: 2000 });
    pool.on('error', (err) => {
      logger.warn({ dependency: 'postgres', err }, 'idle postgres client error');
    });
    logger.info({ dependency: 'postgres', url: redactUrl(urls.databaseUrl) }, 'postgres pool created');
    result.postgres = pool;
    checks.push(postgresCheck(pool));
    closers.push(() => pool.end());
  }

  for (const [key, name, url] of [
    ['valkeyQueue', 'valkey-queue', urls.valkeyQueueUrl],
    ['valkeyCache', 'valkey-cache', urls.valkeyCacheUrl],
  ] as const) {
    if (url === undefined) continue;
    const client = new Redis(url, { connectTimeout: 2000, maxRetriesPerRequest: 1 });
    let lastError = '';
    client.on('error', (err: Error) => {
      if (err.message !== lastError) logger.warn({ dependency: name, err }, 'valkey connection error');
      lastError = err.message;
    });
    client.on('ready', () => {
      lastError = '';
      logger.info({ dependency: name }, 'valkey connected');
    });
    logger.info({ dependency: name, url: redactUrl(url) }, 'valkey client created');
    result[key] = client;
    checks.push(valkeyCheck(client, name));
    closers.push(async () => {
      client.disconnect();
      await Promise.resolve();
    });
  }

  let closed = false;
  return {
    ...result,
    checks,
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled(closers.map((close) => close()));
    },
  };
}
