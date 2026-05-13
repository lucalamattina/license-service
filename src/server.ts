import Fastify, { type FastifyInstance } from 'fastify';
import { buildLoggerOptions } from './plugins/logger.js';
import { registerHealthRoutes } from './routes/health.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(),
  });

  await app.register(registerHealthRoutes);

  return app;
}
