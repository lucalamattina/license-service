import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';
import { buildPostgresOptions } from './postgres-options.js';

export type Database = PostgresJsDatabase<typeof schema>;

export function createDatabase(connectionString: string): { db: Database; client: Sql } {
  const client = postgres(connectionString, buildPostgresOptions());
  const db = drizzle(client, { schema });
  return { db, client };
}
