import { and, eq } from 'drizzle-orm';
import { licenses, products, users } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { ApiError } from '../lib/errors.js';
import { shouldExpire } from '../domain/license-state.js';
import type { Product } from './products.js';
import type { User } from './users.js';

export type License = typeof licenses.$inferSelect;
export type LicenseStatus = License['status'];

export interface LicenseResponse {
  id: string;
  status: LicenseStatus;
  created_at: string;
  expires_at: string;
  user_id: string;
  product_id: string;
}

export function serializeLicense(license: License): LicenseResponse {
  return {
    id: license.id,
    status: license.status,
    created_at: license.createdAt.toISOString(),
    expires_at: license.expiresAt.toISOString(),
    user_id: license.userId,
    product_id: license.productId,
  };
}

const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';

function getPgErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'cause' in err) {
    const cause = (err as { cause: unknown }).cause;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      return (cause as { code?: string }).code;
    }
  }
  return undefined;
}

export interface IssueLicenseInput {
  userId: string;
  productId: string;
  expiresAt: Date;
}

export async function issueLicense(db: Database, input: IssueLicenseInput): Promise<License> {
  if (input.expiresAt.getTime() <= Date.now()) {
    throw ApiError.expiresAtInPast(
      `expires_at must be strictly in the future; got ${input.expiresAt.toISOString()}`,
    );
  }

  // The full algorithm and its correctness argument live in
  // docs/algorithms/license-issuance.md. Keep this code in sync with that document.
  try {
    return await db.transaction(async (tx) => {
      // Step 1: lock the existing Active license for this (user, product), if any.
      // FOR UPDATE serializes concurrent issuance when a row exists; when no row
      // matches, race-safety falls to the partial unique index in step 4.
      const [existing] = await tx
        .select({ id: licenses.id, expiresAt: licenses.expiresAt })
        .from(licenses)
        .where(
          and(
            eq(licenses.userId, input.userId),
            eq(licenses.productId, input.productId),
            eq(licenses.status, 'active'),
          ),
        )
        .for('update');

      // Step 2: decide.
      if (existing) {
        if (input.expiresAt.getTime() <= existing.expiresAt.getTime()) {
          throw ApiError.duplicateActiveLicense(
            `User already has an active license for this product with equal or later expiration (existing expires at ${existing.expiresAt.toISOString()})`,
          );
        }
        // Step 3: revoke the existing license. The WHERE status='active' is
        // defensive; the FOR UPDATE lock guarantees the row is still Active.
        await tx
          .update(licenses)
          .set({ status: 'revoked', stateChangedAt: new Date() })
          .where(and(eq(licenses.id, existing.id), eq(licenses.status, 'active')));
      }

      // Step 4: insert the new license. The partial unique index serializes any
      // concurrent insert that slipped past step 1's FOR UPDATE (because no row
      // matched then, but a concurrent transaction has since committed one).
      const [inserted] = await tx
        .insert(licenses)
        .values({
          userId: input.userId,
          productId: input.productId,
          expiresAt: input.expiresAt,
          status: 'active',
        })
        .returning();
      return inserted!;
    });
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    const code = getPgErrorCode(err);
    if (code === PG_UNIQUE_VIOLATION) {
      // The partial unique index tripped: a concurrent transaction won the race
      // and the user now has an active license. No internal retry.
      throw ApiError.duplicateActiveLicense(
        'Concurrent issuance won the race; the user now has an active license for this product',
      );
    }
    if (code === PG_FK_VIOLATION) {
      throw ApiError.notFound('Referenced user or product does not exist');
    }
    throw err;
  }
}

export async function getLicenseById(db: Database, id: string): Promise<License> {
  const [license] = await db.select().from(licenses).where(eq(licenses.id, id));
  if (!license) {
    throw ApiError.notFound(`License ${id} not found`);
  }
  return license;
}

export async function listLicenses(db: Database): Promise<License[]> {
  return db.select().from(licenses);
}

export async function getLicenseProduct(db: Database, licenseId: string): Promise<Product> {
  const license = await getLicenseById(db, licenseId);
  const [product] = await db.select().from(products).where(eq(products.id, license.productId));
  // FK constraint guarantees this exists for any license we just read.
  return product!;
}

