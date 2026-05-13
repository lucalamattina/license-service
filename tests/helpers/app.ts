import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import type { Redis } from 'ioredis';
import { buildServer } from '../../src/server.js';
import type { Database } from '../../src/db/client.js';
import { createRedisClient } from '../../src/queue/connection.js';
import { setupTestDatabase, truncateAll } from './db.js';

const DEFAULT_TEST_REDIS_URL = 'redis://localhost:6380';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? DEFAULT_TEST_REDIS_URL;

export interface TestApp {
  app: FastifyInstance;
  db: Database;
  client: Sql;
  redis: Redis;
}

export async function buildTestApp(): Promise<TestApp> {
  process.env.LOG_LEVEL = 'silent';
  const { db, client } = await setupTestDatabase();
  const redis = createRedisClient(TEST_REDIS_URL);
  const app = await buildServer({ db, redis });
  return { app, db, client, redis };
}

export async function closeTestApp(t: TestApp): Promise<void> {
  await t.app.close();
  await t.redis.quit();
  await t.client.end();
}

export { truncateAll };
