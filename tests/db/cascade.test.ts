import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { setupTestDatabase, truncateAll } from '../helpers/db.js';
import { licenses, products, users } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Cascade delete on user/product removal', () => {
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

  it('removes a user’s licenses when the user is deleted', async () => {
    const [user] = await db.insert(users).values({ email: 'cascade-user@test.com' }).returning();
    const [product] = await db.insert(products).values({ name: 'cu' }).returning();
    await db.insert(licenses).values({
      status: 'active',
      expiresAt: new Date(Date.now() + DAY_MS),
      userId: user!.id,
      productId: product!.id,
    });

    await db.delete(users).where(eq(users.id, user!.id));

    const remaining = await db.select().from(licenses);
    expect(remaining).toHaveLength(0);
  });

  it('removes a product’s licenses when the product is deleted', async () => {
    const [user] = await db.insert(users).values({ email: 'cascade-prod@test.com' }).returning();
    const [product] = await db.insert(products).values({ name: 'cp' }).returning();
    await db.insert(licenses).values({
      status: 'active',
      expiresAt: new Date(Date.now() + DAY_MS),
      userId: user!.id,
      productId: product!.id,
    });

    await db.delete(products).where(eq(products.id, product!.id));

    const remaining = await db.select().from(licenses);
    expect(remaining).toHaveLength(0);
  });

  it('cascade also removes Revoked and Expired licenses', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'cascade-many@test.com' })
      .returning();
    const [product] = await db.insert(products).values({ name: 'cm' }).returning();
    await db.insert(licenses).values([
      {
        status: 'revoked',
        expiresAt: new Date(Date.now() + DAY_MS),
        userId: user!.id,
        productId: product!.id,
      },
      {
        status: 'expired',
        expiresAt: new Date(Date.now() - DAY_MS),
        userId: user!.id,
        productId: product!.id,
      },
      {
        status: 'active',
        expiresAt: new Date(Date.now() + 2 * DAY_MS),
        userId: user!.id,
        productId: product!.id,
      },
    ]);

    await db.delete(users).where(eq(users.id, user!.id));

    const remaining = await db.select().from(licenses);
    expect(remaining).toHaveLength(0);
  });
});
