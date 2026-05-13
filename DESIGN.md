Summary

A small backend service for managing software licenses across a fictional product catalog. A given user can request licenses for products and validate them at runtime. Licenses become invalid automatically when they expire, and can also be revoked before their expiration date.


Goals

- Manage user, license and product creation and deletion
- List users, licenses and products
- Assign a licence of a specific product to a specified user
- Validate a user's license
- Automatically expire licenses on expiration time
- Revoke a licence


Non-Goals

- Authentication (mocked)
- Authorization (all operations are unauthenticated for the purposes of this learning project)
- Front-end or UIs
- Email delivery
- Pagination (pagination is not implemented for the learning project, production would add it.)


Design decisions

Duplicate-license policy: When a user requests a license for a product they currently hold an active license for, the new license replaces the old one if its expires_at is later than the existing one's. The old license is transitioned to Revoked, and the new license is issued as Active. If the new license's expires_at is earlier than or equal to the existing one's, the request is rejected with 409 Conflict as the user already has equivalent or better coverage. Revoked or expired licenses for the same product do not block new issuance.

Concurrency on issuance: the duplicate-license rule is a check-then-act sequence, so two concurrent issuance requests for the same (user, product) could both pass the check and both insert. To make the "at most one active license per (user, product)" invariant hold by construction rather than by application logic, the licenses table carries a partial unique index on (user_id, product_id) WHERE status = 'active'. Issuance runs in a single transaction that revokes the existing active license before inserting the new one; a racing concurrent insert that slips past the application-level check fails on the index and is mapped to 409. The service does not retry internally on unique-constraint conflicts: a race loser receives 409 duplicate_active_license and the client decides whether to retry. The partial unique index is the final arbiter of which request wins.

Issuance validation: expires_at must be strictly in the future at issuance time. Requests with expires_at <= now() are rejected with 400, so an Active license always has a future expiration at the moment it is created.

Listing semantics: endpoints that return license records (GET /licenses, GET /users/{id}/licenses, GET /products/{id}/licenses) return licenses in all statuses — these are historical views. Endpoints that derive a relationship through licenses (GET /users/{id}/products, GET /products/{id}/users) only count Active licenses — these answer "right now" questions. No status query-string filter is exposed.

Expiration: a repeatable BullMQ job scans for and flips expired licenses; for the purposes of testing and demo the job runs every minute. The worker executes a single statement: UPDATE licenses SET status='expired', state_changed_at=now() WHERE status='active' AND expires_at <= now(). Independently, when a user sends a validation request the same check runs inside the request transaction, so a license that just crossed its expires_at is observed as Expired by the caller without waiting for the next scan tick.

Race-safety invariant: scan-and-flip is the only place outside the validate endpoint that mutates license.status to Expired. Both writers gate on status='active' in the WHERE clause and run inside transactions, so concurrent attempts to expire the same license — whether scanner vs. validator, or scanner vs. an issuance that's revoking-and-replacing — degrade to a no-op for the loser rather than producing inconsistent state. Revoked licenses are filtered out of the scan for the same reason: status='active' is the universal guard.

The scheduler is registered once at app boot using a stable job key (upsertJobScheduler is idempotent on the key), so dev hot-reloads and multi-instance deploys do not accumulate duplicate schedulers.

Revoke non-idempotency: POST /licenses/{id}/revoke on an already-Revoked or already-Expired license returns 409 license_not_active, not 200. The state machine treats Revoked and Expired as distinct audit signals, and idempotent re-revoke would either re-stamp state_changed_at (misleading — the actual transition happened earlier) or silently no-op (confusing). Clients that want idempotent behavior can treat 409 license_not_active as success on their side, where the use-case context lives.

Deletion: if a product or user is deleted, the associated licenses have to be deleted as well (cascade).

Operational endpoints: /health returns 200 unconditionally as long as the process is alive (liveness check). /ready returns 200 only if Postgres (SELECT 1) and Redis (BullMQ ping) are both reachable, else 503 (readiness check). /metrics exposes Prometheus-format metrics via prom-client: prom-client process defaults plus four custom counters — licenses_issued_total, licenses_revoked_total, licenses_expired_total, and license_validations_total{result="valid"|"invalid"}. licenses_expired_total is incremented by both writers (the scan job uses RETURNING id and counts rows; the validate path increments 1 when its UPDATE affects 1 row); double-counting is impossible because both writers gate on status='active' and only one of them can win the transition for any given license.


