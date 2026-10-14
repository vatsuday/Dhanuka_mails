// Open pixel, click redirect and unsubscribe endpoints.
import {
  connectDependencies,
  createLogger,
  databaseConfigShape,
  httpConfigShape,
  loadConfigOrExit,
  startHttpService,
  valkeyConfigShape,
} from '@dm/shared';

const SERVICE = 'tracker';

const config = loadConfigOrExit({
  ...databaseConfigShape,
  VALKEY_QUEUE_URL: valkeyConfigShape.VALKEY_QUEUE_URL,
  VALKEY_CACHE_URL: valkeyConfigShape.VALKEY_CACHE_URL,
  ...httpConfigShape,
  PORT: httpConfigShape.PORT.default(3002),
});

const logger = createLogger({ service: SERVICE, env: config.APP_ENV, level: config.LOG_LEVEL });
const dependencies = connectDependencies(
  { databaseUrl: config.DATABASE_URL, valkeyQueueUrl: config.VALKEY_QUEUE_URL, valkeyCacheUrl: config.VALKEY_CACHE_URL },
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
