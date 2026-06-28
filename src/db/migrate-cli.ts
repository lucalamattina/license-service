import { runMigrations } from './migrate.js';

// Runnable entrypoint for the migration Kubernetes Job (and any one-shot
// migrate-and-exit use). `migrate.ts` only *exports* runMigrations; this file
// is the process that invokes it and exits with a status code.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://license_service:license_service@localhost:5433/license_service';

runMigrations(DATABASE_URL)
  .then(() => {
    console.log('migrations applied');
    process.exit(0);
  })
  .catch((err) => {
    console.error('migration failed', err);
    process.exit(1);
  });
