import { runMigrations } from '../src/db/migrate.js';

const DEFAULT_URL = 'postgres://license_service:license_service@localhost:5433/license_service';

const url = process.env.DATABASE_URL ?? DEFAULT_URL;

await runMigrations(url);
console.log(`migrations applied to ${url}`);