export async function getLicenseUser(db: Database, licenseId: string): Promise<User> {
  const license = await getLicenseById(db, licenseId);
  const [user] = await db.select().from(users).where(eq(users.id, license.userId));
  return user!;
}

async function assertUserExists(db: Database, userId: string): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) {
    throw ApiError.notFound(`User ${userId} not found`);
  }
}

async function assertProductExists(db: Database, productId: string): Promise<void> {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) {
    throw ApiError.notFound(`Product ${productId} not found`);
  }
}

export async function listLicensesForUser(db: Database, userId: string): Promise<License[]> {
  await assertUserExists(db, userId);
  return db.select().from(licenses).where(eq(licenses.userId, userId));
}

export async function listProductsForUser(db: Database, userId: string): Promise<Product[]> {
  await assertUserExists(db, userId);
  // Listing semantics: only products with an Active license — these answer "right now".
  return db
    .selectDistinct({ id: products.id, name: products.name })
    .from(licenses)
    .innerJoin(products, eq(licenses.productId, products.id))
    .where(and(eq(licenses.userId, userId), eq(licenses.status, 'active')));
}

export async function listLicensesForProduct(
  db: Database,
  productId: string,
): Promise<License[]> {
  await assertProductExists(db, productId);
  return db.select().from(licenses).where(eq(licenses.productId, productId));
}

export async function listUsersForProduct(db: Database, productId: string): Promise<User[]> {
  await assertProductExists(db, productId);
  return db
    .selectDistinct({ id: users.id, email: users.email })
    .from(licenses)
    .innerJoin(users, eq(licenses.userId, users.id))
    .where(and(eq(licenses.productId, productId), eq(licenses.status, 'active')));
}

export async function revokeLicense(db: Database, id: string): Promise<License> {
  // Try to flip Active → Revoked atomically. Postgres row-locks the matching row;
  // the WHERE status='active' guard prevents resurrection of a terminal-state license.
  const [revoked] = await db
    .update(licenses)
    .set({ status: 'revoked', stateChangedAt: new Date() })
    .where(and(eq(licenses.id, id), eq(licenses.status, 'active')))
    .returning();

  if (revoked) {
    return revoked;
  }

  // 0 rows updated: either the license doesn't exist, or it's already terminal.
  // Re-read to give the caller the right error code.
  const [existing] = await db.select().from(licenses).where(eq(licenses.id, id));
  if (!existing) {
    throw ApiError.notFound(`License ${id} not found`);
  }
  throw ApiError.licenseNotActive(
    `License ${id} cannot be revoked because it is already ${existing.status}`,
  );
}

export interface ValidateLicenseResult {
  valid: boolean;
  license: License;
}

export async function validateLicense(
  db: Database,
  id: string,
): Promise<ValidateLicenseResult> {
  // Single transaction so the expire-on-validate transition is atomic and any
  // concurrent expire/revoke is observed consistently.
  return db.transaction(async (tx) => {
    const [initial] = await tx.select().from(licenses).where(eq(licenses.id, id));
    if (!initial) {
      throw ApiError.notFound(`License ${id} not found`);
    }

    if (!shouldExpire(initial.status, initial.expiresAt)) {
      return { valid: initial.status === 'active', license: initial };
    }

    // initial.status was 'active' and expires_at <= now: attempt the transition.
    const [updated] = await tx
      .update(licenses)
      .set({ status: 'expired', stateChangedAt: new Date() })
      .where(and(eq(licenses.id, id), eq(licenses.status, 'active')))
      .returning();

    if (updated) {
      return { valid: false, license: updated };
    }

    // Someone else (the scan job or a revoke) transitioned the row between our
    // SELECT and UPDATE. Re-read to report the freshest state.
    const [refreshed] = await tx.select().from(licenses).where(eq(licenses.id, id));
    if (!refreshed) {
      throw ApiError.notFound(`License ${id} not found`);
    }
    return { valid: false, license: refreshed };
  });
}
