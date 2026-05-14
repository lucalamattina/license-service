import { and, eq, lte, sql } from 'drizzle-orm';
import { licenses } from '../../db/schema.js';
import type { Database } from '../../db/client.js';
import { licensesExpiredTotal } from '../../plugins/metrics.js';

export interface ExpireLicensesResult {
  expired: number;
}

/**
 * Scan-and-flip: transitions every Active license whose `expires_at` is in the
 * past to Expired in a single UPDATE statement. Returns the row count.
 *
 * Idempotent: re-running with no state changes affects zero rows, because the
 * WHERE clause filters by status='active'.
 *
 * Race-safe (DESIGN.md "race-safety invariant"): the validate endpoint runs
 * the same logic inside its own transaction with the same status='active'
 * guard. Concurrent attempts to flip the same row produce a no-op for the
 * loser; the partial unique index is unaffected because both writers move the
 * row out of the (Active) keyspace.
 *
 * Uses Postgres `now()` rather than a JS `new Date()` so the timestamp comes
 * from the database clock and matches `expires_at` comparisons made inside the
 * same statement.
 */
export async function runExpireLicensesJob(db: Database): Promise<ExpireLicensesResult> {
  const rows = await db
    .update(licenses)
    .set({ status: 'expired', stateChangedAt: sql`now()` })
    .where(and(eq(licenses.status, 'active'), lte(licenses.expiresAt, sql`now()`)))
    .returning({ id: licenses.id });
  if (rows.length > 0) {
    licensesExpiredTotal.inc({ path: 'scan' }, rows.length);
  }
  return { expired: rows.length };
}
