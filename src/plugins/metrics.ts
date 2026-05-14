import { collectDefaultMetrics, Counter, Registry } from 'prom-client';
import type { FastifyInstance } from 'fastify';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

export const licensesIssuedTotal = new Counter({
  name: 'licenses_issued_total',
  help: 'Total Active licenses issued via POST /licenses (after the transaction commits).',
  registers: [metricsRegistry],
});

export const licensesRevokedTotal = new Counter({
  name: 'licenses_revoked_total',
  help: 'Total licenses transitioned to Revoked via POST /licenses/:id/revoke.',
  registers: [metricsRegistry],
});

export const licensesExpiredTotal = new Counter({
  name: 'licenses_expired_total',
  help: 'Total licenses transitioned from Active to Expired, labelled by which writer did the flip.',
  labelNames: ['path'] as const,
  registers: [metricsRegistry],
});

export const licenseValidationsTotal = new Counter({
  name: 'license_validations_total',
  help: 'Total POST /licenses/:id/validate calls that completed, labelled by verdict.',
  labelNames: ['result'] as const,
  registers: [metricsRegistry],
});

export async function registerMetricsRoute(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });
}
