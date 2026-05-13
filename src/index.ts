import { buildServer } from './server.js';
import { createDatabase } from './db/client.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://license_service:license_service@localhost:5433/license_service';

async function main(): Promise<void> {
  const { db, client } = createDatabase(DATABASE_URL);
  const app = await buildServer({ db });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await client.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    await client.end();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
