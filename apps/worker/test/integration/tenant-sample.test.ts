// S0.7 AC 4 (moved from S0.8): a worker job runs inside withTenant, end to end through BullMQ,
// as the runtime role against a migrated Postgres.
import { randomUUID } from 'node:crypto';
import { contacts, createDatabase, tenants, withTenant, type Database } from '@dm/db';
import { startTestDatabase, type TestDatabase } from '@dm/db/testing';
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processTenantSample, TENANT_SAMPLE_QUEUE, type TenantSampleJob, type TenantSampleResult } from '../../src/jobs/tenant-sample.ts';
import { queueConnection } from '../../src/queue.ts';

let pg: TestDatabase;
let valkey: StartedTestContainer;
let connection: Redis;
let db: Database;
let queue: Queue<TenantSampleJob, TenantSampleResult>;
let worker: Worker<TenantSampleJob, TenantSampleResult>;
const tenantA = randomUUID();
const tenantB = randomUUID();
const emptyTenant = randomUUID();

/** Adds a job and resolves with its result, or rejects with its failure reason. */
async function run(data: TenantSampleJob): Promise<TenantSampleResult> {
  const job = await queue.add('sample', data, { attempts: 1 });
  return new Promise((resolve, reject) => {
    const onCompleted = (j: Job, result: TenantSampleResult) => {
      if (j.id === job.id) { off(); resolve(result); }
    };
    const onFailed = (j: Job | undefined, err: Error) => {
      if (j?.id === job.id) { off(); reject(err); }
    };
    const off = () => {
      worker.off('completed', onCompleted);
      worker.off('failed', onFailed);
    };
    worker.on('completed', onCompleted);
    worker.on('failed', onFailed);
  });
}

beforeAll(async () => {
  [pg, valkey] = await Promise.all([
    startTestDatabase(),
    new GenericContainer('valkey/valkey:8.1.10')
      .withCommand(['valkey-server', '--maxmemory-policy', 'noeviction'])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
  db = createDatabase(pg.pool('app_user'));
  const seed = async (tenantId: string, active: number, deleted: number) => {
    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: 'T', slug: `t-${tenantId}` });
      for (let i = 0; i < active + deleted; i++) {
        await tx.insert(contacts).values({
          tenantId,
          emailNormalized: `${randomUUID()}@example.in`,
          deletedAt: i < deleted ? new Date() : null,
        });
      }
    });
  };
  await seed(tenantA, 2, 1);
  await seed(tenantB, 5, 0);
  await seed(emptyTenant, 0, 0);

  connection = queueConnection(`redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`);
  queue = new Queue(TENANT_SAMPLE_QUEUE, { connection });
  // The same wiring as src/main.ts.
  worker = new Worker(TENANT_SAMPLE_QUEUE, (job) => processTenantSample(db, job.data), { connection });
  worker.on('error', () => undefined);
});

afterAll(async () => {
  await worker.close();
  await queue.close();
  connection.disconnect();
  await Promise.all([pg.stop(), valkey.stop()]);
});

describe('tenant-sample job', () => {
  it('counts only the job tenant\'s active contacts', async () => {
    expect(await run({ tenantId: tenantA })).toEqual({ activeContacts: 2 });
    expect(await run({ tenantId: tenantB })).toEqual({ activeContacts: 5 });
  });

  it('sees nothing of other tenants when its own tenant has no data', async () => {
    expect(await run({ tenantId: emptyTenant })).toEqual({ activeContacts: 0 });
  });

  it('fails a job whose tenant ID is not a UUID, without querying', async () => {
    await expect(run({ tenantId: 'not-a-uuid' })).rejects.toThrow('withTenant: tenantId must be a UUID');
  });
});
