import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { connectDependencies } from '../src/dependencies.ts';
import { runReadiness } from '../src/health.ts';
import { createLogger } from '../src/logger.ts';
import { memoryStream } from './helpers.ts';

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  return address.port;
}

function logger() {
  const out = memoryStream();
  return { out, logger: createLogger({ service: 'test', env: 'test', level: 'info', destination: out.stream }) };
}

describe('connectDependencies', () => {
  it('creates nothing and no checks when no URLs are given', async () => {
    const deps = connectDependencies({}, logger().logger);
    expect(deps.checks).toEqual([]);
    expect(deps.postgres).toBeUndefined();
    await deps.close();
  });

  it('creates only the requested clients, with checks named after them', async () => {
    const port = await closedPort();
    const deps = connectDependencies(
      { databaseUrl: `postgres://u:p@127.0.0.1:${String(port)}/db`, valkeyCacheUrl: `redis://127.0.0.1:${String(port)}` },
      logger().logger,
    );
    try {
      expect(deps.checks.map((c) => c.name)).toEqual(['postgres', 'valkey-cache']);
      expect(deps.valkeyQueue).toBeUndefined();
    } finally {
      await deps.close();
    }
  });

  it('reports not ready while dependencies are unreachable, without crashing', async () => {
    const port = await closedPort();
    const deps = connectDependencies(
      {
        databaseUrl: `postgres://u:p@127.0.0.1:${String(port)}/db`,
        valkeyQueueUrl: `redis://127.0.0.1:${String(port)}`,
        valkeyCacheUrl: `redis://127.0.0.1:${String(port)}/1`,
      },
      logger().logger,
    );
    try {
      const report = await runReadiness(deps.checks, 2500);
      expect(report.status).toBe('not_ready');
      expect(report.checks.map((c) => `${c.name}:${c.status}`)).toEqual([
        'postgres:fail',
        'valkey-queue:fail',
        'valkey-cache:fail',
      ]);
    } finally {
      await deps.close();
    }
  });

  it('logs connection URLs without passwords, and repeated identical errors only once', async () => {
    const port = await closedPort();
    const { out, logger: log } = logger();
    const deps = connectDependencies(
      { databaseUrl: `postgres://u:pw-secret-1@127.0.0.1:${String(port)}/db`, valkeyQueueUrl: `redis://:pw-secret-2@127.0.0.1:${String(port)}` },
      log,
    );
    await new Promise((resolve) => setTimeout(resolve, 1500)); // let ioredis retry a few times
    await deps.close();
    expect(out.raw()).not.toContain('pw-secret-1');
    expect(out.raw()).not.toContain('pw-secret-2');
    const errors = out.lines().filter((line) => line.msg === 'valkey connection error');
    const distinct = new Set(errors.map((line) => JSON.stringify((line.err as { message?: string } | undefined)?.message)));
    expect(errors.length).toBe(distinct.size);
  });

  it('close() is safe to call twice', async () => {
    const deps = connectDependencies({ valkeyQueueUrl: `redis://127.0.0.1:${String(await closedPort())}` }, logger().logger);
    await deps.close();
    await expect(deps.close()).resolves.toBeUndefined();
  });
});
