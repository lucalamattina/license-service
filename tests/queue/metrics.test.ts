import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import type { Redis } from 'ioredis';
import { buildTestApp, truncateAll } from '../helpers/app.js';
import { metricsRegistry } from '../../src/plugins/metrics.js';
import { runExpireLicensesJob } from '../../src/queue/jobs/expire-licenses.js';
import { licenses } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function futureIso(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * DAY_MS).toISOString();
}

async function getCounter(name: string, labels: Record<string, string> = {}): Promise<number> {
  const json = (await metricsRegistry.getMetricsAsJSON()) as Array<{
    name: string;
    values: Array<{ value: number; labels: Record<string, string> }>;
  }>;
  const metric = json.find((m) => m.name === name);
  if (!metric) return 0;
  const match = metric.values.find((v) =>
    Object.keys(labels).every((k) => v.labels[k] === labels[k]),
  );
  return match?.value ?? 0;
}

async function createUser(app: FastifyInstance, email: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/users', payload: { email } });
  return r.json().id as string;
}

async function createProduct(app: FastifyInstance, name: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/products', payload: { name } });
  return r.json().id as string;
}

describe('GET /metrics + counter wiring', () => {
  let app: FastifyInstance;
  let db: Database;
  let client: Sql;
  let redis: Redis;

  beforeAll(async () => {
    ({ app, db, client, redis } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await client.end();
  });

  beforeEach(async () => {
    await truncateAll(client);
    metricsRegistry.resetMetrics();
  });

  describe('GET /metrics', () => {
    it('returns Prometheus text and exposes the four custom counters', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      const body = res.body;
      expect(body).toContain('licenses_issued_total');
      expect(body).toContain('licenses_revoked_total');
      expect(body).toContain('licenses_expired_total');
      expect(body).toContain('license_validations_total');
      // prom-client default process metrics should also be present.
      expect(body).toMatch(/process_cpu_seconds_total/);
    });
  });

  describe('counter wiring', () => {
    it('issuing a license increments licenses_issued_total by 1', async () => {
      const userId = await createUser(app, 'm-i@x.com');
      const productId = await createProduct(app, 'M-I');

      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
      });

      expect(await getCounter('licenses_issued_total')).toBe(1);
    });

    it('a rejected issuance does NOT increment licenses_issued_total', async () => {
      const userId = await createUser(app, 'm-rej@x.com');
      const productId = await createProduct(app, 'M-REJ');

      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(100) },
      });
      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(10) },
      });

      // Only the first succeeded; the second was 409.
      expect(await getCounter('licenses_issued_total')).toBe(1);
    });

    it('revoking a license increments licenses_revoked_total by 1', async () => {
      const userId = await createUser(app, 'm-r@x.com');
      const productId = await createProduct(app, 'M-R');
      const license = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
        })
      ).json();

      await app.inject({ method: 'POST', url: `/licenses/${license.id}/revoke` });

      expect(await getCounter('licenses_revoked_total')).toBe(1);
    });

    it('a rejected revoke does NOT increment licenses_revoked_total', async () => {
      const userId = await createUser(app, 'm-r2@x.com');
      const productId = await createProduct(app, 'M-R2');
      const license = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
        })
      ).json();
      await app.inject({ method: 'POST', url: `/licenses/${license.id}/revoke` });
      await app.inject({ method: 'POST', url: `/licenses/${license.id}/revoke` });

      expect(await getCounter('licenses_revoked_total')).toBe(1);
    });

    it('validating an Active license increments license_validations_total{result="valid"}', async () => {
      const userId = await createUser(app, 'm-v@x.com');
      const productId = await createProduct(app, 'M-V');
      const license = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
        })
      ).json();

      await app.inject({ method: 'POST', url: `/licenses/${license.id}/validate` });

      expect(await getCounter('license_validations_total', { result: 'valid' })).toBe(1);
      expect(await getCounter('license_validations_total', { result: 'invalid' })).toBe(0);
    });

    it('validating a Revoked license increments license_validations_total{result="invalid"}', async () => {
      const userId = await createUser(app, 'm-v2@x.com');
      const productId = await createProduct(app, 'M-V2');
      const license = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
        })
      ).json();
      await app.inject({ method: 'POST', url: `/licenses/${license.id}/revoke` });

      await app.inject({ method: 'POST', url: `/licenses/${license.id}/validate` });

      expect(await getCounter('license_validations_total', { result: 'invalid' })).toBe(1);
    });

    it('validate path that transitions Active→Expired bumps both counters with path="validate"', async () => {
      const userId = await createUser(app, 'm-vt@x.com');
      const productId = await createProduct(app, 'M-VT');
      const [stale] = await db
        .insert(licenses)
        .values({
          userId,
          productId,
          status: 'active',
          expiresAt: new Date(Date.now() - DAY_MS),
        })
        .returning();

      await app.inject({ method: 'POST', url: `/licenses/${stale!.id}/validate` });

      expect(await getCounter('license_validations_total', { result: 'invalid' })).toBe(1);
      expect(await getCounter('licenses_expired_total', { path: 'validate' })).toBe(1);
      expect(await getCounter('licenses_expired_total', { path: 'scan' })).toBe(0);
    });

    it('the scan job increments licenses_expired_total{path="scan"} by the row count', async () => {
      const userId = await createUser(app, 'm-s@x.com');
      const productId1 = await createProduct(app, 'M-S1');
      const productId2 = await createProduct(app, 'M-S2');
      await db.insert(licenses).values([
        {
          userId,
          productId: productId1,
          status: 'active',
          expiresAt: new Date(Date.now() - DAY_MS),
        },
        {
          userId,
          productId: productId2,
          status: 'active',
          expiresAt: new Date(Date.now() - DAY_MS),
        },
      ]);

      const result = await runExpireLicensesJob(db);
      expect(result.expired).toBe(2);
      expect(await getCounter('licenses_expired_total', { path: 'scan' })).toBe(2);
      expect(await getCounter('licenses_expired_total', { path: 'validate' })).toBe(0);
    });

    it('no-double-counting: scan + per-license validates total exactly N expired across both paths', async () => {
      const N = 5;
      const userId = await createUser(app, 'm-nd@x.com');
      const productIds: string[] = [];
      for (let i = 0; i < N; i++) {
        productIds.push(await createProduct(app, `M-ND-${i}`));
      }
      const ids: string[] = [];
      for (const pid of productIds) {
        const [row] = await db
          .insert(licenses)
          .values({
            userId,
            productId: pid,
            status: 'active',
            expiresAt: new Date(Date.now() - DAY_MS),
          })
          .returning();
        ids.push(row!.id);
      }

      // Race scan and N validates simultaneously.
      await Promise.all([
        runExpireLicensesJob(db),
        ...ids.map((id) => app.inject({ method: 'POST', url: `/licenses/${id}/validate` })),
      ]);

      const scanCount = await getCounter('licenses_expired_total', { path: 'scan' });
      const validateCount = await getCounter('licenses_expired_total', { path: 'validate' });
      expect(scanCount + validateCount).toBe(N);
    });
  });
});
