import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { buildTestApp, truncateAll } from '../helpers/app.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

describe('Products routes', () => {
  let app: FastifyInstance;
  let client: Sql;

  beforeAll(async () => {
    ({ app, client } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  afterEach(async () => {
    await truncateAll(client);
  });

  describe('POST /products', () => {
    it('creates a product and returns 201 with a bare object', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/products',
        payload: { name: 'Pro Plan' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe('Pro Plan');
      expect(body.id).toMatch(UUID_RE);
      expect(Object.keys(body).sort()).toEqual(['id', 'name']);
    });

    it('allows two products with the same name (no uniqueness)', async () => {
      const a = await app.inject({
        method: 'POST',
        url: '/products',
        payload: { name: 'Pro Plan' },
      });
      const b = await app.inject({
        method: 'POST',
        url: '/products',
        payload: { name: 'Pro Plan' },
      });
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      expect(a.json().id).not.toBe(b.json().id);
    });

    it('returns 400 validation_error for empty name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/products',
        payload: { name: '' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('validation_error');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details[0].path).toContain('name');
    });

    it('returns 400 validation_error for missing name', async () => {
      const res = await app.inject({ method: 'POST', url: '/products', payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });

    it('returns 400 validation_error for non-string name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/products',
        payload: { name: 42 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });
  });

  describe('GET /products/:id', () => {
    it('returns the product as a bare object', async () => {
      const created = (
        await app.inject({ method: 'POST', url: '/products', payload: { name: 'A' } })
      ).json();
      const res = await app.inject({ method: 'GET', url: `/products/${created.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: created.id, name: 'A' });
    });

    it('returns 404 not_found for an unknown id', async () => {
      const res = await app.inject({ method: 'GET', url: `/products/${ZERO_UUID}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('returns 400 validation_error for a non-UUID id', async () => {
      const res = await app.inject({ method: 'GET', url: '/products/not-a-uuid' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });
  });

  describe('GET /products', () => {
    it('returns { data: [] } when no products exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/products' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [] });
    });

    it('returns all products wrapped in { data: [...] }', async () => {
      await app.inject({ method: 'POST', url: '/products', payload: { name: 'A' } });
      await app.inject({ method: 'POST', url: '/products', payload: { name: 'B' } });
      const res = await app.inject({ method: 'GET', url: '/products' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      const names = body.data.map((p: { name: string }) => p.name).sort();
      expect(names).toEqual(['A', 'B']);
    });
  });

  describe('DELETE /products/:id', () => {
    it('returns 204 and removes the product', async () => {
      const created = (
        await app.inject({ method: 'POST', url: '/products', payload: { name: 'X' } })
      ).json();

      const delRes = await app.inject({ method: 'DELETE', url: `/products/${created.id}` });
      expect(delRes.statusCode).toBe(204);
      expect(delRes.body).toBe('');

      const getRes = await app.inject({ method: 'GET', url: `/products/${created.id}` });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 not_found when deleting an unknown id', async () => {
      const res = await app.inject({ method: 'DELETE', url: `/products/${ZERO_UUID}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('returns 400 validation_error for a non-UUID id', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/products/not-a-uuid' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });
  });
});
