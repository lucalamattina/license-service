import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { and, eq } from 'drizzle-orm';
import { buildTestApp, truncateAll } from '../helpers/app.js';
import { licenses } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY_ITERATIONS = 30;

function futureIso(daysAhead: number): string {
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

describe('Duplicate-license policy', () => {
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

  describe('replacement (new expires_at strictly later)', () => {
    it('revokes the old license and issues a new Active one', async () => {
      const userId = await createUser(app, 'r1@x.com');
      const productId = await createProduct(app, 'R1');

      const first = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso(10) },
        })
      ).json();

      const second = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(100) },
      });
      expect(second.statusCode).toBe(201);
      const secondBody = second.json();
      expect(secondBody.status).toBe('active');
      expect(secondBody.id).not.toBe(first.id);

      // The old license is now Revoked with state_changed_at bumped.
      const oldRow = await db
        .select()
        .from(licenses)
        .where(eq(licenses.id, first.id))
        .then((r) => r[0]);
      expect(oldRow!.status).toBe('revoked');
      expect(oldRow!.stateChangedAt.getTime()).toBeGreaterThanOrEqual(
        oldRow!.createdAt.getTime(),
      );

      // Exactly one Active license for this (user, product).
      const activeRows = await db
        .select()
        .from(licenses)
        .where(
          and(
            eq(licenses.userId, userId),
            eq(licenses.productId, productId),
            eq(licenses.status, 'active'),
          ),
        );
      expect(activeRows).toHaveLength(1);
      expect(activeRows[0]!.id).toBe(secondBody.id);
    });

    it('exposes both old and new via GET /users/:id/licenses (historical view)', async () => {
      const userId = await createUser(app, 'r2@x.com');
      const productId = await createProduct(app, 'R2');

      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(10) },
      });
      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(100) },
      });

      const res = await app.inject({ method: 'GET', url: `/users/${userId}/licenses` });
      const statuses = res.json().data.map((l: { status: string }) => l.status).sort();
      expect(statuses).toEqual(['active', 'revoked']);
    });
  });

  describe('rejection (new expires_at <= existing)', () => {
    it('rejects strictly earlier expires_at with informative 409', async () => {
      const userId = await createUser(app, 'rej1@x.com');
      const productId = await createProduct(app, 'REJ1');

      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(100) },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(10) },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error).toBe('duplicate_active_license');
      expect(body.message).toMatch(/equal or later expiration/);
      // Message describes the conflict, not just the status text.
      expect(body.message.length).toBeGreaterThan(20);
    });

    it('rejects equal expires_at with 409', async () => {
      const userId = await createUser(app, 'rej2@x.com');
      const productId = await createProduct(app, 'REJ2');
      const sameExpiry = futureIso(30);

      const first = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: sameExpiry },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: sameExpiry },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe('duplicate_active_license');
    });

    it('leaves the existing Active license unchanged on rejection', async () => {
      const userId = await createUser(app, 'rej3@x.com');
      const productId = await createProduct(app, 'REJ3');

      const first = (
        await app.inject({
          method: 'POST',
          url: '/licenses',
          payload: { user_id: userId, product_id: productId, expires_at: futureIso(100) },
        })
      ).json();

      const beforeRow = await db
        .select()
        .from(licenses)
        .where(eq(licenses.id, first.id))
        .then((r) => r[0]);

      await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(10) },
      });

      const afterRow = await db
        .select()
        .from(licenses)
        .where(eq(licenses.id, first.id))
        .then((r) => r[0]);
      expect(afterRow!.status).toBe('active');
      expect(afterRow!.stateChangedAt.getTime()).toBe(beforeRow!.stateChangedAt.getTime());
    });
  });

  describe('Revoked / Expired existing license does not block', () => {
    it('issues a new license over a Revoked one for the same (user, product)', async () => {
      const userId = await createUser(app, 'rv@x.com');
      const productId = await createProduct(app, 'RV');

      await db.insert(licenses).values({
        userId,
        productId,
        status: 'revoked',
        expiresAt: new Date(Date.now() + 1000 * DAY_MS),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(10) },
      });
      expect(res.statusCode).toBe(201);
    });

    it('issues a new license over an Expired one for the same (user, product)', async () => {
      const userId = await createUser(app, 'ex@x.com');
      const productId = await createProduct(app, 'EX');

      await db.insert(licenses).values({
        userId,
        productId,
        status: 'expired',
        expiresAt: new Date(Date.now() - DAY_MS),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/licenses',
        payload: { user_id: userId, product_id: productId, expires_at: futureIso(10) },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe(`concurrency (${CONCURRENCY_ITERATIONS} iterations each)`, () => {
    it('two simultaneous issuances with no existing license: exactly one 201, one 409', async () => {
      for (let i = 0; i < CONCURRENCY_ITERATIONS; i++) {
        await truncateAll(client);
        const userId = await createUser(app, `con1-${i}@x.com`);
        const productId = await createProduct(app, `CON1-${i}`);
        const payload = {
          user_id: userId,
          product_id: productId,
          expires_at: futureIso(30),
        };

        const [a, b] = await Promise.all([
          app.inject({ method: 'POST', url: '/licenses', payload }),
          app.inject({ method: 'POST', url: '/licenses', payload }),
        ]);

        const statuses = [a.statusCode, b.statusCode].sort();
        expect(statuses).toEqual([201, 409]);

        const loser = a.statusCode === 409 ? a : b;
        expect(loser.json().error).toBe('duplicate_active_license');

        const activeRows = await db
          .select()
          .from(licenses)
          .where(
            and(
              eq(licenses.userId, userId),
              eq(licenses.productId, productId),
              eq(licenses.status, 'active'),
            ),
          );
        expect(activeRows).toHaveLength(1);
      }
    });

    it('two simultaneous issuances with an existing Active baseline: still exactly one wins', async () => {
      for (let i = 0; i < CONCURRENCY_ITERATIONS; i++) {
        await truncateAll(client);
        const userId = await createUser(app, `con2-${i}@x.com`);
        const productId = await createProduct(app, `CON2-${i}`);
        await db.insert(licenses).values({
          userId,
          productId,
          status: 'active',
          expiresAt: new Date(Date.now() + DAY_MS),
        });

        // Both requests have strictly later expires_at than the baseline.
        const payload = {
          user_id: userId,
          product_id: productId,
          expires_at: futureIso(100),
        };

        const [a, b] = await Promise.all([
          app.inject({ method: 'POST', url: '/licenses', payload }),
          app.inject({ method: 'POST', url: '/licenses', payload }),
        ]);

        const statuses = [a.statusCode, b.statusCode].sort();
        expect(statuses).toEqual([201, 409]);

        const activeRows = await db
          .select()
          .from(licenses)
          .where(
            and(
              eq(licenses.userId, userId),
              eq(licenses.productId, productId),
              eq(licenses.status, 'active'),
            ),
          );
        expect(activeRows).toHaveLength(1);

        // The baseline is now revoked.
        const revokedRows = await db
          .select()
          .from(licenses)
          .where(
            and(
              eq(licenses.userId, userId),
              eq(licenses.productId, productId),
              eq(licenses.status, 'revoked'),
            ),
          );
        expect(revokedRows.length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
