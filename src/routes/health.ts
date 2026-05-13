import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return { status: 'ok' };
  });
}

export interface ReadinessDeps {
  db: Database;
  redis: Redis;
}

export async function registerReadinessRoute(
  app: FastifyInstance,
  deps: ReadinessDeps,
): Promise<void> {
  app.get('/ready', async (req, reply) => {
    let postgres: 'ok' | 'down' = 'ok';
    try {
      await deps.db.execute(sql`SELECT 1`);
    } catch (err) {
      req.log.warn({ err }, 'postgres readiness check failed');
      postgres = 'down';
    }

    let redis: 'ok' | 'down' = 'ok';
    try {
      const pong = await deps.redis.ping();
      if (pong !== 'PONG') {
        redis = 'down';
      }
    } catch (err) {
      req.log.warn({ err }, 'redis readiness check failed');
      redis = 'down';
    }

    const allOk = postgres === 'ok' && redis === 'ok';
    return reply
      .code(allOk ? 200 : 503)
      .send({ status: allOk ? 'ok' : 'unavailable', checks: { postgres, redis } });
  });
}
