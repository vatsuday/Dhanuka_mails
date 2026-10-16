// Tenant-facing REST API (dashboard and public API).
import { createHash } from 'node:crypto';
import { anyBreached, localBreachedList, localKek, pwnedPasswordsChecker } from '@dm/core';
import { createDatabase } from '@dm/db';
import {
  connectDependencies,
  createLogger,
  databaseConfigShape,
  httpConfigShape,
  loadConfigOrExit,
  startHttpService,
  valkeyConfigShape,
} from '@dm/shared';
import { z } from 'zod';
import { registerApi } from './app.ts';

const SERVICE = 'api';

const csv = z.string().default('').transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s !== ''));

const config = loadConfigOrExit({
  ...databaseConfigShape,
  VALKEY_QUEUE_URL: valkeyConfigShape.VALKEY_QUEUE_URL,
  VALKEY_CACHE_URL: valkeyConfigShape.VALKEY_CACHE_URL,
  ...httpConfigShape,
  PORT: httpConfigShape.PORT.default(3001),
  /** The web app's public origin: email links point here and only it may make state-changing requests. */
  APP_URL: z.url({ error: 'must be a URL' }).default('http://127.0.0.1:3000'),
  /** Mailpit's HTTP API, used by the sink provider (SENDING_MODE=sink). */
  MAILPIT_URL: z.url({ error: 'must be a URL' }).default('http://127.0.0.1:8025'),
  SYSTEM_MAIL_FROM: z.email({ error: 'must be an email address' }).default('no-reply@dhanuka.local'),
  /** Platform-verified team addresses that sandbox mode may deliver to (comma-separated). */
  SANDBOX_ALLOWLIST: csv,
  /** `local` (bundled list) or `local+hibp` (also the k-anonymity range API). */
  PASSWORD_BREACH_CHECK: z.enum(['local', 'local+hibp']).default('local'),
  /** Proxy addresses to trust for the client IP (the local Next.js rewrite runs on loopback). */
  TRUST_PROXY: z.string().default('127.0.0.1'),
  /**
   * Local key-encryption key for MFA secrets: 32 random bytes, base64. Development and CI only;
   * production uses AWS KMS (S15.4) and refuses to start with a local key.
   */
  MFA_LOCAL_KEK: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, { error: 'must be 32 bytes, base64-encoded' })
    .optional(),
  MFA_LOCAL_KEK_ID: z.string().regex(/^[a-z0-9-]{1,40}$/).default('local-dev-1'),
});

if (config.APP_ENV === 'production' || config.APP_ENV === 'staging') {
  // KMS-backed keys arrive with the AWS infrastructure (S2.6 / S15.4).
  throw new Error('MFA needs a KMS key-encryption key outside development; the KMS adapter is not implemented yet');
}
// Without MFA_LOCAL_KEK, development and test use a fixed key derived from a public string: fine for
// throwaway local data, and it keeps any key material out of the repository.
const mfaKek =
  config.MFA_LOCAL_KEK === undefined
    ? localKek('public-dev', createHash('sha256').update('dhanuka-mails public development MFA key, not secret').digest())
    : localKek(config.MFA_LOCAL_KEK_ID, Buffer.from(config.MFA_LOCAL_KEK, 'base64'));

const logger = createLogger({ service: SERVICE, env: config.APP_ENV, level: config.LOG_LEVEL });
const dependencies = connectDependencies(
  { databaseUrl: config.DATABASE_URL, valkeyQueueUrl: config.VALKEY_QUEUE_URL, valkeyCacheUrl: config.VALKEY_CACHE_URL },
  logger,
);
const { postgres, valkeyCache } = dependencies;
if (postgres === undefined || valkeyCache === undefined) throw new Error('api requires DATABASE_URL and VALKEY_CACHE_URL');

await startHttpService({
  service: SERVICE,
  env: config.APP_ENV,
  host: config.HOST,
  port: config.PORT,
  logger,
  checks: dependencies.checks,
  trustProxy: config.TRUST_PROXY,
  onClose: dependencies.close,
  register: (app) => {
    registerApi(app, {
      db: createDatabase(postgres),
      cache: valkeyCache,
      sendingMode: config.SENDING_MODE,
      mailpitUrl: config.MAILPIT_URL,
      sandboxAllowlist: config.SANDBOX_ALLOWLIST,
      mailFrom: { email: config.SYSTEM_MAIL_FROM, name: 'Dhanuka Mails' },
      appUrl: config.APP_URL,
      mfaKeks: [mfaKek],
      breached:
        config.PASSWORD_BREACH_CHECK === 'local+hibp' ? anyBreached(localBreachedList(), pwnedPasswordsChecker()) : localBreachedList(),
    });
  },
});
