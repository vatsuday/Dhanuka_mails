import { describe, expect, it } from 'vitest';
import type { ReadinessCheck } from '../src/health.ts';
import { createLogger } from '../src/logger.ts';
import { REQUEST_ID_HEADER } from '../src/request-id.ts';
import { buildHttpService, startHttpService, type HttpServiceOptions } from '../src/service.ts';
import { memoryStream } from './helpers.ts';

function options(overrides: Partial<HttpServiceOptions> = {}): HttpServiceOptions & { out: ReturnType<typeof memoryStream> } {
  const out = memoryStream();
  return {
    service: 'api',
    env: 'test',
    host: '127.0.0.1',
    port: 0,
    logger: createLogger({ service: 'api', env: 'test', level: 'info', destination: out.stream }),
    checks: [],
    handleSignals: false,
    out,
    ...overrides,
  };
}

const down: ReadinessCheck = { name: 'postgres', check: () => Promise.reject(new Error('ECONNREFUSED')) };

describe('buildHttpService', () => {
  it('serves /health, /ready and request IDs', async () => {
    const app = await buildHttpService(options({ checks: [down] }));
    try {
      const health = await app.inject('/health');
      expect(health.statusCode).toBe(200);
      expect(health.headers[REQUEST_ID_HEADER]).toBeTypeOf('string');
      const ready = await app.inject('/ready');
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({ status: 'not_ready', checks: [{ name: 'postgres', status: 'fail' }] });
    } finally {
      await app.close();
    }
  });

  it("registers the app's own routes", async () => {
    const app = await buildHttpService(
      options({ register: (a) => { a.get('/ping', () => Promise.resolve({ pong: true })); } }),
    );
    try {
      expect((await app.inject('/ping')).json()).toEqual({ pong: true });
    } finally {
      await app.close();
    }
  });

  it('runs onClose when the app closes', async () => {
    let closed = 0;
    const app = await buildHttpService(options({ onClose: () => { closed += 1; return Promise.resolve(); } }));
    await app.close();
    expect(closed).toBe(1);
  });
});

describe('startHttpService', () => {
  it('listens on a real port, answers over HTTP, and stops gracefully (idempotent)', async () => {
    let closed = 0;
    const opts = options({ onClose: () => { closed += 1; return Promise.resolve(); } });
    const { app, stop } = await startHttpService(opts);
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('not listening');
    const response = await fetch(`http://127.0.0.1:${String(address.port)}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    await Promise.all([stop(), stop()]);
    expect(closed).toBe(1);
    expect(opts.out.lines().map((line) => line.msg)).toEqual(expect.arrayContaining(['service started', 'service stopped']));
  });
});
