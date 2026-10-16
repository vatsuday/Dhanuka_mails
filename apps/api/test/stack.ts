// Test stack: migrated Postgres, valkey-cache and Mailpit containers, and the API built in-process.
import { randomBytes } from 'node:crypto';
import { localBreachedList, localKek, TEST_ARGON2 } from '@dm/core';
import { createDatabase } from '@dm/db';
import { startTestDatabase, type TestDatabase } from '@dm/db/testing';
import { buildHttpService, createLogger, type AppWithLogger } from '@dm/shared';
import { Redis } from 'ioredis';
import { GenericContainer, Wait } from 'testcontainers';
import { registerApi } from '../src/app.ts';

export const APP_URL = 'http://app.test';

type Logger = ReturnType<typeof createLogger>;

export interface StackOptions {
  /** Pins the TOTP clock (Unix seconds). */
  nowSeconds?: () => number;
}

export interface Stack {
  app: AppWithLogger<Logger>;
  pg: TestDatabase;
  cache: Redis;
  mailpitUrl: string;
  stop: () => Promise<void>;
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const [pg, valkey, mailpit] = await Promise.all([
    startTestDatabase(),
    new GenericContainer('valkey/valkey:8.1.10')
      .withCommand(['valkey-server', '--maxmemory-policy', 'allkeys-lru', '--save', '', '--appendonly', 'no'])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer('axllent/mailpit:v1.31.5').withExposedPorts(8025).withWaitStrategy(Wait.forHttp('/readyz', 8025)).start(),
  ]);
  const cache = new Redis(`redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`);
  const mailpitUrl = `http://${mailpit.getHost()}:${String(mailpit.getMappedPort(8025))}`;
  const app = await buildHttpService({
    service: 'api-test',
    env: 'test',
    host: '127.0.0.1',
    port: 0,
    logger: createLogger({ service: 'api-test', env: 'test', level: (process.env.TEST_LOG ?? 'silent') as 'silent' }),
    checks: [],
    handleSignals: false,
    register: (a) => {
      registerApi(a, {
        db: createDatabase(pg.pool('app_user')),
        cache,
        sendingMode: 'sink',
        mailpitUrl,
        mailFrom: { email: 'no-reply@dhanuka.test', name: 'Dhanuka Mails' },
        appUrl: APP_URL,
        breached: localBreachedList(),
        argon2: TEST_ARGON2,
        sleep: () => Promise.resolve(),
        mfaKeks: [localKek('test-1', randomBytes(32))],
        ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
      });
    },
  });
  await app.ready();
  return {
    app, pg, cache, mailpitUrl,
    stop: async () => {
      await app.close();
      cache.disconnect();
      await Promise.all([pg.stop(), valkey.stop(), mailpit.stop()]);
    },
  };
}

/** A tiny browser: keeps the session cookie and sends our Origin on state-changing requests. */
export class Client {
  cookie: string | undefined;
  readonly #app: AppWithLogger<Logger>;
  readonly #ip: string;

  constructor(app: AppWithLogger<Logger>, ip = '198.51.100.10') {
    this.#app = app;
    this.#ip = ip;
  }

  async request(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await this.#app.inject({
      method,
      url,
      remoteAddress: this.#ip,
      headers: {
        ...(method === 'POST' ? { origin: APP_URL } : {}),
        ...(this.cookie === undefined ? {} : { cookie: this.cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const set = response.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw !== undefined) {
      const pair = raw.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') ? undefined : pair;
    }
    return response;
  }

  get(url: string, headers?: Record<string, string>) {
    return this.request('GET', url, undefined, headers);
  }

  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', url, body ?? {}, headers);
  }
}

interface MailpitSummary { ID: string; Subject: string; To: { Address: string }[] }

/** Waits for the newest email to `to` whose subject contains `subject`, and returns its text. */
export async function waitForEmail(mailpitUrl: string, to: string, subject: string, timeoutMs = 5000): Promise<{ id: string; subject: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = (await (await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()) as { messages: MailpitSummary[] };
    const match = search.messages.find((m) => m.Subject.includes(subject));
    if (match !== undefined) {
      const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${match.ID}`)).json()) as { Text: string };
      return { id: match.ID, subject: match.Subject, text: message.Text };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no email to ${to} with subject containing "${subject}"`);
}

export async function emailsTo(mailpitUrl: string, to: string): Promise<string[]> {
  const search = (await (await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()) as { messages: MailpitSummary[] };
  return search.messages.map((m) => m.Subject);
}

export function tokenFrom(text: string): string {
  const match = /#token=([A-Za-z0-9_-]{43})/.exec(text);
  if (match?.[1] === undefined) throw new Error('no token link in email');
  return match[1];
}

export const TERMS = { termsVersion: '2026-10-15', aupVersion: '2026-10-15' };
export const GOOD_PASSWORD = 'violet-tractor-91';
