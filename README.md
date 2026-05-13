# license-service

A small TypeScript REST service for issuing, validating, and revoking software licenses across a fictional product catalog. Built as a learning project.

The canonical design document is [DESIGN.md](DESIGN.md). Architectural decisions live in [docs/adr/](docs/adr/). Detailed transaction algorithms live in [docs/algorithms/](docs/algorithms/).

## Status

**Phase 7 — Async expiration job (BullMQ + Redis).** A repeatable BullMQ job (`upsertJobScheduler`, idempotent on a stable key) scans every minute and flips Active-but-past-expiry licenses to Expired in a single SQL statement. The worker, the queue, and the `/ready` health check now live in the boot path; SIGTERM drains the worker, closes the queue, and quits both Redis and Postgres connections. `/ready` returns 200 only when both Postgres (`SELECT 1`) and Redis (`PING`) are reachable, else 503 with per-dep `checks`. The scan path shares the `status='active'` guard with the validate path, so concurrent scan+validate against the same license consistently lands one transition (verified by 30-iteration race test).

## Requirements

- Node 20 LTS or newer (enforced by `engines.node` in [package.json](package.json))
- Docker Desktop (Postgres from Phase 1, Redis from Phase 7)

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

## Scripts

| Script               | What it does                                |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | Start the server with hot-reload via `tsx`  |
| `npm start`          | Start the server (no reload)                |
| `npm test`           | Run the Vitest suite once                   |
| `npm run test:watch` | Run Vitest in watch mode                    |
| `npm run typecheck`  | Run `tsc --noEmit`                          |
| `npm run lint`       | Run ESLint                                  |
| `npm run format`     | Run Prettier in write mode                  |
| `npm run db:generate`| Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to the dev DB      |
| `npm run db:reset`   | Drop + recreate the dev DB, re-apply migrations |

## Project layout

```
src/
  server.ts            Fastify app builder
  index.ts             entrypoint
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
  schemas/
    users.ts           Zod schemas for /users
    products.ts        Zod schemas for /products
    licenses.ts        Zod schemas for /licenses
  services/
    users.ts           user CRUD against Drizzle
    products.ts       product CRUD against Drizzle
    licenses.ts        license issuance + reads + relationship queries
  routes/
    health.ts          GET /health, GET /ready
    users.ts           /users routes (+ /users/:id/licenses, /users/:id/products)
    products.ts        /products routes (+ /products/:id/licenses, /products/:id/users)
    licenses.ts        /licenses routes
drizzle/
  migrations/          generated SQL migrations
scripts/
  db-migrate.ts        CLI wrapper around runMigrations()
  db-reset.ts          drop + recreate dev DB, re-apply migrations
tests/
  helpers/
    db.ts              test DB setup + truncation helper
    app.ts             builds a Fastify app + test DB for integration tests
  db/                  schema + cascade tests
  foundation/          unit tests for ApiError, error mapper, response helpers
  users/               /users integration + schema tests
  products/            /products integration tests
  domain/              pure unit tests for the license state machine
  licenses/            /licenses + relationship + transitions integration tests
  queue/               expire-licenses worker tests + /ready integration tests
  health.test.ts       smoke test
docs/adr/              Architectural decision records
```
