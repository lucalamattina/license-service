# license-service MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the [license-service backend](../) to MCP-compatible AI clients (Claude Code, Claude Desktop, Cursor, etc.) so an agent can resolve users by email, audit licence history, validate, issue, and revoke licences without writing any HTTP code.

The full design rationale — tool surface, error translation, security stance, what was deliberately *not* exposed — lives in [MCP_DESIGN.md](MCP_DESIGN.md). This README is the operational quick-start.

## What the agent can do

Eight tools across three phases, three resource URI templates, and one prompt:

| Tool                          | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `find_user_by_email`          | Resolve an email to a `user_id`. Returns `null` on no match.    |
| `list_products`               | Return the product catalogue.                                   |
| `get_license`                 | Read one licence by id.                                         |
| `list_user_licenses`          | All licences (every status) for a user.                         |
| `list_user_active_products`   | Products the user currently holds an Active licence for.        |
| `validate_license`            | Validate a licence; lazily flips Active→Expired if past expiry. |
| `issue_license`               | Issue or extend a licence (duplicate-active replacement policy).|
| `revoke_license`              | Revoke an Active licence. Rejects if already terminal.          |

Resources `license://{id}`, `user://{id}`, `product://{id}` and the `audit_user_licenses` prompt are documented in [MCP_DESIGN.md](MCP_DESIGN.md) sections 5 and 6.

## Five-minute quick start (Claude Code)

```bash
# from the repo root
cd mcp
npm install
npm run build          # produces dist/index.js
```

Register the server with Claude Code by creating `.mcp.json` at the **repo root** (one level up from `mcp/`):

```json
{
  "mcpServers": {
    "license-service": {
      "command": "node",
      "args": ["mcp/dist/index.js"],
      "env": {
        "LICENSE_SERVICE_BASE_URL": "https://llamattina-license-service-5c6fae72379f.herokuapp.com"
      }
    }
  }
}
```

Restart Claude Code, run `/mcp` to confirm `license-service` shows up with eight tools, then try a prompt:

> Look up the user `eval-find-user-happy@example.com` and tell me everything they have ever held.

Claude will chain `find_user_by_email` → `list_user_licenses` and summarise the result.

### Alternative: Claude Desktop

