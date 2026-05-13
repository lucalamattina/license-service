import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { setupTestDatabase, truncateAll } from '../helpers/db.js';
import { runExpireLicensesJob } from '../../src/queue/jobs/expire-licenses.js';
import { validateLicense } from '../../src/services/licenses.js';
import { licenses, products, users } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedUserAndProduct(
  db: Database,
  email: string,
  name: string,
): Promise<{ userId: string; productId: string }> {
  const [u] = await db.insert(users).values({ email }).returning();
  const [p] = await db.insert(products).values({ name }).returning();
  return { userId: u!.id, productId: p!.id };
}

describe('runExpireLicensesJob', () => {
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

  it('flips Active-but-past-expiry licenses to Expired and bumps state_changed_at', async () => {
    const { userId, productId } = await seedUserAndProduct(db, 'x1@x.com', 'X1');
    const [stale] = await db
      .insert(licenses)
      .values({
        userId,
        productId,
        status: 'active',
        expiresAt: new Date(Date.now() - DAY_MS),
      })
      .returning();

    const result = await runExpireLicensesJob(db);
    expect(result.expired).toBe(1);

    const [after] = await db.select().from(licenses).where(eq(licenses.id, stale!.id));
    expect(after!.status).toBe('expired');
    expect(after!.stateChangedAt.getTime()).toBeGreaterThanOrEqual(
      stale!.stateChangedAt.getTime(),
    );
  });

  it('leaves Active-but-future-expiry licenses alone', async () => {
    const { userId, productId } = await seedUserAndProduct(db, 'x2@x.com', 'X2');
    const [fresh] = await db
      .insert(licenses)
      .values({
        userId,
        productId,
        status: 'active',
        expiresAt: new Date(Date.now() + DAY_MS),
      })
      .returning();

    const result = await runExpireLicensesJob(db);
    expect(result.expired).toBe(0);

    const [after] = await db.select().from(licenses).where(eq(licenses.id, fresh!.id));
    expect(after!.status).toBe('active');
    expect(after!.stateChangedAt.getTime()).toBe(fresh!.stateChangedAt.getTime());
  });

  it('does not touch Revoked licenses (even if their expires_at is in the past)', async () => {
    const { userId, productId } = await seedUserAndProduct(db, 'x3@x.com', 'X3');
    const [rev] = await db
      .insert(licenses)
      .values({
        userId,
        productId,
        status: 'revoked',
        expiresAt: new Date(Date.now() - DAY_MS),
      })
      .returning();

    const result = await runExpireLicensesJob(db);
    expect(result.expired).toBe(0);

    const [after] = await db.select().from(licenses).where(eq(licenses.id, rev!.id));
    expect(after!.status).toBe('revoked');
    expect(after!.stateChangedAt.getTime()).toBe(rev!.stateChangedAt.getTime());
  });

  it('does not touch already-Expired licenses', async () => {
    const { userId, productId } = await seedUserAndProduct(db, 'x4@x.com', 'X4');
    const [exp] = await db
      .insert(licenses)
      .values({
        userId,
        productId,
        status: 'expired',
        expiresAt: new Date(Date.now() - DAY_MS),
      })
      .returning();

    const result = await runExpireLicensesJob(db);
    expect(result.expired).toBe(0);

    const [after] = await db.select().from(licenses).where(eq(licenses.id, exp!.id));
    expect(after!.stateChangedAt.getTime()).toBe(exp!.stateChangedAt.getTime());
  });

  it('is idempotent: a second run with no new work expires nothing', async () => {
    const { userId, productId } = await seedUserAndProduct(db, 'x5@x.com', 'X5');
    await db.insert(licenses).values({
      userId,
      productId,
      status: 'active',
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    expect((await runExpireLicensesJob(db)).expired).toBe(1);
    expect((await runExpireLicensesJob(db)).expired).toBe(0);
  });

  it('handles a mixed batch: only stale Active rows transition', async () => {
    const { userId, productId } = await seedUserAndProduct(db, 'x6@x.com', 'X6');
    const otherProduct = await db.insert(products).values({ name: 'O' }).returning();
    const otherUser = await db.insert(users).values({ email: 'o@x.com' }).returning();

    // Should transition
    await db.insert(licenses).values({
      userId,
      productId,
      status: 'active',
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    // Should NOT (future)
    await db.insert(licenses).values({
      userId,
      productId: otherProduct[0]!.id,
      status: 'active',
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    // Should NOT (revoked)
    await db.insert(licenses).values({
      userId: otherUser[0]!.id,
      productId,
      status: 'revoked',
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const result = await runExpireLicensesJob(db);
    expect(result.expired).toBe(1);
  });

  it('race with validate: row consistently ends Expired with no double-update', async () => {
    // 30 iterations to flush flakiness. Postgres row locks + the status='active'
    // guard guarantee exactly one writer's UPDATE matches — the other sees 0
    // rows and observes the winner's state. We can't directly observe the
    // rowcount from outside the validate call, so we assert the invariants that
    // actually matter: final state is Expired, exactly one row exists, scan's
    // rowcount is 0 or 1 (never 2), validate sees the final state.
    for (let i = 0; i < 30; i++) {
      await truncateAll(client);
      const { userId, productId } = await seedUserAndProduct(db, `race-${i}@x.com`, `R-${i}`);
      const [stale] = await db
        .insert(licenses)
        .values({
          userId,
          productId,
          status: 'active',
          expiresAt: new Date(Date.now() - DAY_MS),
        })
        .returning();

      const [scanResult, validateResult] = await Promise.all([
        runExpireLicensesJob(db),
        validateLicense(db, stale!.id),
      ]);

      expect(scanResult.expired).toBeGreaterThanOrEqual(0);
      expect(scanResult.expired).toBeLessThanOrEqual(1);
      expect(validateResult.license.status).toBe('expired');
      expect(validateResult.valid).toBe(false);

      const rows = await db.select().from(licenses).where(eq(licenses.id, stale!.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('expired');
    }
  });
});
