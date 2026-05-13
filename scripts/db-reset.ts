import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';

const DEFAULT_URL = 'postgres://license_service:license_service@localhost:5433/license_service';
const targetUrl = process.env.DATABASE_URL ?? DEFAULT_URL;

const url = new URL(targetUrl);
const dbName = url.pathname.slice(1);
url.pathname = '/postgres';

const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
try {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
} finally {
  await admin.end();
}

await runMigrations(targetUrl);
console.log(`reset complete: ${targetUrl}`);
