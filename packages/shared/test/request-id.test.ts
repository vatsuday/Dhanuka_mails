import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.ts';
import { REQUEST_ID_HEADER, observabilityServerOptions, registerRequestIdHeader, resolveRequestId } from '../src/request-id.ts';
import { memoryStream } from './helpers.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('reuses a well-formed incoming ID', () => {
    expect(resolveRequestId('abc12345-upstream.id_1')).toBe('abc12345-upstream.id_1');
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['log injection attempt', 'abcdefgh\n{"level":"fatal"}'],
    ['unsafe characters', 'abcdefgh<script>'],
  ])('replaces an unacceptable ID (%s) with a new UUID', (_label, incoming) => {
    expect(resolveRequestId(incoming)).toMatch(UUID);
  });

  it('generates a UUID when the header is missing or repeated', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
    expect(resolveRequestId(['abcdefgh1', 'abcdefgh2'])).toMatch(UUID);
  });
});

describe('request IDs in Fastify logs', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
  });

  function buildApp() {
    const out = memoryStream();
    const logger = createLogger({ service: 'api', env: 'test', level: 'info', destination: out.stream });
    const app = Fastify(observabilityServerOptions(logger));
    registerRequestIdHeader(app);
    app.get('/hello', (request) => {
      request.log.info('handler ran');
      return Promise.resolve({ ok: true });
    });
    close = () => app.close();
    return { app, out };
  }

  it('logs every line of a request with request_id and echoes it in the response header', async () => {
    const { app, out } = buildApp();
    const response = await app.inject({ url: '/hello', headers: { [REQUEST_ID_HEADER]: 'trace-0001-abc' } });
    expect(response.headers[REQUEST_ID_HEADER]).toBe('trace-0001-abc');
    const requestLines = out.lines().filter((line) => 'request_id' in line);
    expect(requestLines.map((line) => line.msg)).toEqual(
      expect.arrayContaining(['incoming request', 'handler ran', 'request completed']),
    );
    expect(new Set(requestLines.map((line) => line.request_id))).toEqual(new Set(['trace-0001-abc']));
  });

  it('generates an ID when none is supplied and uses it consistently', async () => {
    const { app, out } = buildApp();
    const response = await app.inject({ url: '/hello' });
    const id = response.headers[REQUEST_ID_HEADER];
    expect(id).toMatch(UUID);
    const ids = new Set(out.lines().filter((line) => 'request_id' in line).map((line) => line.request_id));
    expect(ids).toEqual(new Set([id]));
  });
});
