import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { buildServer } from '../../src/server.js';
import type { Database } from '../../src/db/client.js';
import { setupTestDatabase, truncateAll } from './db.js';

export interface TestApp {
  app: FastifyInstance;
  db: Database;
  client: Sql;
}

export async function buildTestApp(): Promise<TestApp> {
  process.env.LOG_LEVEL = 'silent';
  const { db, client } = await setupTestDatabase();
  const app = await buildServer({ db });
  return { app, db, client };
}

export { truncateAll };
