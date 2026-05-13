import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';
import { buildLoggerOptions } from './plugins/logger.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerZod } from './plugins/zod.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLicenseRoutes } from './routes/licenses.js';
import { registerProductRoutes } from './routes/products.js';
import { registerUserRoutes } from './routes/users.js';

export interface ServerOptions {
  db: Database;
}

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(),
  });

  await registerZod(app);
  await registerErrorHandler(app);
  await registerHealthRoutes(app);
  await registerUserRoutes(app, options.db);
  await registerProductRoutes(app, options.db);
  await registerLicenseRoutes(app, options.db);

  return app;
}
