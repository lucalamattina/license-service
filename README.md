# license-service

A small TypeScript REST service for issuing, validating, and revoking software licenses across a fictional product catalog. Built as a learning project.

The canonical design document is [DESIGN.md](DESIGN.md). Architectural decisions live in [docs/adr/](docs/adr/).

## Status

**Phase 1 — database schema & migrations.** The data model from DESIGN.md is realised in Postgres via Drizzle. Migration applies cleanly; partial unique index and cascade FKs are verified by tests. No API routes touching the DB yet.

## Requirements

- Node 20 LTS or newer (enforced by `engines.node` in [package.json](package.json))
- Docker Desktop (used from Phase 1 onward to run the Postgres container)

## Running locally

```
npm install
docker compose up -d
npm run db:migrate
npm run dev
```

Postgres listens on `localhost:5433` (5432 is left for any host-installed Postgres). The HTTP server listens on `http://localhost:3000` by default. Confirm it's alive:

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
| `npm run db:reset`   | Drop + recreate the dev DB, re-apply migrations (Windows) |

## Project layout

```
src/
  server.ts            Fastify app builder
  index.ts             entrypoint
  db/
    schema.ts          Drizzle schema (users, products, licenses)
    client.ts          Drizzle client factory
    migrate.ts         programmatic migration runner
  plugins/
    logger.ts          pino configuration
  routes/
    health.ts          GET /health
drizzle/
  migrations/          generated SQL migrations
scripts/
  db-migrate.ts        CLI wrapper around runMigrations()
  db-reset.ps1         drop + recreate dev DB
tests/
  helpers/db.ts        test DB setup + truncation helper
  db/                  schema + cascade tests
  health.test.ts       smoke test
docs/adr/              Architectural decision records
```
