# License issuance: transaction algorithm

`POST /licenses` issues a license for a `(user, product)` pair. The headline domain rule is the duplicate-license policy: when a user already holds an Active license for the same product, issuance either **replaces** it (if the new license has a later `expires_at`) or is **rejected** (otherwise).

This document specifies the exact SQL the service runs and argues that it is correct under concurrent requests without internal retries.

## Preconditions

- `expires_at` is strictly in the future (otherwise the service short-circuits with 400 `expires_at_in_past`).
- `user_id` and `product_id` exist (otherwise the INSERT trips the foreign-key constraint and the service returns 404 `not_found`).

## SQL

The whole flow runs inside a single transaction at `READ COMMITTED` isolation (Postgres default).

```sql
BEGIN;

-- Step 1: acquire an exclusive row lock on the (at most one) Active license for
-- this (user, product), if any. SELECT ... FOR UPDATE serializes concurrent
-- issuance when a matching row exists; another transaction running the same
-- query waits here for ours to commit or roll back. When NO row matches,
-- FOR UPDATE locks nothing -- race-safety in that case falls to step 4, where
-- the partial unique index serializes concurrent inserts.
SELECT id, expires_at
FROM licenses
WHERE user_id = :user_id
  AND product_id = :product_id
  AND status = 'active'
FOR UPDATE;

-- Step 2: branch on the result.
-- If a row exists:
--   If new.expires_at <= existing.expires_at:
--     ROLLBACK; return 409 duplicate_active_license  -- worse-or-equal coverage
--   Else:
--     -- Step 3: revoke the existing license. The status='active' guard is
--     -- defensive; the FOR UPDATE lock guarantees this still holds.
--     UPDATE licenses
--     SET status = 'revoked',
--         state_changed_at = now()
--     WHERE id = :existing.id
--       AND status = 'active';

-- Step 4: insert the new license.
INSERT INTO licenses
  (user_id, product_id, status, expires_at, created_at, state_changed_at)
VALUES
  (:user_id, :product_id, 'active', :expires_at, now(), now());

COMMIT;
```

If the INSERT (or the COMMIT) raises a unique-constraint violation on `licenses_active_user_product_idx` (SQLSTATE `23505`), the service maps it to 409 `duplicate_active_license` with a "concurrent issuance won the race" message. If the INSERT raises a foreign-key violation (SQLSTATE `23503`), the service maps it to 404 `not_found`.

**The service does NOT retry internally on `23505`.** The 409 is surfaced to the caller, who has the use-case context.

## Why this is correct under concurrency

Two transactions, A and B, running this algorithm against the same `(user_id, product_id)`.

### Case A — no existing Active license, two concurrent issuances

1. Tx A: `SELECT ... FOR UPDATE` returns no rows. Nothing locked.
2. Tx B: `SELECT ... FOR UPDATE` returns no rows. Nothing locked.
3. Tx A: skips step 3 (no existing). INSERT at step 4 succeeds.
4. Tx B: skips step 3. INSERT at step 4 *blocks* on the partial unique index because A's pending INSERT holds it for the same key. When A commits, B's INSERT fails with `23505`. Service maps to 409.

Postcondition: exactly one Active license. Loser sees 409.

### Case B — existing Active license, two concurrent issuances, both better

1. Tx A: `SELECT ... FOR UPDATE` returns the existing row and locks it.
2. Tx B: `SELECT ... FOR UPDATE` blocks waiting for A's lock.
3. Tx A: existing has earlier expiration → step 3 (UPDATE existing → Revoked) → step 4 (INSERT new Active). Commit. Lock released.
4. Tx B: lock released; under `READ COMMITTED`, B's `SELECT ... FOR UPDATE` re-evaluates its WHERE clause on the latest committed state. The original row is now `status='revoked'` so it no longer matches the filter; A's new Active row *does* match, and B locks that. B then compares its own `expires_at` against A's new row:
   - If B's new is also better than A's new: step 3 + step 4 → exactly one Active.
   - If B's new is worse-or-equal to A's new: ROLLBACK with 409.

Postcondition: exactly one Active license. Outcome is deterministic given the inputs and the commit order.

### Case C — existing Active license, one issuance, new is worse-or-equal

1. Tx: `SELECT ... FOR UPDATE` returns the existing row.
2. Comparison says new ≤ existing → ROLLBACK → 409 `duplicate_active_license`.

Postcondition: existing Active license unchanged.

### Case D — issuance races with a concurrent revoke

1. Tx A (issuance): `SELECT ... FOR UPDATE` locks the existing Active row.
2. Tx B (revoke): tries to UPDATE the same row → blocks waiting for A's lock.
3. Tx A: completes its branch. If it replaces, A's UPDATE flips the row to Revoked. A also INSERTs the new Active row. Commit.
4. Tx B: lock released; B's UPDATE re-evaluates `WHERE id=X AND status='active'`.
   - If A revoked the row already: B's UPDATE returns 0 rows. Service maps to 409 `license_not_active` (the license is already terminal).
   - If A took the worse-coverage ROLLBACK branch: the existing row is still Active. B's UPDATE succeeds, revoking it.

Postcondition: at most one Active license at all times. Loser of the race gets a coherent error.

## Why no internal retries

The partial unique index is the final arbiter of the invariant. Any `23505` reaching the service layer means a concurrent transaction has just satisfied "at most one Active per `(user, product)`" in a way that conflicts with our request. The right response is to surface 409 to the client, who has context the service does not (idempotency tokens, retry budgets, what the user just clicked). An internal retry loop would also mask bugs during development and make load tests misleading.

## Universal postconditions

After any successful `POST /licenses`:

- At most one row matches `(user_id, product_id, status='active')`.
- Every license has `state_changed_at >= created_at`.
- Any Active license has `expires_at > now()` at the moment of creation.
- A user with no Active license for a product is not blocked by Revoked or Expired licenses on the same pair.

## Related

- [ADR 0001 — partial unique index for active licenses](../adr/0001-partial-unique-index-for-active-licenses.md) — the schema decision this algorithm depends on.
