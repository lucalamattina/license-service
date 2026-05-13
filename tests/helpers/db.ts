import postgres, { type Sql } from 'postgres';
import { createDatabase, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

const DEFAULT_TEST_URL =
  'postgres://license_service:license_service@localhost:5433/license_service_test';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;

let migrated = false;

async function ensureDatabaseExists(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
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

export async function setupTestDatabase(): Promise<{ db: Database; client: Sql }> {
  if (!migrated) {
    await ensureDatabaseExists();
    await runMigrations(TEST_DATABASE_URL);
    migrated = true;
  }
  return createDatabase(TEST_DATABASE_URL);
}

export async function truncateAll(client: Sql): Promise<void> {
  await client`TRUNCATE TABLE licenses, products, users RESTART IDENTITY CASCADE`;
}
