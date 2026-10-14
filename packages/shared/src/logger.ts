import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppEnv, LogLevel } from './config.ts';

const CENSOR = '[REDACTED]';

// Keys that must never reach logs. pino redact paths match exact key paths; `*` matches one level.
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'DATABASE_URL',
  'VALKEY_QUEUE_URL',
  'VALKEY_CACHE_URL',
] as const;

/** Redaction paths: sensitive keys at the top level and up to two levels deep, plus HTTP headers. */
export const REDACT_PATHS: readonly string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  ...SENSITIVE_KEYS.map((key) => `*.*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

export interface LoggerOptions {
  service: string;
  env: AppEnv;
  level: LogLevel;
  /** Output stream; defaults to stdout. Tests pass an in-memory stream. */
  destination?: DestinationStream;
}

/** Structured JSON logger with secrets redacted and service/env on every line. */
export function createLogger({ service, env, level, destination }: LoggerOptions): Logger {
  return pino(
    {
      level,
      base: { service, env },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: [...REDACT_PATHS], censor: CENSOR },
    },
    destination,
  );
}

/** Hides the password in a connection URL, for safe logging of config: postgres://u:***@host/db. */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password !== '') url.password = '***';
    return url.toString();
  } catch {
    return CENSOR;
  }
}
