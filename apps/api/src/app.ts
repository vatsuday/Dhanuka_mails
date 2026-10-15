// Composes the API: services, guards and routes. main.ts wires real dependencies; tests wire containers.
import { guardedProvider, SinkProvider, type ChannelProvider, type SendingMode } from '@dm/channels';
import {
  IdentityService,
  OrganisationService,
  RateLimiter,
  SessionStore,
  SystemMailer,
  type Argon2Params,
  type BreachedPasswordChecker,
} from '@dm/core';
import type { Database } from '@dm/db';
import type { AppWithLogger } from '@dm/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { enforceRouteDeclarations, registerAccessControl, registerOriginCheck } from './http/guards.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerOrgRoutes } from './routes/orgs.ts';

export interface ApiOptions {
  db: Database;
  /** valkey-cache: sessions and rate limits. */
  cache: Redis;
  sendingMode: SendingMode;
  /** Required in sink mode. */
  mailpitUrl?: string | undefined;
  sandboxAllowlist?: readonly string[];
  mailFrom: { email: string; name: string };
  /** The web origin: links in emails and the only origin allowed to change state. */
  appUrl: string;
  breached: BreachedPasswordChecker;
  argon2?: Argon2Params;
  /** Tests inject a provider; otherwise it is chosen from the sending mode. */
  provider?: ChannelProvider;
  sleep?: (ms: number) => Promise<void>;
}

function providerFor(options: ApiOptions): ChannelProvider {
  if (options.provider !== undefined) return options.provider;
  if (options.sendingMode === 'sink') {
    if (options.mailpitUrl === undefined) throw new Error('MAILPIT_URL is required when SENDING_MODE=sink');
    return new SinkProvider(options.mailpitUrl);
  }
  // The SES provider arrives with S8.1; until then nothing but the sink can deliver.
  throw new Error(`SENDING_MODE=${options.sendingMode} needs the SES provider, which is not implemented yet (S8.1)`);
}

/** Registers everything onto an app built by @dm/shared's buildHttpService (which adds /health and /ready). */
export function registerApi<L extends FastifyBaseLogger>(app: AppWithLogger<L>, options: ApiOptions): void {
  const sessions = new SessionStore(options.cache);
  const limiter = new RateLimiter(options.cache);
  const mailer = new SystemMailer({
    provider: guardedProvider(providerFor(options), () => options.sendingMode, { sandboxAllowlist: options.sandboxAllowlist ?? [] }),
    from: options.mailFrom,
    appUrl: options.appUrl,
  });
  const identity = new IdentityService({
    db: options.db,
    sessions,
    limiter,
    mailer,
    breached: options.breached,
    logger: app.log,
    ...(options.argon2 === undefined ? {} : { argon2: options.argon2 }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  const organisations = new OrganisationService(options.db);

  enforceRouteDeclarations(app);
  registerOriginCheck(app, [new URL(options.appUrl).origin]);
  registerAccessControl(app, sessions, organisations);
  registerAuthRoutes(app, identity);
  registerOrgRoutes(app, { db: options.db, identity, organisations, sessions });
}
