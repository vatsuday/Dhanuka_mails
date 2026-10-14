import { describe, expect, it } from 'vitest';
import { createLogger, redactUrl } from '../src/logger.ts';
import { memoryStream } from './helpers.ts';

describe('createLogger', () => {
  it('writes one JSON object per line with level label, service, env and ISO time', () => {
    const out = memoryStream();
    createLogger({ service: 'api', env: 'test', level: 'info', destination: out.stream }).info({ n: 1 }, 'hello');
    const [line] = out.lines();
    expect(line).toMatchObject({ level: 'info', service: 'api', env: 'test', n: 1, msg: 'hello' });
    expect(typeof line?.time).toBe('string');
    expect(Number.isNaN(Date.parse(String(line?.time)))).toBe(false);
  });

  it('respects the configured level', () => {
    const out = memoryStream();
    const logger = createLogger({ service: 'api', env: 'test', level: 'warn', destination: out.stream });
    logger.info('dropped');
    logger.warn('kept');
    expect(out.lines().map((line) => line.msg)).toEqual(['kept']);
  });

  it('redacts secrets at the top level, one and two levels deep, and in HTTP headers', () => {
    const out = memoryStream();
    const logger = createLogger({ service: 'api', env: 'test', level: 'info', destination: out.stream });
    const secrets = ['pw-top', 'tok-1', 'sec-2', 'Bearer abc.def', 'sid=xyz', 'pg-pass', 'key-9', 'set-cookie-val'];
    logger.info(
      {
        password: 'pw-top',
        user: { token: 'tok-1', profile: { secret: 'sec-2' } },
        req: { headers: { authorization: 'Bearer abc.def', cookie: 'sid=xyz', 'x-api-key': 'key-9' } },
        res: { headers: { 'set-cookie': 'set-cookie-val' } },
        config: { DATABASE_URL: 'postgres://u:pg-pass@h/db' },
        safe: 'visible',
      },
      'secrets',
    );
    const raw = out.raw();
    for (const secret of secrets) expect(raw).not.toContain(secret);
    expect(raw).toContain('[REDACTED]');
    expect(out.lines()[0]?.safe).toBe('visible');
  });
});

describe('redactUrl', () => {
  it('masks the password and keeps the rest', () => {
    expect(redactUrl('postgres://app:hunter2@db.internal:5432/dhanuka')).toBe('postgres://app:***@db.internal:5432/dhanuka');
  });

  it('leaves URLs without a password unchanged', () => {
    expect(redactUrl('redis://127.0.0.1:6379')).toBe('redis://127.0.0.1:6379');
  });

  it('returns a placeholder, not the input, for unparseable values', () => {
    expect(redactUrl('not a url with secret')).toBe('[REDACTED]');
  });
});
