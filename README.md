# license-service

[![CI](https://github.com/lucalamattina/license-service/actions/workflows/ci.yml/badge.svg)](https://github.com/lucalamattina/license-service/actions/workflows/ci.yml)

A small TypeScript REST service for issuing, validating, and revoking software licenses across a fictional product catalog. Built as a learning project.

The canonical design document is [DESIGN.md](DESIGN.md). Architectural decisions live in [docs/adr/](docs/adr/). Detailed transaction algorithms live in [docs/algorithms/](docs/algorithms/).

## What it does

- Manage `users`, `products`, and `licenses` via a REST API
- Issue licenses with a duplicate-replacement policy (replace if the new license has later expiration; otherwise reject)
- Revoke or expire licenses, with a state machine that prevents resurrection of terminal-state rows
- Auto-expire licenses past their expiration date via a BullMQ scheduled job (every minute) plus an in-transaction expire-on-validate path
- Expose `/health`, `/ready`, and Prometheus `/metrics`
- Backed by PostgreSQL (Drizzle ORM) + Redis (BullMQ); strict-mode TypeScript throughout

## Requirements

- Node 20 LTS or newer (enforced by `engines.node` in [package.json](package.json))
- Docker Desktop (for Postgres and Redis containers)

## Running locally

```
npm install
docker compose up -d
npm run db:migrate
npm run dev
```

Postgres listens on `localhost:5433` and Redis on `localhost:6380` (custom host ports to avoid clashing with any host-installed Postgres/Redis). The HTTP server listens on `http://localhost:3000` by default. Confirm it's alive:

```
curl http://localhost:3000/health
```

To run the entire stack (app included) in Docker:

```
docker compose --profile full-stack up --build
```

This starts Postgres, Redis, and the API in one shot. The API container runs migrations on boot (`RUN_MIGRATIONS_ON_BOOT=true`), so no manual migrate step is needed.

## Design Decisions

### License state machine

A license has one of three states: `active`, `expired`, or `revoked`. `active` is the only non-terminal state; once a license becomes Expired or Revoked it stays there forever. The two transitions are:

- `active → revoked` via `POST /licenses/:id/revoke`
- `active → expired` via either the `expire-licenses` BullMQ scan job or the in-transaction expire-on-validate path inside `POST /licenses/:id/validate`

Both writers gate on `WHERE status='active'` in their UPDATE clause, so a concurrent attempt to flip the same row produces a no-op for the loser instead of inconsistent state. Pure-function predicates live in [src/domain/license-state.ts](src/domain/license-state.ts).

### Duplicate-license policy

When a user requests a license for a product they already hold an Active license for, the new license **replaces** the old one if its `expires_at` is strictly later (the old becomes Revoked, the new is Active). If the new license has equal or earlier expiration, the request is **rejected** with `409 duplicate_active_license`. Revoked or Expired existing licenses do not block issuance.

The hard part is making "at most one Active license per `(user, product)`" hold under concurrent requests. The schema carries a partial unique index on `(user_id, product_id) WHERE status='active'`, and issuance runs inside a single transaction that locks the existing row with `SELECT ... FOR UPDATE`, revokes it, and inserts the new one. The full SQL and the correctness argument under four concurrency cases are in [docs/algorithms/license-issuance.md](docs/algorithms/license-issuance.md). The schema decision is recorded in [ADR 0001](docs/adr/0001-partial-unique-index-for-active-licenses.md).

The service does **not** retry internally on unique-constraint conflicts; race losers receive 409 and the client decides what to do.

### Expiration

A repeatable BullMQ job runs every minute (configurable) and executes a single SQL statement: `UPDATE licenses SET status='expired', state_changed_at=now() WHERE status='active' AND expires_at <= now()`. Independently, when a client calls validate on a license that's just crossed `expires_at`, the same transition runs inside the request transaction so the caller observes the up-to-date status without waiting for the next scan tick.

The race-safety invariant ([DESIGN.md](DESIGN.md) "Race-safety invariant"): both writers use the same `status='active'` filter, so concurrent attempts on the same row degrade to a no-op for the loser. A 30-iteration race test in [tests/queue/expire-licenses.test.ts](tests/queue/expire-licenses.test.ts) confirms exactly one transition per row.

### Why Drizzle over Prisma

Both are TypeScript-native ORMs with a similar surface, but Drizzle is much closer to SQL and adds less between you and the database. Concretely:

- **Schema-as-code in actual SQL terms.** [src/db/schema.ts](src/db/schema.ts) maps almost 1:1 to the generated migration; Prisma's schema DSL adds an extra layer to learn (and to debug when it doesn't translate the way you expect).
- **First-class support for `partial unique indexes` like the one this project depends on** — the `WHERE status='active'` filter is a one-line `uniqueIndex(...).where(sql\`...\`)` in Drizzle. Prisma added partial-index support late and it's still less idiomatic.
- **Raw SQL escape hatch is trivial.** `db.execute(sql\`SELECT 1\`)` works without ceremony — used by the `/ready` health check and the scan job's `now()` comparisons.
- **No code generation step.** Drizzle infers types directly from the schema definitions, so `npm run db:generate` is purely about producing migration SQL — there's no `prisma generate` step that has to stay in sync.

For a service whose central design moment is a Postgres-specific concurrency pattern, Drizzle's "you write SQL, we type it" stance is a better fit than Prisma's higher-level abstraction.

### What I'd do differently in production

[DESIGN.md](DESIGN.md) carries the full list. The biggest items:

- **Auth/authz.** The API is identity-agnostic (every endpoint takes `user_id` as a parameter). In production, users would only see their own licenses and an admin role would be required for cross-user operations.
- **Split the worker out of the API process.** Today the BullMQ worker lives in the same Node process as the HTTP server (see [src/index.ts](src/index.ts)). Production would split them — independent scaling, blast-radius isolation, cleaner shutdown. The application code is already factored cleanly enough that the worker only needs the database connection and the Redis URL.
- **Soft-delete users, anonymise their licenses.** Today user/product deletion cascades to licenses, which destroys audit history.
- **Idempotency keys** on `POST /licenses` so retries don't double-issue.
- **Rate limiting**, especially on `/licenses/:id/validate` which is the hot path.
- **Pagination** on list endpoints (the response envelope `{ "data": [...] }` was deliberately chosen so cursor metadata can be added without a breaking change).

## API

All single-resource endpoints return a bare object; collection endpoints wrap their payload in `{ "data": [...] }`. Errors use the structured shape `{ "error": "<code>", "message": "...", "details"?: ... }`. Full reference in [DESIGN.md](DESIGN.md).

| Method | Path                              | Purpose                                                          |
| ------ | --------------------------------- | -----------------------------------------------------------------|
| GET    | `/health`                         | Liveness — 200 as long as the process is alive                   |
| GET    | `/ready`                          | Readiness — 200 only if Postgres + Redis are reachable, else 503 |
| GET    | `/metrics`                        | Prometheus exposition format                                     |
| POST   | `/users`                          | Create a user (email is normalised: trim + lowercase)            |
| GET    | `/users`                          | List all users                                                   |
| GET    | `/users/:id`                      | Get a user by id                                                 |
| DELETE | `/users/:id`                      | Delete a user (cascades to licenses)                             |
| GET    | `/users/:id/licenses`             | All licenses for the user (every status)                         |
| GET    | `/users/:id/products`             | Products the user currently holds an Active license for          |
| POST   | `/products`                       | Create a product                                                 |
| GET    | `/products`                       | List all products                                                |
| GET    | `/products/:id`                   | Get a product by id                                              |
| DELETE | `/products/:id`                   | Delete a product (cascades to licenses)                          |
| GET    | `/products/:id/licenses`          | All licenses for the product (every status)                      |
| GET    | `/products/:id/users`             | Users currently holding an Active license                        |
| POST   | `/licenses`                       | Issue a license (replacement-or-reject policy)                   |
| GET    | `/licenses`                       | List all licenses (every status)                                 |
| GET    | `/licenses/:id`                   | Get a license by id                                              |
| GET    | `/licenses/:id/product`           | Get the license's product                                        |
| GET    | `/licenses/:id/user`              | Get the license's user                                           |
| POST   | `/licenses/:id/revoke`            | Revoke an Active license; 409 if already terminal                |
| POST   | `/licenses/:id/validate`          | Validate; auto-transitions Active→Expired if past `expires_at`.  |Response: `{ valid, license }` |

## Scripts

| Script                | What it does                                                  |
| --------------------- | ------------------------------------------------------------- |
| `npm run dev`         | Start the server with hot-reload via `tsx watch`              |
| `npm start`           | Start the server (no reload, still via `tsx`)                 |
| `npm run build`       | Compile TypeScript to `dist/`                                 |
| `npm run start:prod`  | Run the compiled output (`node dist/index.js`)                |
| `npm test`               | Run the full Vitest suite                                  |
| `npm run test:unit`      | Run only the pure-unit suite (no DB/Redis needed)          |
| `npm run test:integration` | Run only the integration suite (requires Postgres + Redis) |
| `npm run test:watch`     | Run Vitest in watch mode                                   |
| `npm run typecheck`      | Run `tsc --noEmit`                                         |
| `npm run lint`           | Run ESLint                                                 |
| `npm run format`         | Run Prettier in write mode                                 |
| `npm run db:generate`    | Generate a Drizzle migration from `src/db/schema.ts`       |
| `npm run db:migrate`     | Apply pending migrations to the dev DB                     |
| `npm run db:migrate:test`| Create (if missing) and migrate the **test** DB            |
| `npm run db:reset`       | Drop + recreate the dev DB, re-apply migrations            |

## Project layout

```
src/
  server.ts            Fastify app builder
  index.ts             entrypoint (boots app + queue + worker, graceful shutdown)
  db/
    schema.ts          Drizzle schema (users, products, licenses)
    client.ts          Drizzle client factory
    migrate.ts         programmatic migration runner
  domain/
    license-state.ts   pure state-machine predicates (canRevoke, shouldExpire)
  queue/
    connection.ts      ioredis + BullMQ connection helpers
    scheduler.ts       queue, worker, and repeatable-job scheduler
    jobs/
      expire-licenses.ts  scan-and-flip worker function
  lib/
    errors.ts          ApiError class + error code union
    error-mapper.ts    pure unknown -> { status, body } mapper
    response.ts        wrapList() list envelope helper
  plugins/
    logger.ts          pino configuration
    error-handler.ts   Fastify setErrorHandler wiring
    zod.ts             Zod validator/serializer wiring
    metrics.ts         prom-client registry, counters, GET /metrics route
  schemas/             Zod request/param schemas per resource
  services/            DB-facing logic per resource
  routes/              HTTP routes per resource

drizzle/migrations/    generated SQL migrations
docs/adr/              Architectural decision records
docs/algorithms/       Detailed transaction algorithms
scripts/               CLI wrappers (db migrate / reset)
tests/                 Vitest suites: foundation unit + integration
```

## Tests

**141 tests across 17 files**, split into two suites:

| Suite       | Files | Tests | What it covers                                                                                                                                                                              |
| ----------- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | 5     | 34    | Pure functions only: `ApiError`, the error-to-response mapper, the `wrapList` envelope helper, the license-state-machine predicates, the email-normalisation Zod schema. No DB, no HTTP boot, no Redis. |
| Integration | 12    | 107   | Real Postgres + Redis. Every route exercised end-to-end via `app.inject()`, the partial unique index, cascade deletes, the `expire-licenses` worker, `/ready`, `/metrics`, and two race tests run 30 iterations each. |

Integration tests rely on `TEST_DATABASE_URL` and `TEST_REDIS_URL` (defaults match `docker-compose.yml`). Test files run sequentially (`fileParallelism: false`) so they can share the same test DB; data is truncated between cases by [tests/helpers/db.ts](tests/helpers/db.ts).

Run a suite directly:

```
npm run test:unit          # ~1s, no services needed
npm run test:integration   # ~15s, needs `docker compose up -d` first
npm test                   # both
```

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull request against `main`, with `concurrency` set so a new commit cancels older in-progress runs. Six jobs run in parallel:

| Job                 | What it does                                                                          |
| ------------------- | ------------------------------------------------------------------------------------- |
| `lint`              | `npm ci` + `npm run lint`                                                             |
| `typecheck`         | `npm ci` + `npm run typecheck`                                                        |
| `unit-tests`        | `npm ci` + `npm run test:unit` — no services                                          |
| `integration-tests` | `npm ci` + `npm run db:migrate:test` + `npm run test:integration`, against PostgreSQL 16 and Redis 7 service containers |
| `build`             | `npm ci` + `npm run build` — proves the production TypeScript compile is clean        |
| `docker-build`      | `docker buildx build` with GHA cache — proves the runtime image still assembles      |

Node 20 across the board. `npm ci` (not `npm install`) is used everywhere, with `actions/setup-node`'s `cache: 'npm'`. Permissions are scoped to `contents: read`.
