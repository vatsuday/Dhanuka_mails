import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { PUBLIC_ROUTE } from './route-config.ts';

/** Any Fastify app on the default HTTP server, whatever logger it was created with (for example pino). */
export type AppWithLogger<Logger extends FastifyBaseLogger> = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger
>;

/** A dependency that must be reachable for the process to accept traffic. */
export interface ReadinessCheck {
  name: string;
  check: (signal: AbortSignal) => Promise<void>;
}

export interface CheckResult {
  name: string;
  status: 'ok' | 'fail';
  durationMs: number;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: CheckResult[];
}

const DEFAULT_TIMEOUT_MS = 2000;

async function runOne(
  check: ReadinessCheck,
  timeoutMs: number,
): Promise<{ result: CheckResult; error?: unknown }> {
  const started = performance.now();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([check.check(controller.signal), timeout]);
    return { result: { name: check.name, status: 'ok', durationMs: Math.round(performance.now() - started) } };
  } catch (error) {
    return { result: { name: check.name, status: 'fail', durationMs: Math.round(performance.now() - started) }, error };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs all checks in parallel, each with its own timeout. */
export async function runReadiness(
  checks: readonly ReadinessCheck[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ReadinessReport & { errors: { name: string; error: unknown }[] }> {
  const outcomes = await Promise.all(checks.map((check) => runOne(check, timeoutMs)));
  const errors = outcomes.flatMap((o) => (o.error === undefined ? [] : [{ name: o.result.name, error: o.error }]));
  return {
    status: errors.length === 0 ? 'ready' : 'not_ready',
    checks: outcomes.map((o) => o.result),
    errors,
  };
}

export interface HealthRoutesOptions {
  checks: readonly ReadinessCheck[];
  timeoutMs?: number;
}

/**
 * GET /health: liveness. 200 while the process can serve requests; never touches dependencies.
 * GET /ready: readiness. 200 only if every check passes, otherwise 503. The response lists only
 * check names and statuses; error details go to the server log, never to the client.
 */
export function registerHealthRoutes<Logger extends FastifyBaseLogger>(
  app: AppWithLogger<Logger>,
  options: HealthRoutesOptions,
): void {
  app.get('/health', { config: PUBLIC_ROUTE }, () => Promise.resolve({ status: 'ok' }));

  app.get('/ready', { config: PUBLIC_ROUTE }, async (request, reply) => {
    const { errors, ...report } = await runReadiness(options.checks, options.timeoutMs);
    for (const { name, error } of errors) {
      request.log.warn({ check: name, err: error }, 'readiness check failed');
    }
    return reply.code(report.status === 'ready' ? 200 : 503).send(report);
  });
}

/** Readiness probe for Postgres: any client or pool with `query()` (for example a pg Pool). */
export function postgresCheck(client: { query: (sql: string) => Promise<unknown> }, name = 'postgres'): ReadinessCheck {
  return { name, check: async () => { await client.query('select 1'); } };
}

/** Readiness probe for Valkey: any client with `ping()` (for example ioredis). */
export function valkeyCheck(client: { ping: () => Promise<string> }, name: string): ReadinessCheck {
  return {
    name,
    check: async () => {
      const reply = await client.ping();
      if (reply !== 'PONG') throw new Error('unexpected PING reply');
    },
  };
}