What I'd Do Differently in Production

Authentication/Authorization model: the current API is fully identity-agnostic as every endpoint takes user_id as an explicit parameter (in the request body or URL path) rather than inferring it from an authenticated caller, so even a mock auth header would be inert. In production, users should only be able to issue or view licenses to themselves, and there would be an admin role that is the only one allowed to create products, list all users and all licenses, and revoke licenses for any user.

Front-end: The production version would need a front end to create a user, make requests and view resources.

Beyond the necessary implementations of a front-end with proper authentication and authorization, the expiration job is the main concern. Running it every minute allows for tight control over active licenses but exposes the system to potential overloads as the number of users, licenses and products grow. An easy solution would be to run the async job daily in batches, a variable number of workers can be used to distribute the load evenly and make sure the job is completed on time. Given that the validation request already expires licenses past their expiration time this would not allow users to continue using products with licenses past their expiration time but can create stale license lists if the get licenses request is run before the expiration job is finished.

Idempotency: Implement idempotency keys to prevent duplicate requests being processed.

Rate limiting: A simple rate limiting mechanism should be implemented, especially on the license validation endpoint to avoid potentially overwhelming the api.

Deletions: User and product deletion cascades to licenses for the learning project. Production would soft-delete users (preserving the audit trail) and anonymize associated licenses rather than hard-deleting them.

Data Model

Users
    -id UUID PK
    -email TEXT UNIQUE NOT NULL  -- trimmed and lowercased before insert so the UNIQUE constraint enforces case-insensitive uniqueness; the API echoes back the canonical form

Products
    -id UUID PK
    -name TEXT NOT NULL

License
    id UUID PK 
    status ENUM ('active', 'expired', 'revoked') NOT NULL
    created_at TIMESTAMPTZ NOT NULL
    expires_at TIMESTAMPTZ NOT NULL
    state_changed_at TIMESTAMPTZ NOT NULL  -- internal audit; defaults to created_at, updated on every transition; not exposed in API responses
    user_id UUID NOT NULL FK -> user.id
    product_id UUID NOT NULL FK -> product.id

    UNIQUE INDEX (user_id, product_id) WHERE status = 'active'


Relationships

- User has many Licenses
- Product has many Licenses
- License belongs to one Product
- License belongs to one User


License States

Active -> Expired
Active -> Revoked

Expired -> terminal state; no further transitions

Revoked -> terminal state; no further transitions


Endpoints

Response envelope convention: collection endpoints wrap their payload as { "data": [ ... ] } so pagination metadata can be added later without a breaking change. Single-resource endpoints return the resource as a bare object. The validate endpoint is the one intentional exception, since its response carries both a verdict and the license.

Error response shape: every non-2xx response uses a structured body so clients can distinguish failure modes without parsing the human message:

{
  "error": "duplicate_active_license",
  "message": "User already holds an active license for this product with a later or equal expiration date",
  "details": { ... }   // optional, e.g. Zod field-level errors
}

The "error" field is a machine-readable code; the "message" field is informative — for a 409 on the duplicate-license rule it should describe the conflict, not just echo the status text. Initial error codes:

- validation_error (400) — request body failed Zod validation; details carries field-level errors
- expires_at_in_past (400) — issuance attempted with expires_at <= now()
- not_found (404) — referenced user, product, or license does not exist
- duplicate_email (409) — POST /users attempted with an email already registered (compared on the canonical lowercased form)
- duplicate_active_license (409) — issuance rejected by the duplicate-license policy
- license_not_active (409) — revoke attempted on a license that is already Revoked or Expired (validate on a non-Active license is not an error: it returns 200 with valid: false)
- internal_error (500) — any unhandled error reaching the top-level error handler; the response message is generic and does not leak implementation details

State-machine violations always return 409, never 400 or 422.

Users

POST /users
Create a new user

Request body:
{
    "email": "user@email.com"
}

Response: 201 Created
{
    "id": "user_uuid",
    "email": "user@email.com"
}


GET /users/{user_id}
Get a user by id

