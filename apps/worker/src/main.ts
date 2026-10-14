// Background job processors. Serves /health and /ready on its port; job processors arrive with S0.7.
import {
  connectDependencies,
  createLogger,
  databaseConfigShape,
  httpConfigShape,
  loadConfigOrExit,
  startHttpService,
  valkeyConfigShape,
} from '@dm/shared';

const SERVICE = 'worker';

const config = loadConfigOrExit({
  ...databaseConfigShape,
  VALKEY_QUEUE_URL: valkeyConfigShape.VALKEY_QUEUE_URL,
  ...httpConfigShape,
  PORT: httpConfigShape.PORT.default(3003),
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
