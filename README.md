# license-service

A small TypeScript REST service for issuing, validating, and revoking software licenses across a fictional product catalog. Built as a learning project.

The canonical design document is [DESIGN.md](DESIGN.md). Architectural decisions live in [docs/adr/](docs/adr/).

## Status

**Phase 0 — project scaffolding.** Fastify boots, lints, typechecks, and serves `GET /health`. No database wiring yet.

## Requirements

- Node 20 LTS or newer (enforced by `engines.node` in [package.json](package.json))
- Docker Desktop (used from Phase 1 onward to run the Postgres container)

## Running locally

```
npm install
npm run dev
```

The server listens on `http://localhost:3000` by default. Confirm it's alive:

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

## Project layout

```
src/
  server.ts        Fastify app builder
  index.ts         entrypoint
  plugins/
    logger.ts      pino configuration
  routes/
    health.ts      GET /health
tests/             Vitest test suites
docs/adr/          Architectural decision records
```
