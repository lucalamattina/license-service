import { buildServer } from './server.js';
import { buildMetricsServer } from './metrics-server.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createRedisClient } from './queue/connection.js';
import {
  createLicenseQueue,
  createLicenseWorker,
  registerExpirationScheduler,
} from './queue/scheduler.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://license_service:license_service@localhost:5433/license_service';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

// Which responsibilities this process takes on:
//   web    — HTTP server only (no queue/worker/scheduler)
//   worker — BullMQ worker + repeatable scheduler only (no HTTP server)
//   all    — both, in one process (default; matches Heroku single-dyno + local dev)
// Kubernetes sets PROCESS_ROLE=web / =worker to split the two into separate Deployments.
const ROLE = process.env.PROCESS_ROLE ?? 'all';
const wantsWeb = ROLE === 'web' || ROLE === 'all';
const wantsWorker = ROLE === 'worker' || ROLE === 'all';

async function main(): Promise<void> {
  if (ROLE !== 'web' && ROLE !== 'worker' && ROLE !== 'all') {
    throw new Error(`invalid PROCESS_ROLE: ${ROLE} (expected web | worker | all)`);
  }

  if (process.env.RUN_MIGRATIONS_ON_BOOT === 'true') {
    // Idempotent — Drizzle's migrator skips already-applied migrations. Production
    // images opt in via env so the container is self-sufficient on `docker compose up`.
    // On Kubernetes this stays false; the dedicated migration Job owns schema changes.
    await runMigrations(DATABASE_URL);
  }

  const { db, client: dbClient } = createDatabase(DATABASE_URL);
  // The web role still needs Redis: the /ready route pings both Postgres and Redis.
  const redis = createRedisClient(REDIS_URL);

  // Build only the resources this role owns.
  const app = wantsWeb ? await buildServer({ db, redis }) : null;
  // Worker-only process: serve /health + /metrics so Prometheus can scrape the
  // counters this process owns (licenses_expired_total{path="scan"}). In role
  // 'all' the full app already exposes /metrics, so no separate server is needed.
  const metricsApp = ROLE === 'worker' ? await buildMetricsServer() : null;
  const httpServer = app ?? metricsApp;

  const queue = wantsWorker ? createLicenseQueue(REDIS_URL) : null;
  const worker = wantsWorker ? createLicenseWorker(REDIS_URL, db) : null;
  if (wantsWorker && queue) {
    // The worker role owns scheduler registration — it executes the repeatable job.
    // upsertJobScheduler is idempotent, so this is safe across boots/instances.
    await registerExpirationScheduler(queue);
  }

  // Every role now has an HTTP server (full app, or the worker's metrics server),
  // so log through its pino logger.
  const logInfo = (obj: Record<string, unknown>, msg: string): void => {
    if (httpServer) httpServer.log.info(obj, msg);
    else console.log(msg, obj);
  };

  let shuttingDown = false;
  const teardown = async (): Promise<void> => {
    if (httpServer) await httpServer.close();
    if (worker) await worker.close();
    if (queue) await queue.close();
    await redis.quit();
    await dbClient.end();
  };
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo({ signal }, 'shutting down');
    await teardown();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  if (httpServer) {
    try {
      await httpServer.listen({ port: PORT, host: HOST });
    } catch (err) {
      httpServer.log.error(err);
      await teardown();
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
