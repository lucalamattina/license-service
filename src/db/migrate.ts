import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { buildPostgresOptions } from './postgres-options.js';

const MIGRATIONS_FOLDER = './drizzle/migrations';

export async function runMigrations(connectionString: string): Promise<void> {
  const client = postgres(
    connectionString,
    buildPostgresOptions({ max: 1, onnotice: () => {} }),
  );
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
