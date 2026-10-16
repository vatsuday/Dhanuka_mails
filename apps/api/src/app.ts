// Composes the API: services, guards and routes. main.ts wires real dependencies; tests wire containers.
import { guardedProvider, SinkProvider, type ChannelProvider, type SendingMode } from '@dm/channels';
import {
  IdentityService,
  InvitationService,
  MfaService,
  OrganisationService,
  RateLimiter,
  SessionStore,
  SystemMailer,
  type Argon2Params,
  type BreachedPasswordChecker,
  type KeyEncryptionKey,
} from '@dm/core';
import type { Database } from '@dm/db';
import type { AppWithLogger } from '@dm/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { enforceRouteDeclarations, registerAccessControl, registerOriginCheck } from './http/guards.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerInvitationRoutes } from './routes/invitations.ts';
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
  /** Key-encryption keys for MFA secrets; the first encrypts (S2.1). */
  mfaKeks: readonly [KeyEncryptionKey, ...KeyEncryptionKey[]];
  /** Tests pin the TOTP clock (Unix seconds). */
  nowSeconds?: () => number;
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
  const mfa = new MfaService({
    db: options.db,
    cache: options.cache,
    keks: options.mfaKeks,
    ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
  });
  const identity = new IdentityService({
    db: options.db,
    sessions,
    limiter,
    mailer,
    mfa,
    breached: options.breached,
    logger: app.log,
    ...(options.argon2 === undefined ? {} : { argon2: options.argon2 }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  const organisations = new OrganisationService(options.db);

  enforceRouteDeclarations(app);
  registerOriginCheck(app, [new URL(options.appUrl).origin]);
  registerAccessControl(app, sessions, organisations);
  registerAuthRoutes(app, identity, mfa);
  registerOrgRoutes(app, { db: options.db, identity, organisations, sessions });
  registerInvitationRoutes(app, { invitations: new InvitationService({ db: options.db, mailer, limiter }), sessions });
}