Same idea, different config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Use an **absolute** `args` path (Claude Desktop doesn't have a project root concept):

```json
{
  "mcpServers": {
    "license-service": {
      "command": "node",
      "args": ["/absolute/path/to/license-service/mcp/dist/index.js"],
      "env": {
        "LICENSE_SERVICE_BASE_URL": "https://llamattina-license-service-5c6fae72379f.herokuapp.com"
      }
    }
  }
}
```

### Alternative: skip the build, run via tsx

For local development the `dev` script avoids the build step. Point the client's `command` at `tsx` (or `npx tsx`) and `args` at `src/index.ts`:

```json
{
  "mcpServers": {
    "license-service": {
      "command": "npx",
      "args": ["tsx", "mcp/src/index.ts"],
      "env": { "LICENSE_SERVICE_BASE_URL": "http://localhost:3000" }
    }
  }
}
```

## Configuration

| Env var                     | Default                                                                  | What it does                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE_SERVICE_BASE_URL`  | `https://llamattina-license-service-5c6fae72379f.herokuapp.com`          | Backend HTTP base url. Override to point at a local stack.                                                                         |
| `ANTHROPIC_API_KEY`         | _required for `npm run eval` only_                                       | Used by the eval harness to drive `claude-sonnet-4-6`. Not used by the server itself — the agent's API key lives in the MCP client. |
| `COST_CAP_USD`              | `5.00`                                                                   | Eval-only. Aborts the run if the cumulative Anthropic spend crosses this.                                                          |
| `SAMPLES_PER_CASE`          | `5`                                                                      | Eval-only. Number of samples per case for the pass-rate calculation.                                                               |
| `CASE_FILTER`               | unset                                                                    | Eval-only. Substring-matches against case names; useful when iterating on one or two cases. Example: `CASE_FILTER=duplicate`.      |

### Pointing at a local backend

If you're running the backend locally (`docker compose up -d && npm run dev` in the repo root), set the env var in your MCP client's config:

```json
"env": { "LICENSE_SERVICE_BASE_URL": "http://localhost:3000" }
```

After changing the config, restart the MCP client so it re-spawns the server with the new environment.

## Running the eval suite

The eval harness (`mcp/evals/`) runs a 12-case suite against the live backend with `claude-sonnet-4-6`, sampling each case 5 times and reporting a per-case pass rate. The rationale — pass rate over pass/fail, why some cases assert "did NOT call this tool", why the matcher is a subsequence rather than a strict prefix — is in [MCP_DESIGN.md](MCP_DESIGN.md#10-evaluation).

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > mcp/.env   # gitignored
cd mcp
npm run eval
```

Output is one block per case; the run exits non-zero if any case falls below its 80% threshold.

**Cost:** a full run (12 cases × 5 samples) is around **$2 USD** at current Sonnet pricing. The runner aborts if the total crosses `COST_CAP_USD` (default `$5`).

**Iterating on one case** is cheap with `CASE_FILTER`:

```bash
CASE_FILTER=audit npm run eval                    # ~$0.25
CASE_FILTER=duplicate SAMPLES_PER_CASE=2 npm run eval   # ~$0.10
```

The runner dumps the actual tool-call sequence (with args) and the final-message tail for every **failed** sample — this is the signal that lets you tell "the agent panicked and retried" apart from "my assertion was too strict".

> The 12 case definitions live in [evals/cases/](evals/cases). Each file is small and self-contained; the order of cases and the threshold per case are in [evals/cases/index.ts](evals/cases/index.ts) and [evals/types.ts](evals/types.ts).

## Development

| Script             | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `npm run dev`      | Run the server with `tsx watch` (hot reload).                               |
| `npm start`        | Run the server with `tsx` (no reload).                                      |
| `npm run build`    | Compile to `dist/` via `tsconfig.build.json`.                               |
| `npm run start:prod` | Run the compiled output (`node dist/index.js`).                           |
| `npm run typecheck`| `tsc --noEmit` against the whole tree (src + tests + evals).                |
| `npm test`         | Vitest unit-test run (84 tests, ~1s, no backend or network needed).         |
| `npm run test:watch` | Vitest in watch mode.                                                     |
| `npm run eval`     | Run the eval suite against the live backend. Needs `ANTHROPIC_API_KEY`.     |

The unit tests do **not** hit the backend or the Anthropic API — they use a stubbed `fetch` and the SDK's `InMemoryTransport`. They verify the MCP-layer code (routing, Zod validation, error translation, result shape) deterministically. The eval suite is what exercises the agent + tools + real backend together.

## Layout

```
mcp/
  README.md           you are here
  MCP_DESIGN.md       canonical design doc (tool surface, errors, security, evals)
  package.json
  tsconfig.json       editor / test config (noEmit)
  tsconfig.build.json compile to dist/

  src/
    index.ts          entrypoint: wires the SDK server to stdio
    server.ts         createServer({ backend }) factory
    backend-client.ts BackendClient: fetch-based HTTP, retry-on-network-error, 30s timeout
    error-translation.ts  pure translateBackendError(): backend codes -> two-layer agent payload
    tool-result.ts    toolSuccess(), toolError() helpers for MCP CallToolResult shape
    resources.ts      registerResources(): three URI templates, McpError translation
    prompts.ts        registerPrompts(): audit_user_licenses (canonical body lives here)
    tools/            one file per tool, registered via tools/index.ts

  tests/              Vitest: stub-fetch unit tests for every tool, plus resource/prompt tests

  evals/              run via `npm run eval`, NOT part of `npm test`
    runner.ts         main loop: per-case N=5 sampling, cost accounting, debug-on-fail
    agent-loop.ts     bridges MCP tools onto Anthropic's tools API (in-process via InMemoryTransport)
    cost-tracker.ts   Sonnet 4.x pricing + cap enforcement
    seed.ts           direct-backend HTTP helpers for pre-state seeding
    types.ts          EvalCase shape (expectedToolCalls, forbiddenTools, maxCallsByTool, ...)
    cases/            one file per case; cases/index.ts is the registered set
```

## Why this is a separate package

The `mcp/` directory has its own `package.json`, lockfile, and `node_modules`. Two reasons:

1. **The backend's Docker image must not bundle the MCP code.** `.dockerignore` excludes `mcp/`. A separate package keeps the dependency graphs disjoint so a stray `import` from the backend into the MCP layer would surface immediately.
2. **The MCP layer has client-only deps** (`@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`) that have no business in a production HTTP server image.

The MCP server only talks to the backend over HTTP. There is **no shared code or shared TypeScript project boundary** between the two packages — they communicate exactly the way Claude Code and the deployed backend communicate in production.

## See also

- [MCP_DESIGN.md](MCP_DESIGN.md) — the canonical design doc (tool surface, error translation, resources, prompts, security, eval strategy)
- [Backend DESIGN.md](../DESIGN.md) — the HTTP service the MCP layer wraps
- [Backend README](../README.md) — the deployed live URL, the seeded data, the dashboard
