import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import type { Redis } from 'ioredis';
import { buildTestApp, truncateAll } from '../helpers/app.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

describe('Users routes', () => {
  let app: FastifyInstance;
  let client: Sql;
  let redis: Redis;

  beforeAll(async () => {
    ({ app, client, redis } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await client.end();
  });

  afterEach(async () => {
    await truncateAll(client);
  });

  describe('POST /users', () => {
    it('creates a user and returns 201 with a bare object', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/users',
        payload: { email: 'alice@example.com' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.email).toBe('alice@example.com');
      expect(body.id).toMatch(UUID_RE);
      expect(Object.keys(body).sort()).toEqual(['email', 'id']);
    });

    it('normalizes mixed-case and surrounding whitespace', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/users',
        payload: { email: '  Alice@EXAMPLE.com  ' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().email).toBe('alice@example.com');
    });

    it('returns 409 duplicate_email for repeat email', async () => {
      await app.inject({ method: 'POST', url: '/users', payload: { email: 'b@x.com' } });
      const res = await app.inject({
        method: 'POST',
        url: '/users',
        payload: { email: 'b@x.com' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'duplicate_email' });
    });

    it('treats different casings of the same email as duplicates', async () => {
      await app.inject({ method: 'POST', url: '/users', payload: { email: 'Foo@x.com' } });
      const res = await app.inject({
        method: 'POST',
        url: '/users',
        payload: { email: 'foo@x.com' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('duplicate_email');
    });

    it('returns 400 validation_error for malformed email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/users',
        payload: { email: 'not-an-email' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('validation_error');
      expect(body.message).toBe('Request validation failed');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
      expect(body.details[0].path).toContain('email');
    });

    it('returns 400 validation_error for missing email', async () => {
      const res = await app.inject({ method: 'POST', url: '/users', payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });
  });

  describe('GET /users/:id', () => {
    it('returns the user as a bare object', async () => {
      const created = (
        await app.inject({ method: 'POST', url: '/users', payload: { email: 'c@x.com' } })
      ).json();
      const res = await app.inject({ method: 'GET', url: `/users/${created.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: created.id, email: 'c@x.com' });
    });

    it('returns 404 not_found for an unknown id', async () => {
      const res = await app.inject({ method: 'GET', url: `/users/${ZERO_UUID}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('returns 400 validation_error for a non-UUID id', async () => {
      const res = await app.inject({ method: 'GET', url: '/users/not-a-uuid' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });
  });

  describe('GET /users', () => {
    it('returns { data: [] } when no users exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/users' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [] });
    });

    it('returns all users wrapped in { data: [...] }', async () => {
      await app.inject({ method: 'POST', url: '/users', payload: { email: 'd@x.com' } });
      await app.inject({ method: 'POST', url: '/users', payload: { email: 'e@x.com' } });
      const res = await app.inject({ method: 'GET', url: '/users' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      const emails = body.data.map((u: { email: string }) => u.email).sort();
      expect(emails).toEqual(['d@x.com', 'e@x.com']);
    });
  });

  describe('GET /users/by-email', () => {
    it('returns { user: {...} } when an exact match exists', async () => {
      const created = (
        await app.inject({
          method: 'POST',
          url: '/users',
          payload: { email: 'lookup@x.com' },
        })
      ).json();

      const res = await app.inject({ method: 'GET', url: '/users/by-email?email=lookup@x.com' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: { id: created.id, email: 'lookup@x.com' } });
    });

    it('returns { user: null } and 200 (not 404) when no user matches', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/users/by-email?email=ghost@x.com',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null });
    });

    it('matches case-insensitively (email is normalised on both write and read)', async () => {
      await app.inject({
        method: 'POST',
        url: '/users',
        payload: { email: 'MixedCase@X.COM' },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/users/by-email?email=mixedcase@x.com',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.email).toBe('mixedcase@x.com');
    });

    it('returns 400 validation_error when the email query param is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/users/by-email' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });

    it('returns 400 validation_error when the email query param is malformed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/users/by-email?email=not-an-email',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });
  });

  describe('DELETE /users/:id', () => {
    it('returns 204 and removes the user', async () => {
      const created = (
        await app.inject({ method: 'POST', url: '/users', payload: { email: 'f@x.com' } })
      ).json();

      const delRes = await app.inject({ method: 'DELETE', url: `/users/${created.id}` });
      expect(delRes.statusCode).toBe(204);
      expect(delRes.body).toBe('');

      const getRes = await app.inject({ method: 'GET', url: `/users/${created.id}` });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 not_found when deleting an unknown id', async () => {
      const res = await app.inject({ method: 'DELETE', url: `/users/${ZERO_UUID}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('returns 400 validation_error for a non-UUID id', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/users/not-a-uuid' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    });
  });
});
