import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { buildTestApp, truncateAll } from '../helpers/app.js';
import { licenses } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const DAY_MS = 24 * 60 * 60 * 1000;

async function createUser(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/users', payload: { email } });
  return res.json().id as string;
}

async function createProduct(app: FastifyInstance, name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/products', payload: { name } });
  return res.json().id as string;
}

describe('Relationship endpoints', () => {
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

  describe('GET /users/:id/licenses', () => {
    it('returns { data: [] } when the user has no licenses', async () => {
      const userId = await createUser(app, 'empty@x.com');
      const res = await app.inject({ method: 'GET', url: `/users/${userId}/licenses` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [] });
    });

    it('returns licenses in all statuses (historical view)', async () => {
      const userId = await createUser(app, 'all@x.com');
      const productId = await createProduct(app, 'AllProd');
      const otherProductId = await createProduct(app, 'OtherProd');
      const thirdProductId = await createProduct(app, 'ThirdProd');

      await db.insert(licenses).values([
        { userId, productId, status: 'active', expiresAt: new Date(Date.now() + DAY_MS) },
        {
          userId,
          productId: otherProductId,
          status: 'revoked',
          expiresAt: new Date(Date.now() + DAY_MS),
        },
        {
          userId,
          productId: thirdProductId,
          status: 'expired',
          expiresAt: new Date(Date.now() - DAY_MS),
        },
      ]);

      const res = await app.inject({ method: 'GET', url: `/users/${userId}/licenses` });
      expect(res.statusCode).toBe(200);
      const statuses = res.json().data.map((l: { status: string }) => l.status).sort();
      expect(statuses).toEqual(['active', 'expired', 'revoked']);
    });

    it('returns 404 for an unknown user', async () => {
      const res = await app.inject({ method: 'GET', url: `/users/${ZERO_UUID}/licenses` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });
  });

  describe('GET /users/:id/products', () => {
    it('returns { data: [] } when the user has no Active licenses', async () => {
      const userId = await createUser(app, 'np@x.com');
      const res = await app.inject({ method: 'GET', url: `/users/${userId}/products` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [] });
    });

    it('returns only products with an Active license (right-now view)', async () => {
      const userId = await createUser(app, 'right-now@x.com');
      const activeProductId = await createProduct(app, 'Active');
      const revokedProductId = await createProduct(app, 'Revoked');
      const expiredProductId = await createProduct(app, 'Expired');

      await db.insert(licenses).values([
        {
          userId,
          productId: activeProductId,
          status: 'active',
          expiresAt: new Date(Date.now() + DAY_MS),
        },
        {
          userId,
          productId: revokedProductId,
          status: 'revoked',
          expiresAt: new Date(Date.now() + DAY_MS),
        },
        {
          userId,
          productId: expiredProductId,
          status: 'expired',
          expiresAt: new Date(Date.now() - DAY_MS),
        },
      ]);

      const res = await app.inject({ method: 'GET', url: `/users/${userId}/products` });
      expect(res.statusCode).toBe(200);
      const names = res.json().data.map((p: { name: string }) => p.name);
      expect(names).toEqual(['Active']);
    });

    it('returns 404 for an unknown user', async () => {
      const res = await app.inject({ method: 'GET', url: `/users/${ZERO_UUID}/products` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });
  });

  describe('GET /products/:id/licenses', () => {
    it('returns { data: [] } when the product has no licenses', async () => {
      const productId = await createProduct(app, 'No');
      const res = await app.inject({ method: 'GET', url: `/products/${productId}/licenses` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [] });
    });

    it('returns licenses in all statuses (historical view)', async () => {
      const productId = await createProduct(app, 'Histo');
      const u1 = await createUser(app, 'h1@x.com');
      const u2 = await createUser(app, 'h2@x.com');
      const u3 = await createUser(app, 'h3@x.com');

      await db.insert(licenses).values([
        { userId: u1, productId, status: 'active', expiresAt: new Date(Date.now() + DAY_MS) },
        { userId: u2, productId, status: 'revoked', expiresAt: new Date(Date.now() + DAY_MS) },
        { userId: u3, productId, status: 'expired', expiresAt: new Date(Date.now() - DAY_MS) },
      ]);

      const res = await app.inject({ method: 'GET', url: `/products/${productId}/licenses` });
      expect(res.statusCode).toBe(200);
      const statuses = res.json().data.map((l: { status: string }) => l.status).sort();
      expect(statuses).toEqual(['active', 'expired', 'revoked']);
    });

    it('returns 404 for an unknown product', async () => {
      const res = await app.inject({ method: 'GET', url: `/products/${ZERO_UUID}/licenses` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });
  });

  describe('GET /products/:id/users', () => {
    it('returns { data: [] } when the product has no Active licenses', async () => {
      const productId = await createProduct(app, 'NoOne');
      const res = await app.inject({ method: 'GET', url: `/products/${productId}/users` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [] });
    });

    it('returns only users with an Active license (right-now view)', async () => {
      const productId = await createProduct(app, 'P');
      const activeUserId = await createUser(app, 'act@x.com');
      const revokedUserId = await createUser(app, 'rev@x.com');
      const expiredUserId = await createUser(app, 'exp@x.com');

      await db.insert(licenses).values([
        {
          userId: activeUserId,
          productId,
          status: 'active',
          expiresAt: new Date(Date.now() + DAY_MS),
        },
        {
          userId: revokedUserId,
          productId,
          status: 'revoked',
          expiresAt: new Date(Date.now() + DAY_MS),
        },
        {
          userId: expiredUserId,
          productId,
          status: 'expired',
          expiresAt: new Date(Date.now() - DAY_MS),
        },
      ]);

      const res = await app.inject({ method: 'GET', url: `/products/${productId}/users` });
      expect(res.statusCode).toBe(200);
      const emails = res.json().data.map((u: { email: string }) => u.email);
      expect(emails).toEqual(['act@x.com']);
    });

    it('returns 404 for an unknown product', async () => {
      const res = await app.inject({ method: 'GET', url: `/products/${ZERO_UUID}/users` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });
  });

  describe('HTTP-level cascade behaviour', () => {
    it('deleting a user via HTTP removes their licenses (visible via GET /licenses)', async () => {
      const userId = await createUser(app, 'cas-u@x.com');
      const productId = await createProduct(app, 'CasProd');
      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: {
          user_id: userId,
          product_id: productId,
          expires_at: new Date(Date.now() + DAY_MS).toISOString(),
        },
      });

      await app.inject({ method: 'DELETE', url: `/users/${userId}` });

      const list = await app.inject({ method: 'GET', url: '/licenses' });
      expect(list.json().data).toHaveLength(0);
    });

    it('deleting a product via HTTP removes its licenses (visible via GET /licenses)', async () => {
      const userId = await createUser(app, 'cas-p@x.com');
      const productId = await createProduct(app, 'GoneSoon');
      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: {
          user_id: userId,
          product_id: productId,
          expires_at: new Date(Date.now() + DAY_MS).toISOString(),
        },
      });

      await app.inject({ method: 'DELETE', url: `/products/${productId}` });

      const list = await app.inject({ method: 'GET', url: '/licenses' });
      expect(list.json().data).toHaveLength(0);
    });
  });
});
