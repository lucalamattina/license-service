import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { buildTestApp, truncateAll } from '../helpers/app.js';
import { licenses } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const DAY_MS = 24 * 60 * 60 * 1000;

function futureIso(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * DAY_MS).toISOString();
}

function pastIso(daysBack = 1): string {
  return new Date(Date.now() - daysBack * DAY_MS).toISOString();
}

async function createUser(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/users', payload: { email } });
  return res.json().id as string;
}

async function createProduct(app: FastifyInstance, name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/products', payload: { name } });
  return res.json().id as string;
}

describe('Licenses routes', () => {
  let app: FastifyInstance;
  let db: Database;
  let client: Sql;

  beforeAll(async () => {
    ({ app, db, client } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  afterEach(async () => {
    await truncateAll(client);
  });

  describe('POST /licenses', () => {
    it('creates an Active license; created_at equals state_changed_at on insert', async () => {
      const userId = await createUser(app, 'a@x.com');
      const productId = await createProduct(app, 'A');

      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json();
      expect(body.id).toMatch(UUID_RE);
      expect(body.status).toBe('active');
      expect(body.user_id).toBe(userId);
      expect(body.product_id).toBe(productId);
      expect(body.created_at).toBeDefined();
      expect(body.expires_at).toBeDefined();
      expect(body).not.toHaveProperty('state_changed_at');

      const rows = await db.select().from(licenses);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.stateChangedAt.getTime()).toBe(rows[0]!.createdAt.getTime());
    });

    it('rejects expires_at <= now() with 400 expires_at_in_past', async () => {
      const userId = await createUser(app, 'b@x.com');
      const productId = await createProduct(app, 'B');

      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: pastIso() },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('expires_at_in_past');
    });

    it('rejects a non-ISO expires_at with 400 validation_error', async () => {
      const userId = await createUser(app, 'c@x.com');
      const productId = await createProduct(app, 'C');

      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: 'tomorrow' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });

    it('returns 400 validation_error for non-UUID user_id', async () => {
      const productId = await createProduct(app, 'D');
      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: 'not-a-uuid', product_id: productId, expires_at: futureIso() },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });

    it('returns 404 not_found when user_id does not exist', async () => {
      const productId = await createProduct(app, 'E');
      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: ZERO_UUID, product_id: productId, expires_at: futureIso() },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('returns 404 not_found when product_id does not exist', async () => {
      const userId = await createUser(app, 'f@x.com');
      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: ZERO_UUID, expires_at: futureIso() },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    // Duplicate-active-license policy (replacement + rejection) is exercised in detail
    // in tests/licenses/duplicate-policy.test.ts.

    it('allows a new license when the existing one for the pair is Revoked', async () => {
      const userId = await createUser(app, 'h@x.com');
      const productId = await createProduct(app, 'H');

      // Inserting a Revoked license directly (the API has no revoke yet — Phase 5).
      await db.insert(licenses).values({
        userId,
        productId,
        status: 'revoked',
        expiresAt: new Date(Date.now() + 5 * DAY_MS),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
      });
      expect(res.statusCode).toBe(201);
    });

    it('allows a new license when the existing one for the pair is Expired', async () => {
      const userId = await createUser(app, 'i@x.com');
      const productId = await createProduct(app, 'I');

      await db.insert(licenses).values({
        userId,
        productId,
        status: 'expired',
        expiresAt: new Date(Date.now() - DAY_MS),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('GET /licenses', () => {
    it('returns { data: [] } when no licenses exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/licenses' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [] });
    });

    it('returns all license records regardless of status', async () => {
      const userId = await createUser(app, 'j@x.com');
      const productId = await createProduct(app, 'J');
      await db.insert(licenses).values([
        { userId, productId, status: 'active', expiresAt: new Date(Date.now() + DAY_MS) },
      ]);
      await db.insert(licenses).values([
        { userId, productId, status: 'revoked', expiresAt: new Date(Date.now() + DAY_MS) },
        { userId, productId, status: 'expired', expiresAt: new Date(Date.now() - DAY_MS) },
      ]);

      const res = await app.inject({ method: 'GET', url: '/licenses' });
      const body = res.json();
      expect(body.data).toHaveLength(3);
      const statuses = body.data.map((l: { status: string }) => l.status).sort();
      expect(statuses).toEqual(['active', 'expired', 'revoked']);
    });
  });

  describe('GET /licenses/:id', () => {
    it('returns the license as a bare object', async () => {
      const userId = await createUser(app, 'k@x.com');
      const productId = await createProduct(app, 'K');
      const created = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
        })
      ).json();

      const res = await app.inject({ method: 'GET', url: `/licenses/${created.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(created);
    });

    it('returns 404 not_found for an unknown id', async () => {
      const res = await app.inject({ method: 'GET', url: `/licenses/${ZERO_UUID}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('returns 400 validation_error for a non-UUID id', async () => {
      const res = await app.inject({ method: 'GET', url: '/licenses/not-a-uuid' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });
  });

  describe('GET /licenses/:id/product', () => {
    it('returns the product of the license', async () => {
      const userId = await createUser(app, 'l@x.com');
      const productId = await createProduct(app, 'L');
      const license = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
        })
      ).json();

      const res = await app.inject({ method: 'GET', url: `/licenses/${license.id}/product` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: productId, name: 'L' });
    });

    it('returns 404 when the license does not exist', async () => {
      const res = await app.inject({ method: 'GET', url: `/licenses/${ZERO_UUID}/product` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });
  });

  describe('GET /licenses/:id/user', () => {
    it('returns the user of the license', async () => {
      const userId = await createUser(app, 'm@x.com');
      const productId = await createProduct(app, 'M');
      const license = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso() },
        })
      ).json();

      const res = await app.inject({ method: 'GET', url: `/licenses/${license.id}/user` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: userId, email: 'm@x.com' });
    });

    it('returns 404 when the license does not exist', async () => {
      const res = await app.inject({ method: 'GET', url: `/licenses/${ZERO_UUID}/user` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });
  });
});
