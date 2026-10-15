// Child process for the stalled-job test: takes one job, reports it, and never finishes, so the
// test can kill the process mid-job (SIGKILL: no chance to release the lock).
import { Worker } from 'bullmq';
import { queueConnection } from '../../src/queue.ts';

const [url = '', queueName = ''] = process.argv.slice(2);
const worker = new Worker(
  queueName,
  (job) => {
    process.stdout.write(`active ${String(job.id)}\n`);
    return new Promise<never>(() => undefined);
  },
  // Same timings as the recovering worker: BullMQ throttles stalled checks with a key whose TTL is the
  // stalledInterval of whichever worker set it last, so a slower setting here would delay recovery.
  { connection: queueConnection(url), lockDuration: 1000, stalledInterval: 500 },
);
worker.on('error', () => undefined);
