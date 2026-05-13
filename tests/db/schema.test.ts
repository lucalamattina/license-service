import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import { setupTestDatabase, truncateAll } from '../helpers/db.js';
import { licenses, products, users } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('License schema partial unique index', () => {
  let db: Database;
  let client: Sql;

  beforeAll(async () => {
    ({ db, client } = await setupTestDatabase());
  });

  afterAll(async () => {
    await client.end();
  });

  afterEach(async () => {
    await truncateAll(client);
  });

  it('rejects a second Active license for the same (user, product)', async () => {
    const [user] = await db.insert(users).values({ email: 'a@test.com' }).returning();
    const [product] = await db.insert(products).values({ name: 'p1' }).returning();

    await db.insert(licenses).values({
      status: 'active',
      expiresAt: new Date(Date.now() + DAY_MS),
      userId: user!.id,
      productId: product!.id,
    });

    await expect(
      db.insert(licenses).values({
        status: 'active',
        expiresAt: new Date(Date.now() + 2 * DAY_MS),
        userId: user!.id,
        productId: product!.id,
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('allows one Active and one Revoked license for the same (user, product)', async () => {
    const [user] = await db.insert(users).values({ email: 'b@test.com' }).returning();
    const [product] = await db.insert(products).values({ name: 'p2' }).returning();

    await db.insert(licenses).values({
      status: 'revoked',
      expiresAt: new Date(Date.now() + DAY_MS),
      userId: user!.id,
      productId: product!.id,
    });

    await expect(
      db.insert(licenses).values({
        status: 'active',
        expiresAt: new Date(Date.now() + 2 * DAY_MS),
        userId: user!.id,
        productId: product!.id,
      }),
    ).resolves.not.toThrow();
  });

  it('allows one Active and one Expired license for the same (user, product)', async () => {
    const [user] = await db.insert(users).values({ email: 'c@test.com' }).returning();
    const [product] = await db.insert(products).values({ name: 'p3' }).returning();

    await db.insert(licenses).values({
      status: 'expired',
      expiresAt: new Date(Date.now() - DAY_MS),
      userId: user!.id,
      productId: product!.id,
    });

    await expect(
      db.insert(licenses).values({
        status: 'active',
        expiresAt: new Date(Date.now() + DAY_MS),
        userId: user!.id,
        productId: product!.id,
      }),
    ).resolves.not.toThrow();
  });

  it('defaults created_at and state_changed_at to now() at insertion', async () => {
    const [user] = await db.insert(users).values({ email: 'd@test.com' }).returning();
    const [product] = await db.insert(products).values({ name: 'p4' }).returning();

    const before = new Date();
    const [license] = await db
      .insert(licenses)
      .values({
        status: 'active',
        expiresAt: new Date(Date.now() + DAY_MS),
        userId: user!.id,
        productId: product!.id,
      })
      .returning();
    const after = new Date();

    expect(license!.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
    expect(license!.createdAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1);
    expect(license!.stateChangedAt.getTime()).toBe(license!.createdAt.getTime());
  });
});
