// /ready probes against real Postgres and Valkey containers (S0.4 AC 5, moved from S0.6).
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDependencies, type Dependencies } from '../../src/dependencies.ts';
import { runReadiness } from '../../src/health.ts';
import { createLogger } from '../../src/logger.ts';

// Same images as infra/docker/docker-compose.yml.
const startPostgres = () =>
  new GenericContainer('postgres:18.6-bookworm')
    .withEnvironment({ POSTGRES_USER: 'probe', POSTGRES_PASSWORD: 'probe', POSTGRES_DB: 'probe' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
const startValkey = () =>
  new GenericContainer('valkey/valkey:8.1.10')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

let postgres: StartedTestContainer;
let valkeyQueue: StartedTestContainer;
let valkeyCache: StartedTestContainer;
let dependencies: Dependencies;

const statuses = async () =>
  Object.fromEntries((await runReadiness(dependencies.checks)).checks.map((c) => [c.name, c.status]));

beforeAll(async () => {
  [postgres, valkeyQueue, valkeyCache] = await Promise.all([startPostgres(), startValkey(), startValkey()]);
  const url = (c: StartedTestContainer, port: number) => `${c.getHost()}:${String(c.getMappedPort(port))}`;
  dependencies = connectDependencies(
    {
      databaseUrl: `postgres://probe:probe@${url(postgres, 5432)}/probe`,
      valkeyQueueUrl: `redis://${url(valkeyQueue, 6379)}`,
      valkeyCacheUrl: `redis://${url(valkeyCache, 6379)}`,
    },
    createLogger({ service: 'readiness-test', env: 'test', level: 'silent' }),
  );
});

afterAll(async () => {
  await dependencies.close();
  // Already stopped by the tests unless one failed early; stopping twice is harmless to skip.
  await Promise.allSettled([postgres.stop(), valkeyQueue.stop(), valkeyCache.stop()]);
});

describe('readiness against real dependencies', () => {
  it('is ready while Postgres and both Valkey instances are running', async () => {
    const report = await runReadiness(dependencies.checks);
    expect(report.status).toBe('ready');
    expect(await statuses()).toEqual({ postgres: 'ok', 'valkey-queue': 'ok', 'valkey-cache': 'ok' });
  });

  it('fails only the valkey-cache check when valkey-cache stops', async () => {
    await valkeyCache.stop();
    expect(await statuses()).toEqual({ postgres: 'ok', 'valkey-queue': 'ok', 'valkey-cache': 'fail' });
  });

  it('fails the valkey-queue check when valkey-queue stops', async () => {
    await valkeyQueue.stop();
    expect(await statuses()).toEqual({ postgres: 'ok', 'valkey-queue': 'fail', 'valkey-cache': 'fail' });
  });

  it('fails the postgres check when Postgres stops, and the report is not ready', async () => {
    await postgres.stop();
    const report = await runReadiness(dependencies.checks);
    expect(report.status).toBe('not_ready');
    expect(await statuses()).toEqual({ postgres: 'fail', 'valkey-queue': 'fail', 'valkey-cache': 'fail' });
  });
});