Response: 200 OK
{
    "id": "user_uuid",
    "email": "user@email.com"
}


GET /users
Get all users

Response: 200 OK
{
    "data": [
    {
      "id": "user_uuid",
      "email": "user@email.com"
    }
  ]
}


GET /users/{user_id}/licenses
Get a user's licences

Response: 200 OK
{
  "data": [
    {
      "id": "license_uuid",
      "status": "active",
      "created_at": "2026-05-03T12:00:00Z",
      "expires_at": "2026-12-31T23:59:59Z",
      "user_id": "user_uuid",
      "product_id": "product_uuid"
    }
  ]
}


GET /users/{user_id}/products
Get a user's products

Response: 200 OK
{
  "data": [
    {
      "id": "product_uuid",
      "name": "product_name"
    }
  ]
}


DELETE /users/{user_id}
Delete a user by id

Response: 204 No Content
{}


Products

POST /products
Create a new product

Request body:
{
    "name": "product_name"
}

Response: 201 Created
{
    "id": "product_uuid",
    "name": "product_name"
}


GET /products/{product_id}
Get a product by id

Response: 200 OK
{
    "id": "product_uuid",
    "name": "product_name"
}


GET /products
Get all products

Response: 200 OK
{
    "data": [
    {
      "id": "product_uuid",
      "name": "product_name"
    }
  ]
}


GET /products/{product_id}/licenses
Get a product's licences

Response: 200 OK
{
  "data": [
    {
      "id": "license_uuid",
      "status": "active",
      "created_at": "2026-05-03T12:00:00Z",
      "expires_at": "2026-12-31T23:59:59Z",
      "user_id": "user_uuid",
      "product_id": "product_uuid"
    }
  ]
}


GET /products/{product_id}/users
Get a product's users

Response: 200 OK
{
  "data": [
    {
      "id": "user_uuid",
      "email": "user_email"
    }
  ]
}


DELETE /products/{product_id}
Delete a product by id

Response: 204 No Content
{}


Licenses

POST /licenses
Create a new license, expires_at value must be greater than current time.

Request body:
{
    "expires_at": "2026-12-31T23:59:59Z",
    "user_id": "user_uuid",
    "product_id": "product_uuid"
}

Response: 201 Created
{
    "id": "license_uuid",
    "status": "active",
    "created_at": "2026-05-03T12:00:00Z",
    "expires_at": "2026-12-31T23:59:59Z",
    "user_id": "user_uuid",
    "product_id": "product_uuid"
}


POST /licenses/{license_id}/revoke
Revoke a license

Response: 200 OK
{
    "id": "license_uuid",
    "status": "revoked",
    "created_at": "2026-05-03T12:00:00Z",
    "expires_at": "2026-12-31T23:59:59Z",
    "user_id": "user_uuid",
    "product_id": "product_uuid"
}


POST /licenses/{license_id}/validate
Returns the license's current state. If the license is Active but past its expiration date, transitions it to Expired inside a transaction. Already-Revoked or already-Expired licenses are returned as-is.

Response: 200 OK
{
    "valid": true,
        "license": {
        "id": "license_uuid",
        "status": "active",
        "created_at": "2026-05-03T12:00:00Z",
        "expires_at": "2026-12-31T23:59:59Z",
        "user_id": "user_uuid",
        "product_id": "product_uuid"
      }
}


GET /licenses/{license_id}
Get a license by id

Response: 200 OK
{
    "id": "license_uuid",
    "status": "active",
    "created_at": "2026-05-03T12:00:00Z",
    "expires_at": "2026-12-31T23:59:59Z",
    "user_id": "user_uuid",
    "product_id": "product_uuid"
}


GET /licenses
Get all licenses

Response: 200 OK
{
    "data": [
    {
      "id": "license_uuid",
      "status": "active",
      "created_at": "2026-05-03T12:00:00Z",
      "expires_at": "2026-12-31T23:59:59Z",
      "user_id": "user_uuid",
      "product_id": "product_uuid"
    }
  ]
}


GET /licenses/{license_id}/product
Get a licence's product

Response: 200 OK
{
    "id": "product_uuid",
    "name": "product_name"
}


GET /licenses/{license_id}/user
Get a license's users

Response: 200 OK
{
    "id": "user_uuid",
    "email": "user_email"
}