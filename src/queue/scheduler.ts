import { Queue, Worker, type Job } from 'bullmq';
import { bullmqConnection } from './connection.js';
import type { Database } from '../db/client.js';
import { runExpireLicensesJob } from './jobs/expire-licenses.js';

export const QUEUE_NAME = 'license-jobs';
export const EXPIRE_LICENSES_JOB = 'expire-licenses';
const DEFAULT_INTERVAL_MS = 60_000;

export function createLicenseQueue(redisUrl: string): Queue {
  return new Queue(QUEUE_NAME, { connection: bullmqConnection(redisUrl) });
}

export function createLicenseWorker(redisUrl: string, db: Database): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === EXPIRE_LICENSES_JOB) {
        return runExpireLicensesJob(db);
      }
      throw new Error(`unknown job: ${job.name}`);
    },
    { connection: bullmqConnection(redisUrl) },
  );
}

/**
 * Registers the repeatable expire-licenses job. `upsertJobScheduler` is
 * idempotent on the scheduler id, so this is safe to call on every boot
 * (dev hot-reload, multi-instance deploys, etc).
 */
export async function registerExpirationScheduler(
  queue: Queue,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Promise<void> {
  await queue.upsertJobScheduler(
    EXPIRE_LICENSES_JOB,
    { every: intervalMs },
    { name: EXPIRE_LICENSES_JOB },
  );
}
