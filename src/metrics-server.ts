import Fastify, { type FastifyInstance } from 'fastify';
import { buildLoggerOptions } from './plugins/logger.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMetricsRoute } from './plugins/metrics.js';

/**
 * Minimal HTTP server for the worker-only process: just /health (liveness) and
 * /metrics. The worker owns counters the web process never sees — notably
 * licenses_expired_total{path="scan"}, incremented by the expire-licenses scan
 * job — so it must expose its own scrape endpoint for Prometheus. No DB/Redis
 * routes, no /ready (the worker holds no inbound-traffic readiness contract).
 */
export async function buildMetricsServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: buildLoggerOptions() });
  await registerHealthRoutes(app);
  await registerMetricsRoute(app);
  return app;
}
