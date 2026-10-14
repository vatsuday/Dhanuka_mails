import { z } from 'zod';

export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const SENDING_MODES = ['sink', 'sandbox', 'live'] as const;

export type AppEnv = (typeof APP_ENVS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type SendingMode = (typeof SENDING_MODES)[number];

/**
 * Thrown when the environment is invalid. The message lists every problem by variable name and
 * reason, and never includes the offending value, because values can be secrets.
 */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    const count = `${String(issues.length)} problem${issues.length === 1 ? '' : 's'}`;
    super(`Invalid configuration (${count}):\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const postgresUrl = z
  .string({ error: 'is required' })
  .refine((value) => /^postgres(ql)?:\/\/[^/\s]+\/\S+$/.test(value), {
    error: 'must be a postgres:// or postgresql:// URL that includes a database name',
  });

const redisUrl = z
  .string({ error: 'is required' })
  .refine((value) => /^rediss?:\/\/\S+$/.test(value), { error: 'must be a redis:// or rediss:// URL' });

/** Settings every process needs. */
export const baseConfigShape = {
  APP_ENV: z.enum(APP_ENVS, { error: `must be one of: ${APP_ENVS.join(', ')}` }).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: `must be one of: ${LOG_LEVELS.join(', ')}` }).default('info'),
  SENDING_MODE: z
    .enum(SENDING_MODES, { error: `must be one of: ${SENDING_MODES.join(', ')}` })
    .default('sink'),
  SENDING_LIVE_APPROVED_AT: z.iso.datetime({ error: 'must be an ISO 8601 date-time' }).optional(),
  SENDING_LIVE_APPROVED_BY: z.string().trim().min(1, { error: 'must not be blank' }).optional(),
};

/** Postgres connection for processes that use the database. */
export const databaseConfigShape = {
  DATABASE_URL: postgresUrl,
};

/** The two Valkey instances (ADR-004): queue and cache must be separate. */
export const valkeyConfigShape = {
  VALKEY_QUEUE_URL: redisUrl,
  VALKEY_CACHE_URL: redisUrl,
};

/** HTTP listener for processes that serve requests. */
export const httpConfigShape = {
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(1, { error: 'must be between 1 and 65535' })
    .max(65535, { error: 'must be between 1 and 65535' }),
};

type Env = Readonly<Record<string, string | undefined>>;

/** Rules that span several variables (ADR-004, ADR-011). */
function crossFieldRules(data: Record<string, unknown>, ctx: z.RefinementCtx): void {
  if (data.SENDING_MODE === 'live') {
    if (data.APP_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['SENDING_MODE'],
        message: 'live sending is only allowed when APP_ENV=production (ADR-011)',
      });
    } else if (data.SENDING_LIVE_APPROVED_AT === undefined || data.SENDING_LIVE_APPROVED_BY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['SENDING_MODE'],
        message:
          'live sending requires SENDING_LIVE_APPROVED_AT and SENDING_LIVE_APPROVED_BY, set by the release pipeline after the readiness gate (ADR-011)',
      });
    }
  }
  const queue = data.VALKEY_QUEUE_URL;
  if (typeof queue === 'string' && queue === data.VALKEY_CACHE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['VALKEY_CACHE_URL'],
      message: 'must point to a different Valkey instance than VALKEY_QUEUE_URL (ADR-004)',
    });
  }
}

/** Treat empty strings as unset: `FOO=` in a .env file means "not provided". */
function withoutEmptyValues(env: Env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') result[key] = value;
  }
  return result;
}

/**
 * Validates the environment against the base settings plus the given extra shapes (pass `{}` for
 * none), and returns a frozen, typed config. Throws ConfigError listing every problem at once (fail fast at start-up).
 */
export function loadConfig<const Extra extends z.ZodRawShape>(
  extra: Extra,
  env: Env = process.env,
): Readonly<z.infer<z.ZodObject<typeof baseConfigShape & Extra>>> {
  const schema = z.object({ ...baseConfigShape, ...extra }).superRefine(crossFieldRules);
  const result = schema.safeParse(withoutEmptyValues(env));
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.map(String).join('.') || '(environment)'}: ${issue.message}`),
    );
  }
  return Object.freeze(result.data);
}

/**
 * For process entry points: loads the config, or prints the ConfigError message (no stack trace,
 * no values) and exits with code 1. `exit` and `print` are injectable for tests.
 */
export function loadConfigOrExit<const Extra extends z.ZodRawShape>(
  extra: Extra,
  env: Env = process.env,
  exit: (code: number) => never = (code) => process.exit(code),
  print: (message: string) => void = (message) => {
    console.error(message);
  },
): ReturnType<typeof loadConfig<Extra>> {
  try {
    return loadConfig(extra, env);
  } catch (error) {
    if (error instanceof ConfigError) {
      print(error.message);
      return exit(1);
    }
    throw error;
  }
}
