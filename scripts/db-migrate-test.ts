import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';

const DEFAULT_TEST_URL =
  'postgres://license_service:license_service@localhost:5433/license_service_test';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;

async function ensureDatabaseExists(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1 });
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }
}

await ensureDatabaseExists(TEST_DATABASE_URL);
await runMigrations(TEST_DATABASE_URL);
console.log(`test DB ready: ${TEST_DATABASE_URL}`);
