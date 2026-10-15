// BullMQ 6 spike (S0.7 AC 1, ADR-004) against Valkey configured exactly like valkey-queue in
// infra/docker/docker-compose.yml. Findings are written up in docs/spikes/S0.7-queue-spike.md.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Queue, Worker, type Job, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { queueConnection } from '../../src/queue.ts';

const VALKEY_IMAGE = 'valkey/valkey:8.1.10';
const QUEUE_ARGS = ['valkey-server', '--appendonly', 'yes', '--appendfsync', 'everysec', '--maxmemory-policy', 'noeviction'];

const startValkey = (command: string[]) =>
  new GenericContainer(VALKEY_IMAGE)
    .withCommand(command)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
const urlOf = (c: StartedTestContainer) => `redis://${c.getHost()}:${String(c.getMappedPort(6379))}`;

let valkey: StartedTestContainer;
let url: string;
let connection: Redis;
const cleanup: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  valkey = await startValkey(QUEUE_ARGS);
  url = urlOf(valkey);
  connection = queueConnection(url);
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
afterAll(async () => {
  connection.disconnect();
  await valkey.stop();
});

function queue(name = randomUUID()): Queue {
  const q = new Queue(name, { connection });
  cleanup.push(() => q.close());
  return q;
}
function worker<T>(name: string, processor: Processor<T>, opts: { stalledInterval?: number; lockDuration?: number } = {}): Worker<T> {
  const w = new Worker<T>(name, processor, { connection, ...opts });
  w.on('error', () => undefined);
  cleanup.push(() => w.close(true));
  return w;
}
/** Resolves when `event` fires on `w` and `predicate` holds, or rejects after `ms`. */
function waitFor<A extends unknown[]>(w: Worker, event: 'completed' | 'failed' | 'stalled', ms: number, predicate: (...args: A) => boolean = () => true) {
  return new Promise<A>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`timed out waiting for ${event}`)); }, ms);
    w.on(event, (...args: unknown[]) => {
      if (predicate(...(args as A))) {
        clearTimeout(timer);
        resolve(args as A);
      }
    });
  });
}

describe('valkey-queue configuration', () => {
  it('uses noeviction and AOF, like the compose service', async () => {
    expect(await connection.config('GET', 'maxmemory-policy')).toEqual(['maxmemory-policy', 'noeviction']);
    expect(await connection.config('GET', 'appendonly')).toEqual(['appendonly', 'yes']);
  });

  it('when memory is full, noeviction rejects new jobs instead of silently dropping queued ones', async () => {
    const small = await startValkey([...QUEUE_ARGS, '--maxmemory', '3mb']);
    const smallConnection = queueConnection(urlOf(small));
    const q = new Queue(randomUUID(), { connection: smallConnection });
    const payload = 'x'.repeat(32 * 1024);
    const added: string[] = [];
    let error: unknown;
    try {
      for (let i = 0; i < 500; i++) added.push((await q.add('fill', { payload, i })).id ?? '');
    } catch (e) {
      error = e;
    }
    expect(String(error)).toMatch(/OOM/);
    expect(added.length).toBeGreaterThan(10);
    // Every job that was accepted is still there.
    const counts = await q.getJobCounts('waiting');
    expect(counts.waiting).toBe(added.length);
    await q.close();
    smallConnection.disconnect();
    await small.stop();
  });
});

describe('BullMQ 6 behaviour', () => {
  it('retries a failing job with exponential backoff, then completes', async () => {
    const q = queue();
    const attempts: number[] = [];
    const w = worker(q.name, (job: Job) => {
      attempts.push(Date.now());
      if (attempts.length < 3) throw new Error(`attempt ${String(attempts.length)} fails`);
      return Promise.resolve(`done after ${String(job.attemptsStarted)} starts`);
    });
    const done = waitFor<[Job, string]>(w, 'completed', 15_000);
    await q.add('retry', {}, { attempts: 3, backoff: { type: 'exponential', delay: 300 } });
    const [, result] = await done;
    expect(result).toBe('done after 3 starts');
    const [first = 0, second = 0, third = 0] = attempts;
    // Exponential: about 300 ms, then about 600 ms.
    expect(second - first).toBeGreaterThanOrEqual(300);
    expect(third - second).toBeGreaterThanOrEqual(600);
  });

  it('moves a job to failed once its attempts are exhausted', async () => {
    const q = queue();
    const w = worker(q.name, () => Promise.reject(new Error('always fails')));
    const failed = waitFor<[Job | undefined, Error]>(w, 'failed', 10_000, (job) => job?.attemptsMade === 2);
    const job = await q.add('doomed', {}, { attempts: 2, backoff: { type: 'fixed', delay: 100 } });
    await failed;
    expect(await q.getJobState(job.id ?? '')).toBe('failed');
    expect((await q.getJob(job.id ?? ''))?.failedReason).toBe('always fails');
  });

  it('holds a delayed job until its delay has passed', async () => {
    const q = queue();
    const job = await q.add('later', {}, { delay: 800 });
    expect(await q.getJobState(job.id ?? '')).toBe('delayed');
    const w = worker(q.name, () => Promise.resolve());
    const [completed] = await waitFor<[Job]>(w, 'completed', 10_000);
    expect((completed.processedOn ?? 0) - completed.timestamp).toBeGreaterThanOrEqual(800);
  });

  it('runs a repeatable job (job scheduler) on its interval and stops after removal', async () => {
    const q = queue();
    let runs = 0;
    worker(q.name, () => {
      runs++;
      return Promise.resolve();
    });
    await q.upsertJobScheduler('tick', { every: 300 }, { name: 'tick', data: {} });
    // Re-upserting is idempotent: still one scheduler.
    await q.upsertJobScheduler('tick', { every: 300 }, { name: 'tick', data: {} });
    expect(await q.getJobSchedulersCount()).toBe(1);
    await new Promise((r) => setTimeout(r, 1600));
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(await q.removeJobScheduler('tick')).toBe(true);
    await new Promise((r) => setTimeout(r, 400)); // let an in-flight run finish
    const afterRemoval = runs;
    await new Promise((r) => setTimeout(r, 1000));
    expect(runs).toBe(afterRemoval);
    expect(await q.getJobSchedulersCount()).toBe(0);
  });

  it('recovers a job whose worker process was killed mid-job (stalled-job recovery)', async () => {
    const q = queue();
    const job = await q.add('crash', { n: 1 });

    // A separate worker process takes the job and is then killed without releasing its lock.
    const child = spawn(process.execPath, [fileURLToPath(new URL('hanging-worker.ts', import.meta.url)), url, q.name], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('child never took the job')); }, 15_000);
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes(`active ${String(job.id)}`)) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(await q.getJobState(job.id ?? '')).toBe('active');
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));

    // A healthy worker notices the expired lock, moves the job back to waiting, and completes it.
    const w = worker(q.name, (j: Job) => Promise.resolve(`recovered ${String(j.id)}`), { stalledInterval: 500, lockDuration: 1000 });
    const stalled = waitFor<[string]>(w, 'stalled', 15_000, (id) => id === job.id);
    const completed = waitFor<[Job, string]>(w, 'completed', 15_000, (j) => j.id === job.id);
    await stalled;
    const [, result] = await completed;
    expect(result).toBe(`recovered ${String(job.id)}`);
    expect((await q.getJob(job.id ?? ''))?.stalledCounter).toBe(1);
  });
});
