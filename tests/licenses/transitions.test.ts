import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import type { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { buildTestApp, truncateAll } from '../helpers/app.js';
import { licenses } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const DAY_MS = 24 * 60 * 60 * 1000;

function futureIso(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * DAY_MS).toISOString();
}

async function createUser(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/users', payload: { email } });
  return res.json().id as string;
}

async function createProduct(app: FastifyInstance, name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/products', payload: { name } });
  return res.json().id as string;
}

async function issueActive(
  app: FastifyInstance,
  userId: string,
  productId: string,
  expiresIn = futureIso(),
): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/licenses',
    payload: { user_id: userId, product_id: productId, expires_at: expiresIn },
  });
  return res.json();
}

describe('POST /licenses/:id/revoke', () => {
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

  afterEach(async () => {
    await truncateAll(client);
  });

  it('revokes an Active license and bumps state_changed_at', async () => {
    const userId = await createUser(app, 'rev@x.com');
    const productId = await createProduct(app, 'RevProd');
    const created = await issueActive(app, userId, productId);

    const [beforeRow] = await db.select().from(licenses).where(eq(licenses.id, created.id));

    const res = await app.inject({ method: 'POST', url: `/licenses/${created.id}/revoke` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('revoked');

    const [afterRow] = await db.select().from(licenses).where(eq(licenses.id, created.id));
    expect(afterRow!.status).toBe('revoked');
    expect(afterRow!.stateChangedAt.getTime()).toBeGreaterThanOrEqual(
      beforeRow!.stateChangedAt.getTime(),
    );
    // state_changed_at must not be exposed in the API response
    expect(res.json()).not.toHaveProperty('state_changed_at');
    expect(res.json()).not.toHaveProperty('stateChangedAt');
  });

  it('returns 409 license_not_active for an already-Revoked license', async () => {
    const userId = await createUser(app, 'rr@x.com');
    const productId = await createProduct(app, 'RR');
    const created = await issueActive(app, userId, productId);

    await app.inject({ method: 'POST', url: `/licenses/${created.id}/revoke` });

    const res = await app.inject({ method: 'POST', url: `/licenses/${created.id}/revoke` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('license_not_active');
  });

  it('returns 409 license_not_active for an Expired license', async () => {
    const userId = await createUser(app, 're@x.com');
    const productId = await createProduct(app, 'RE');
    const [direct] = await db
      .insert(licenses)
      .values({
        userId,
        productId,
        status: 'expired',
        expiresAt: new Date(Date.now() - DAY_MS),
      })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/licenses/${direct!.id}/revoke` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('license_not_active');
  });

  it('returns 404 not_found for an unknown license id', async () => {
    const res = await app.inject({ method: 'POST', url: `/licenses/${ZERO_UUID}/revoke` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('returns 400 validation_error for a non-UUID id', async () => {
    const res = await app.inject({ method: 'POST', url: '/licenses/not-a-uuid/revoke' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('after revoke, the product drops from GET /users/:id/products', async () => {
    const userId = await createUser(app, 'drop@x.com');
    const productId = await createProduct(app, 'DropMe');
    const created = await issueActive(app, userId, productId);

    const beforeRevoke = await app.inject({ method: 'GET', url: `/users/${userId}/products` });
    expect(beforeRevoke.json().data).toHaveLength(1);

    await app.inject({ method: 'POST', url: `/licenses/${created.id}/revoke` });

    const afterRevoke = await app.inject({ method: 'GET', url: `/users/${userId}/products` });
    expect(afterRevoke.json().data).toEqual([]);
  });
});

describe('POST /licenses/:id/validate', () => {
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

  afterEach(async () => {
    await truncateAll(client);
  });

  it('returns valid:true for an Active, not-yet-expired license without mutating state', async () => {
    const userId = await createUser(app, 'v1@x.com');
    const productId = await createProduct(app, 'V1');
    const created = await issueActive(app, userId, productId);

    const [beforeRow] = await db.select().from(licenses).where(eq(licenses.id, created.id));

    const res = await app.inject({ method: 'POST', url: `/licenses/${created.id}/validate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.license.status).toBe('active');

    const [afterRow] = await db.select().from(licenses).where(eq(licenses.id, created.id));
    expect(afterRow!.status).toBe('active');
    expect(afterRow!.stateChangedAt.getTime()).toBe(beforeRow!.stateChangedAt.getTime());
  });

  it('expires an Active license whose expires_at has passed (in-transaction transition)', async () => {
    const userId = await createUser(app, 'v2@x.com');
    const productId = await createProduct(app, 'V2');
    // Insert directly so we can set expires_at in the past while keeping status Active.
    const [stale] = await db
      .insert(licenses)
      .values({
        userId,
        productId,
        status: 'active',
        expiresAt: new Date(Date.now() - DAY_MS),
      })
      .returning();

    const [beforeRow] = await db.select().from(licenses).where(eq(licenses.id, stale!.id));

    const res = await app.inject({ method: 'POST', url: `/licenses/${stale!.id}/validate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.license.status).toBe('expired');

    const [afterRow] = await db.select().from(licenses).where(eq(licenses.id, stale!.id));
    expect(afterRow!.status).toBe('expired');
    expect(afterRow!.stateChangedAt.getTime()).toBeGreaterThanOrEqual(
      beforeRow!.stateChangedAt.getTime(),
    );
  });

  it('returns valid:false for an already-Revoked license without mutating it', async () => {
    const userId = await createUser(app, 'v3@x.com');
    const productId = await createProduct(app, 'V3');
    const created = await issueActive(app, userId, productId);
    await app.inject({ method: 'POST', url: `/licenses/${created.id}/revoke` });

    const [beforeRow] = await db.select().from(licenses).where(eq(licenses.id, created.id));

    const res = await app.inject({ method: 'POST', url: `/licenses/${created.id}/validate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.license.status).toBe('revoked');

    const [afterRow] = await db.select().from(licenses).where(eq(licenses.id, created.id));
    expect(afterRow!.stateChangedAt.getTime()).toBe(beforeRow!.stateChangedAt.getTime());
  });

  it('returns valid:false for an already-Expired license without mutating it', async () => {
    const userId = await createUser(app, 'v4@x.com');
    const productId = await createProduct(app, 'V4');
    const [direct] = await db
      .insert(licenses)
      .values({
        userId,
        productId,
        status: 'expired',
        expiresAt: new Date(Date.now() - DAY_MS),
      })
      .returning();

    const [beforeRow] = await db.select().from(licenses).where(eq(licenses.id, direct!.id));

    const res = await app.inject({ method: 'POST', url: `/licenses/${direct!.id}/validate` });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().license.status).toBe('expired');

    const [afterRow] = await db.select().from(licenses).where(eq(licenses.id, direct!.id));
    expect(afterRow!.stateChangedAt.getTime()).toBe(beforeRow!.stateChangedAt.getTime());
  });

  it('returns 404 not_found for an unknown license id', async () => {
    const res = await app.inject({ method: 'POST', url: `/licenses/${ZERO_UUID}/validate` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('returns 400 validation_error for a non-UUID id', async () => {
    const res = await app.inject({ method: 'POST', url: '/licenses/not-a-uuid/validate' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('validate response shape is { valid, license: {...} } and does not leak state_changed_at', async () => {
    const userId = await createUser(app, 'v5@x.com');
    const productId = await createProduct(app, 'V5');
    const created = await issueActive(app, userId, productId);

    const res = await app.inject({ method: 'POST', url: `/licenses/${created.id}/validate` });
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['license', 'valid']);
    expect(Object.keys(body.license).sort()).toEqual([
      'created_at',
      'expires_at',
      'id',
      'product_id',
      'status',
      'user_id',
    ]);
  });
});
