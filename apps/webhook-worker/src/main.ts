// Outbound tenant webhooks on isolated egress (ADR-009). Serves /health and /ready; delivery arrives in Sprint 8.
import {
  connectDependencies,
  createLogger,
  databaseConfigShape,
  httpConfigShape,
  loadConfigOrExit,
  startHttpService,
  valkeyConfigShape,
} from '@dm/shared';

const SERVICE = 'webhook-worker';

const config = loadConfigOrExit({
  ...databaseConfigShape,
  VALKEY_QUEUE_URL: valkeyConfigShape.VALKEY_QUEUE_URL,
  ...httpConfigShape,
  PORT: httpConfigShape.PORT.default(3004),
});

const logger = createLogger({ service: SERVICE, env: config.APP_ENV, level: config.LOG_LEVEL });
const dependencies = connectDependencies(
  { databaseUrl: config.DATABASE_URL, valkeyQueueUrl: config.VALKEY_QUEUE_URL },
  logger,
);

await startHttpService({
  service: SERVICE,
  env: config.APP_ENV,
  host: config.HOST,
  port: config.PORT,
  logger,
  checks: dependencies.checks,
  onClose: dependencies.close,
});
