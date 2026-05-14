import { buildServer } from './server.js';
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

async function main(): Promise<void> {
  if (process.env.RUN_MIGRATIONS_ON_BOOT === 'true') {
    // Idempotent — Drizzle's migrator skips already-applied migrations. Production
    // images opt in via env so the container is self-sufficient on `docker compose up`.
    await runMigrations(DATABASE_URL);
  }

  const { db, client: dbClient } = createDatabase(DATABASE_URL);
  const redis = createRedisClient(REDIS_URL);
  const app = await buildServer({ db, redis });

  const queue = createLicenseQueue(REDIS_URL);
  const worker = createLicenseWorker(REDIS_URL, db);
  await registerExpirationScheduler(queue);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await worker.close();
    await queue.close();
    await redis.quit();
    await dbClient.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    await worker.close();
    await queue.close();
    await redis.quit();
    await dbClient.end();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
