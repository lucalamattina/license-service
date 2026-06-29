# license-service

[![CI](https://github.com/lucalamattina/license-service/actions/workflows/ci.yml/badge.svg)](https://github.com/lucalamattina/license-service/actions/workflows/ci.yml)

A small TypeScript REST service for issuing, validating, and revoking software licenses across a fictional product catalog.

**Live demo:** <https://llamattina-license-service-5c6fae72379f.herokuapp.com> (deployed on Heroku, container stack, with Heroku Postgres + Heroku Redis add-ons; seeded with 3 users, 3 products, and 9 active licenses)

**Dashboard:** there's a companion SPA at <https://license-service-dashboard.vercel.app/licenses> ([repo](https://github.com/lucalamattina/license-service-dashboard)) that calls this backend from the browser. Its [walkthrough of the three license states](https://github.com/lucalamattina/license-service-dashboard#see-all-three-license-states) creates a license that expires in real time, so you can watch the BullMQ scan job flip it from Active to Expired without writing any code.

**MCP layer:** [mcp/](mcp/) ships a Model Context Protocol server that exposes the backend to AI clients (Claude Code, Claude Desktop, Cursor). An agent can resolve users by email, audit licence history, and run the full lifecycle without writing HTTP code. Quick-start in [mcp/README.md](mcp/README.md); design rationale and eval strategy in [mcp/MCP_DESIGN.md](mcp/MCP_DESIGN.md).

**Kubernetes:** the service also deploys to Kubernetes as separate **web** and **worker** Deployments ([k8s/](k8s/)), managed by **ArgoCD GitOps**, with the cluster platform itself (datastores, observability, ArgoCD) provisioned as code in **OpenTofu** ([terraform/](terraform/)). CI publishes the image to GHCR and writes the pinned tag back to the manifests, so a commit to `main` becomes a running pod with no manual step. See the [Kubernetes](#kubernetes) section.

The canonical design document is [DESIGN.md](DESIGN.md). Architectural decisions live in [docs/adr/](docs/adr/). Detailed transaction algorithms live in [docs/algorithms/](docs/algorithms/).

## Try it from your terminal

Every example below hits the deployed instance, no setup required. The API responds in JSON for success and structured-error JSON for failures.

```bash
BASE=https://llamattina-license-service-5c6fae72379f.herokuapp.com

# 1) Liveness and readiness. /ready actively pings both Postgres and Redis
curl $BASE/health
# → {"status":"ok"}

curl $BASE/ready
# → {"status":"ok","checks":{"postgres":"ok","redis":"ok"}}

# 2) Prometheus-format observability: process defaults + four custom counters
curl -s $BASE/metrics | grep -E "^(licenses_|license_validations_)"
# → licenses_issued_total, licenses_revoked_total,
#   licenses_expired_total{path="scan"|"validate"},
#   license_validations_total{result="valid"|"invalid"}

# 3) Browse the seeded data. Single-resource returns a bare object,
#    collections wrap in {"data":[...]} so pagination metadata can be added later
curl -s $BASE/users
curl -s $BASE/products
curl -s $BASE/licenses

# 4) Relationship endpoints honour the listing-semantics rule:
#    "/users/{id}/licenses" returns ALL statuses (historical),
#    "/users/{id}/products" returns only Active licenses (right-now view).
USER_ID=$(curl -s $BASE/users | jq -r '.data[0].id')
curl -s $BASE/users/$USER_ID/licenses
curl -s $BASE/users/$USER_ID/products

# 5) Validate a license. Auto-transitions Active→Expired if past expires_at,
#    in the same transaction, so the caller always sees the freshest state.
LICENSE_ID=$(curl -s $BASE/licenses | jq -r '.data[0].id')
curl -s -X POST $BASE/licenses/$LICENSE_ID/validate
# → {"valid":true,"license":{"id":...,"status":"active",...}}

# 6) Validation errors come back structured, with field path, message, Zod code
curl -s -X POST $BASE/users \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email"}'
# → {"error":"validation_error","message":"Request validation failed",
#    "details":[{"path":["email"],"message":"Invalid email",...}]}

# 7) The duplicate-active-license policy in action. Re-issuing for the same
#    (user, product) with worse-or-equal expiration returns 409 with a message
#    that describes the conflict, not just the status text
PRODUCT_ID=$(curl -s $BASE/products | jq -r '.data[0].id')
curl -s -X POST $BASE/licenses \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$USER_ID\",\"product_id\":\"$PRODUCT_ID\",\"expires_at\":\"2026-12-31T23:59:59Z\"}"
# → {"error":"duplicate_active_license","message":"User already holds an active
#    license for this product with equal or later expiration (existing expires at ...)"}
```

> The `jq` pipes are optional; they just extract a UUID so the next command is copy-pasteable. Without `jq`, copy any `id` from the previous response by hand.

The full endpoint reference is in the [API](#api) section.

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

### Deploying to Heroku

The repo ships a [heroku.yml](heroku.yml) so Heroku's **container stack** builds the existing [Dockerfile](Dockerfile) on every `git push heroku main`. No buildpack, no `Procfile`, no separate build pipeline.

**One-time setup** (run from the repo root after `heroku login`):

```bash
# Create the app on the container stack
heroku create your-app-name --stack container

# Add managed Postgres and Redis (paid: ~$5/mo + ~$3/mo at the cheapest tiers)
heroku addons:create heroku-postgresql:essential-0
heroku addons:create heroku-redis:mini

# Required env: SSL for the Heroku-Postgres self-signed cert, migrations on boot,
# and your dashboard's origin for CORS.
heroku config:set NODE_ENV=production
heroku config:set DATABASE_SSL=true
heroku config:set RUN_MIGRATIONS_ON_BOOT=true
heroku config:set CORS_ALLOWED_ORIGINS=https://your-dashboard.vercel.app,https://your-dashboard-*.vercel.app
```

**Deploy:**

```bash
git push heroku main
```

Heroku builds the Dockerfile, releases the image as the `web` dyno, the container starts, `RUN_MIGRATIONS_ON_BOOT` applies any pending migrations against the addon-provisioned Postgres, then the Fastify server binds to Heroku's injected `$PORT`. `DATABASE_URL` and `REDIS_URL` are set automatically by the addons, no manual config needed.

**Verify:**

```bash
heroku open                       # opens the app URL in your browser
curl https://your-app-name.herokuapp.com/health
curl https://your-app-name.herokuapp.com/ready    # 200 with checks: { postgres: ok, redis: ok }
heroku logs --tail
```

**Notes:**

- The Heroku Postgres add-on uses TLS with a self-signed cert; `DATABASE_SSL=true` flips on `rejectUnauthorized: false` in the Postgres driver (see [src/db/postgres-options.ts](src/db/postgres-options.ts)). Without it, the connection fails with a TLS error.
- The Heroku Redis add-on also terminates TLS with a self-signed cert (`REDIS_URL` comes back as `rediss://...`). [src/queue/connection.ts](src/queue/connection.ts) auto-detects the `rediss://` scheme and passes `tls: { rejectUnauthorized: false }` to both the standalone ioredis client and the BullMQ queue/worker connections, with no env var needed. Local `redis://` is unaffected.
- One web dyno runs both the HTTP server *and* the BullMQ worker (matches local). For multi-dyno deploys, switch migrations to a Heroku release-phase step (so multiple boots don't race) and split the worker into its own process type. Both are noted in DESIGN.md's "What I'd do differently in production" section.
- Costs at the cheapest tiers: Eco dyno $5/mo (sleeps after 30 min idle) or Basic $7/mo (always on) + Postgres essential-0 $5/mo + Redis mini $3/mo ≈ $13–15/mo total.

### CORS

The API is locked down by an origin allowlist (`@fastify/cors`). With nothing configured, browser requests from `http://localhost:5173` are allowed (that's the companion [dashboard](https://github.com/lucalamattina/license-service-dashboard)'s Vite dev server).

Configure via `CORS_ALLOWED_ORIGINS`, comma-separated. Entries may use `*` as a wildcard for a single subdomain label (it does **not** cross dots, so `https://*.vercel.app` matches `foo.vercel.app` but not `foo.bar.vercel.app`):

```
CORS_ALLOWED_ORIGINS=http://localhost:5173,https://license-service-dashboard.vercel.app,https://license-service-dashboard-*.vercel.app
```

The third entry above is what handles Vercel preview deploys (each preview gets a hash-suffixed subdomain). Requests with no `Origin` header (curl, server-to-server health probes) are allowed unconditionally; CORS only applies to browsers.

## Kubernetes

Alongside the Heroku deploy, the service runs on **Kubernetes**: the application manifests live in [k8s/](k8s/), and the cluster platform they run on (datastores, observability, ArgoCD) is provisioned as code with **OpenTofu/Terraform** in [terraform/](terraform/). Everything is validated on a local [kind](https://kind.sigs.k8s.io/) cluster — a full teardown + `tofu apply` recreate brings the whole platform up from nothing, after which ArgoCD deploys the app from git.

The published image is **`ghcr.io/lucalamattina/license-service`** (public, tagged by commit SHA + `latest`).

### Web / worker split

The single Docker image boots in one of three roles via the `PROCESS_ROLE` env var (see [src/index.ts](src/index.ts)):

- `web` — the Fastify HTTP server only, with `livenessProbe` → `/health` and `readinessProbe` → `/ready` (so traffic is routed only once Postgres + Redis are reachable). Runs 2 replicas behind a ClusterIP [Service](k8s/service.yaml).
- `worker` — the BullMQ worker + repeatable expiry scheduler only. It serves a minimal `/health` + `/metrics` endpoint ([src/metrics-server.ts](src/metrics-server.ts)) so it can be probed and scraped, but has no inbound-traffic Service.
- `all` — both in one process; the **default**, so Heroku and local dev are unchanged.

This is the worker split called out in [DESIGN.md](DESIGN.md)'s "what I'd do differently in production" — independent scaling and blast-radius isolation, with the API process freed of background work.

### Migrations as a PreSync hook

Schema migrations run once per rollout via a dedicated [migration Job](k8s/migration-job.yaml) annotated as an **ArgoCD `PreSync` hook**: it runs (and must succeed) *before* the Deployments are synced, on the same image, executing [src/db/migrate-cli.ts](src/db/migrate-cli.ts). This replaces the single-dyno `RUN_MIGRATIONS_ON_BOOT` approach, which would race across multiple replicas. The hook is deliberately self-contained — it depends only on the `Secret`, not the app `ConfigMap` (which is created later in the sync phase) — so it works on a clean cluster instead of deadlocking on a missing ConfigMap.

### GitOps with ArgoCD

An ArgoCD `Application` watches the [k8s/](k8s/) path on `main` with automated sync (prune + self-heal). The cluster state is driven by git: change a manifest, push, and ArgoCD reconciles — no `kubectl apply`.

### CI/CD: commit to running pod

The [CI pipeline](.github/workflows/ci.yml) closes the loop on green `main`:

1. After the six check jobs pass, the `publish` job builds the image and pushes `ghcr.io/lucalamattina/license-service:sha-<short>` + `:latest` to GHCR.
2. It then **writes the pinned SHA tag back** into the Deployment + migration manifests and commits it with `[skip ci]`.
3. ArgoCD syncs that commit and rolls the web + worker pods onto the new image.

So a push to `main` becomes running pods with no manual step, and every deploy is an immutable, auditable SHA pinned in git.

### Observability

[kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) scrapes the app via two [ServiceMonitors](k8s/servicemonitor.yaml) — one for web, one for worker. Two are needed because the processes hold **separate** prom-client registries: the web owns the issuance/revocation/validation counters, the worker owns `licenses_expired_total{path="scan"}` from the scan job, so scraping only the web Service would silently miss the worker's metrics. A [Grafana dashboard](k8s/grafana-dashboard.yaml) over the custom counters ships as a ConfigMap (auto-loaded by the Grafana sidecar), so it's reproducible from git rather than click-built.

### Platform as code (OpenTofu)

[terraform/](terraform/) provisions everything the app depends on, with pinned chart versions:

- the `license-service`, `argocd`, and `monitoring` namespaces
- PostgreSQL + Redis (Bitnami charts, pulled from their OCI registry)
- the app `Secret` (`DATABASE_URL` / `REDIS_URL`)
- kube-prometheus-stack
- ArgoCD and the root `Application` (via the `argo-cd` + `argocd-apps` charts)

The kind cluster itself is the only prerequisite (in a cloud setup an EKS/GKE module would sit alongside these files; only the provider wiring changes). Full notes in [terraform/README.md](terraform/README.md).

### Quick start (local kind cluster)

```bash
kind create cluster --name licsvc

# Provision the platform as code (namespaces, datastores, monitoring, ArgoCD, app Secret):
cd terraform && tofu init && tofu apply

# ArgoCD then syncs k8s/ from main, runs the PreSync migration hook, and rolls the pods.
# (Give it a minute; to nudge: kubectl annotate application license-service -n argocd argocd.argoproj.io/refresh=hard --overwrite)
kubectl get pods -n license-service        # web (x2) + worker Running, migrate Completed
kubectl port-forward svc/license-service 3000:3000 -n license-service
curl localhost:3000/ready                  # {"status":"ok","checks":{"postgres":"ok","redis":"ok"}}
```

**Notes:**

- The `Secret` is created by Terraform (`kubernetes_secret`) and is **not** committed — the manifests in `k8s/` are credential-free. Without Terraform you'd create it once with `kubectl create secret generic license-service-secrets ...`.
- In-cluster Postgres/Redis is for the exercise; production would use managed services (RDS / Valkey) with the cluster running only the app.

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
- **First-class support for `partial unique indexes` like the one this project depends on.** The `WHERE status='active'` filter is a one-line `uniqueIndex(...).where(sql\`...\`)` in Drizzle. Prisma added partial-index support late and it's still less idiomatic.
- **Raw SQL escape hatch is trivial.** `db.execute(sql\`SELECT 1\`)` works without ceremony; used by the `/ready` health check and the scan job's `now()` comparisons.
- **No code generation step.** Drizzle infers types directly from the schema definitions, so `npm run db:generate` is purely about producing migration SQL, with no `prisma generate` step that has to stay in sync.

For a service whose central design moment is a Postgres-specific concurrency pattern, Drizzle's "you write SQL, we type it" stance is a better fit than Prisma's higher-level abstraction.

### What I'd do differently in production

[DESIGN.md](DESIGN.md) carries the full list. The biggest items:

- **Auth/authz.** The API is identity-agnostic (every endpoint takes `user_id` as a parameter). In production, users would only see their own licenses and an admin role would be required for cross-user operations.
- **Split the worker out of the API process.** Today the BullMQ worker lives in the same Node process as the HTTP server (see [src/index.ts](src/index.ts)). Production would split them: independent scaling, blast-radius isolation, cleaner shutdown. The application code is already factored cleanly enough that the worker only needs the database connection and the Redis URL.
- **Soft-delete users, anonymise their licenses.** Today user/product deletion cascades to licenses, which destroys audit history.
- **Idempotency keys** on `POST /licenses` so retries don't double-issue.
- **Rate limiting**, especially on `/licenses/:id/validate` which is the hot path.
- **Pagination** on list endpoints (the response envelope `{ "data": [...] }` was deliberately chosen so cursor metadata can be added without a breaking change).

## API

All single-resource endpoints return a bare object; collection endpoints wrap their payload in `{ "data": [...] }`. Errors use the structured shape `{ "error": "<code>", "message": "...", "details"?: ... }`. Full reference in [DESIGN.md](DESIGN.md).

| Method | Path                              | Purpose                                                          |
| ------ | --------------------------------- | -----------------------------------------------------------------|
| GET    | `/health`                         | Liveness check; 200 as long as the process is alive              |
| GET    | `/ready`                          | Readiness check; 200 only if Postgres + Redis are reachable, else 503 |
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
  index.ts             entrypoint (boots web/worker/all by PROCESS_ROLE, graceful shutdown)
  metrics-server.ts    minimal /health + /metrics server for the worker-only role
  db/
    schema.ts          Drizzle schema (users, products, licenses)
    client.ts          Drizzle client factory
    migrate.ts         programmatic migration runner
    migrate-cli.ts     runnable migrate-and-exit entrypoint (the k8s migration Job)
    postgres-options.ts  env-driven SSL config (DATABASE_SSL=true for Heroku)
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
    cors-allowlist.ts  parseAllowlist() + buildOriginMatcher() (glob-aware)
  plugins/
    logger.ts          pino configuration
    cors.ts            @fastify/cors registration, env-driven allowlist
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
mcp/                   separate-package MCP server + eval harness (see mcp/README.md)
k8s/                   Kubernetes manifests (web + worker Deployments, migration
                       PreSync hook, Services, ServiceMonitors, Grafana dashboard)
terraform/             OpenTofu/Terraform: namespaces, datastores, monitoring, ArgoCD
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

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull request against `main`, with `concurrency` set so a new commit cancels older in-progress runs. Six check jobs run in parallel; on green `main` a seventh publishes the image:

| Job                 | What it does                                                                          |
| ------------------- | ------------------------------------------------------------------------------------- |
| `lint`              | `npm ci` + `npm run lint`                                                             |
| `typecheck`         | `npm ci` + `npm run typecheck`                                                        |
| `unit-tests`        | `npm ci` + `npm run test:unit` (no services required)                                 |
| `integration-tests` | `npm ci` + `npm run db:migrate:test` + `npm run test:integration`, against PostgreSQL 16 and Redis 7 service containers |
| `build`             | `npm ci` + `npm run build`; proves the production TypeScript compile is clean         |
| `docker-build`      | `docker buildx build` with GHA cache; proves the runtime image still assembles        |
| `publish`           | **main only**, after all checks pass: builds + pushes the image to `ghcr.io/lucalamattina/license-service` (`:sha-<short>` + `:latest`), then writes the pinned tag back into the [k8s/](k8s/) manifests and commits it with `[skip ci]` for ArgoCD to roll out |

Node 20 across the board. `npm ci` (not `npm install`) is used everywhere, with `actions/setup-node`'s `cache: 'npm'`. The check jobs run with `contents: read`; only the `publish` job is granted `packages: write` (to push to GHCR) and `contents: write` (for the manifest write-back), and it never runs on pull requests, so forks can't publish.
