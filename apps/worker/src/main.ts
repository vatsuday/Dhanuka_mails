// Background job processors (BullMQ on valkey-queue, ADR-004). Serves /health and /ready on its port.
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
import { Worker } from 'bullmq';
import { processTenantSample, TENANT_SAMPLE_QUEUE, type TenantSampleJob, type TenantSampleResult } from './jobs/tenant-sample.ts';
import { queueConnection } from './queue.ts';

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
if (dependencies.postgres === undefined) throw new Error('worker requires DATABASE_URL');
const db = createDatabase(dependencies.postgres);

// Job workers use their own connection: BullMQ needs maxRetriesPerRequest: null, unlike the
// fail-fast client behind the readiness check.
const connection = queueConnection(config.VALKEY_QUEUE_URL);
let lastConnectionError = '';
connection.on('error', (err: Error) => {
  if (err.message !== lastConnectionError) logger.warn({ dependency: 'valkey-queue', err }, 'queue connection error');
  lastConnectionError = err.message;
});

const workers = [
  new Worker<TenantSampleJob, TenantSampleResult>(TENANT_SAMPLE_QUEUE, (job) => processTenantSample(db, job.data), {
    connection,
  }),
];
for (const worker of workers) {
  worker.on('failed', (job, err) => {
    logger.warn({ queue: worker.name, jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'job failed');
  });
  worker.on('error', (err) => {
    logger.warn({ queue: worker.name, err }, 'worker error');
  });
}

await startHttpService({
  service: SERVICE,
  env: config.APP_ENV,
  host: config.HOST,
  port: config.PORT,
  logger,
  checks: dependencies.checks,
  onClose: async () => {
    // Stop taking jobs and let active ones finish, then close connections. If Valkey is unreachable,
    // force-close so shutdown cannot hang.
    await Promise.all(workers.map((w) => w.close(connection.status !== 'ready')));
    connection.disconnect();
    await dependencies.close();
  },
});
