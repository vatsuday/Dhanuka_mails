import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  baseConfigShape,
  databaseConfigShape,
  httpConfigShape,
  loadConfig,
  valkeyConfigShape,
} from '../src/config.ts';

const services = { ...databaseConfigShape, ...valkeyConfigShape };
const validServiceEnv = {
  DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/dhanuka',
  VALKEY_QUEUE_URL: 'redis://127.0.0.1:6379',
  VALKEY_CACHE_URL: 'redis://127.0.0.1:6380',
};

function configError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to throw ConfigError');
}

describe('loadConfig: defaults and parsing', () => {
  it('applies safe defaults when nothing is set', () => {
    const config = loadConfig({}, {});
    expect(config.APP_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.SENDING_MODE).toBe('sink');
  });

  it('treats empty strings as unset, so SENDING_MODE= still defaults to sink', () => {
    expect(loadConfig({}, { SENDING_MODE: '' }).SENDING_MODE).toBe('sink');
  });

  it('ignores unrelated environment variables', () => {
    expect(() => loadConfig({}, { PATH: '/usr/bin', SOMETHING_ELSE: 'x' })).not.toThrow();
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig({}, {}))).toBe(true);
  });

  it('coerces and range-checks PORT', () => {
    expect(loadConfig(httpConfigShape, { PORT: '8080' }).PORT).toBe(8080);
    expect(configError(() => loadConfig(httpConfigShape, { PORT: '0' })).issues).toEqual([
      'PORT: must be between 1 and 65535',
    ]);
    expect(configError(() => loadConfig(httpConfigShape, { PORT: 'abc' })).issues[0]).toMatch(/^PORT: /);
  });
});

describe('loadConfig: fail fast with clear messages', () => {
  it('reports every problem at once, by variable name', () => {
    const error = configError(() =>
      loadConfig({ ...services, ...httpConfigShape }, { APP_ENV: 'prod', LOG_LEVEL: 'loud', PORT: 'x' }),
    );
    const names = error.issues.map((issue) => issue.split(':')[0]);
    expect(names).toEqual(
      expect.arrayContaining(['APP_ENV', 'LOG_LEVEL', 'PORT', 'DATABASE_URL', 'VALKEY_QUEUE_URL', 'VALKEY_CACHE_URL']),
    );
    expect(error.message).toMatch(/^Invalid configuration \(\d+ problems\):/);
  });

  it('rejects unknown enum values with the allowed list', () => {
    const error = configError(() => loadConfig({}, { SENDING_MODE: 'smtp' }));
    expect(error.issues).toEqual(['SENDING_MODE: must be one of: sink, sandbox, live']);
  });

  it('rejects a non-Postgres database URL', () => {
    const error = configError(() => loadConfig(services, { ...validServiceEnv, DATABASE_URL: 'mysql://h/db' }));
    expect(error.issues[0]).toMatch(/^DATABASE_URL: must be a postgres:\/\//);
  });

  it('never includes a rejected value in the error, because values can be secrets', () => {
    const secret = 'S3cretPassw0rd-do-not-log';
    const error = configError(() =>
      loadConfig(services, {
        ...validServiceEnv,
        DATABASE_URL: `mysql://admin:${secret}@db.internal/app`,
        VALKEY_CACHE_URL: `http://:${secret}@cache`,
        LOG_LEVEL: secret,
      }),
    );
    expect(error.issues).toHaveLength(3);
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error.issues)).not.toContain(secret);
  });
});

describe('loadConfig: SENDING_MODE rules (ADR-011)', () => {
  const approved = { SENDING_LIVE_APPROVED_AT: '2027-03-01T10:00:00Z', SENDING_LIVE_APPROVED_BY: 'release-pipeline' };

  it.each(['development', 'test', 'staging'])('rejects live sending when APP_ENV=%s, even with approvals', (env) => {
    const error = configError(() => loadConfig({}, { APP_ENV: env, SENDING_MODE: 'live', ...approved }));
    expect(error.issues).toEqual(['SENDING_MODE: live sending is only allowed when APP_ENV=production (ADR-011)']);
  });

  it('rejects live sending in production without the readiness-gate approval', () => {
    const error = configError(() => loadConfig({}, { APP_ENV: 'production', SENDING_MODE: 'live' }));
    expect(error.issues[0]).toMatch(/requires SENDING_LIVE_APPROVED_AT and SENDING_LIVE_APPROVED_BY/);
  });

  it('rejects live sending in production with only one of the two approvals', () => {
    expect(() =>
      loadConfig({}, { APP_ENV: 'production', SENDING_MODE: 'live', SENDING_LIVE_APPROVED_BY: 'release-pipeline' }),
    ).toThrow(ConfigError);
  });

  it('rejects an approval timestamp that is not ISO 8601', () => {
    const error = configError(() =>
      loadConfig({}, { APP_ENV: 'production', SENDING_MODE: 'live', ...approved, SENDING_LIVE_APPROVED_AT: 'yesterday' }),
    );
    expect(error.issues).toContain('SENDING_LIVE_APPROVED_AT: must be an ISO 8601 date-time');
  });

  it('allows live sending only in production with both approvals', () => {
    const config = loadConfig({}, { APP_ENV: 'production', SENDING_MODE: 'live', ...approved });
    expect(config.SENDING_MODE).toBe('live');
  });

  it('allows sink and sandbox in every environment', () => {
    for (const env of ['development', 'test', 'staging', 'production']) {
      for (const mode of ['sink', 'sandbox']) {
        expect(loadConfig({}, { APP_ENV: env, SENDING_MODE: mode }).SENDING_MODE).toBe(mode);
      }
    }
  });
});

describe('loadConfig: Valkey separation (ADR-004)', () => {
  it('rejects the same URL for queue and cache', () => {
    const error = configError(() =>
      loadConfig(services, { ...validServiceEnv, VALKEY_CACHE_URL: validServiceEnv.VALKEY_QUEUE_URL }),
    );
    expect(error.issues).toEqual([
      'VALKEY_CACHE_URL: must point to a different Valkey instance than VALKEY_QUEUE_URL (ADR-004)',
    ]);
  });

  it('accepts two distinct instances', () => {
    expect(loadConfig(services, validServiceEnv).VALKEY_CACHE_URL).toBe('redis://127.0.0.1:6380');
  });
});

describe('.env.example', () => {
  const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) values[match[1]] = match[2];
  }

  it('is a valid configuration for a service that uses the database and Valkey', () => {
    const config = loadConfig({ ...services, ...httpConfigShape }, { ...values, PORT: '3000' });
    expect(config.SENDING_MODE).toBe('sink');
  });

  it('documents every variable the shared schemas define', () => {
    const keys = Object.keys({ ...baseConfigShape, ...databaseConfigShape, ...valkeyConfigShape, ...httpConfigShape });
    const missing = keys.filter((key) => !new RegExp(`\\b${key}\\b`).test(text));
    expect(missing).toEqual([]);
  });
});
