import Fastify from 'fastify';
import type { Logger } from 'pino';
import type { AppEnv } from './config.ts';
import { registerHealthRoutes, type AppWithLogger, type ReadinessCheck } from './health.ts';
import { observabilityServerOptions, registerRequestIdHeader } from './request-id.ts';

export interface HttpServiceOptions {
  service: string;
  env: AppEnv;
  host: string;
  port: number;
  logger: Logger;
  checks: readonly ReadinessCheck[];
  /** Called when the server closes (for example to close database and Valkey connections). */
  onClose?: () => Promise<void>;
  /** Registers the app's own routes and plugins. */
  register?: (app: AppWithLogger<Logger>) => void | Promise<void>;
  /** Install SIGTERM/SIGINT handlers that stop gracefully and exit (default true; tests pass false). */
  handleSignals?: boolean;
}

/**
 * Builds a Fastify app with structured logging, request IDs, /health and /ready, without listening.
 * Tests use this with `inject`.
 */
export async function buildHttpService(options: HttpServiceOptions): Promise<AppWithLogger<Logger>> {
  const app: AppWithLogger<Logger> = Fastify({
    ...observabilityServerOptions(options.logger),
    // Behind the ALB in AWS; trust only the first proxy hop for client IPs (configured per environment later).
    trustProxy: false,
  });
  registerRequestIdHeader(app);
  registerHealthRoutes(app, { checks: options.checks });
  if (options.onClose !== undefined) {
    const onClose = options.onClose;
    app.addHook('onClose', async () => {
      await onClose();
    });
  }
  await options.register?.(app);
  return app;
}

export interface RunningService {
  app: AppWithLogger<Logger>;
  /** Stops accepting connections, waits for in-flight requests, then runs onClose. */
  stop: () => Promise<void>;
}

/** Builds the app, starts listening, and stops gracefully on SIGTERM or SIGINT. */
export async function startHttpService(options: HttpServiceOptions): Promise<RunningService> {
  const app = await buildHttpService(options);
  await app.listen({ host: options.host, port: options.port });
  options.logger.info({ service: options.service, env: options.env }, 'service started');

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= app.close().then(() => {
      options.logger.info({ service: options.service }, 'service stopped');
    });
    return stopping;
  };

  for (const signal of options.handleSignals === false ? [] : (['SIGTERM', 'SIGINT'] as const)) {
    process.once(signal, () => {
      options.logger.info({ signal }, 'shutdown signal received');
      stop().then(
        () => process.exit(0),
        (err: unknown) => {
          options.logger.error({ err }, 'error during shutdown');
          process.exit(1);
        },
      );
    });
  }
  return { app, stop };
}
