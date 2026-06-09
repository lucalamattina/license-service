# MCP layer — design

> Design doc for the Model Context Protocol layer that exposes the `license-service` backend to MCP clients such as Claude Code and Cursor.
>
> Canonical backend reference: [../DESIGN.md](../DESIGN.md). This document only describes the MCP-specific wrapper.

## 1. Summary

The server runs as a local Node child process spawned by an MCP client, communicates with the client over the stdio transport, and translates the client's tool calls into HTTP requests against the deployed backend (Heroku by default, configurable for local dev or eval runs). The intended consumer is an agent acting as a fictional admin-assistant: a support engineer asking Claude to look up a user, audit a license history, or issue and revoke licenses in natural language rather than via direct API calls. The layer is deliberately thin — no state, no orchestration, no auth — so the design surface stays visible: the work lives in *which* operations are exposed (and which are deliberately not), how the backend's structured errors are rewritten so an agent can reason over them, and whether the resulting tool surface is verified by an eval suite rather than asserted. All three MCP primitives (tools, resources, prompts) are exposed; the rationale for each lives in its own section.

## 2. Goals and Non-Goals

### Framing

This MCP layer has two framings stacked on top of each other:

- **Outer framing (portfolio).** The artifact's purpose is to demonstrate sound MCP server design: tool surface justified by the cuts as much as the inclusions, all three protocol primitives used deliberately, and agent behaviour verified by an eval suite rather than asserted.
- **Inner framing (admin-assistant).** The tool surface pretends to be an admin-assistant tool layer. An agent on the other end is helping a (fictional) support engineer manage customer licenses: looking up users, auditing their license history, issuing or revoking licenses on request. This framing shapes the tool descriptions, the error wording, and the eval cases.

The two framings are not in tension. The portfolio framing gives licence to write defensive design notes ("here is what I cut and why") that wouldn't fit a pure product doc; the admin-assistant framing gives the tools a coherent texture so a reader doesn't see them as a random subset of the backend's endpoints.

### Goals

- **Expose a curated subset of license-management operations as MCP tools**, scoped to what an admin-assistant agent would realistically use. Not every backend endpoint is wrapped; the cuts are explicit and defended in section 4.
- **Use all three MCP primitives deliberately:** tools (for actions and parameterised reads), resources (for fetchable context the agent loads opportunistically), and one prompt (`audit_user_licenses`) for a recurring multi-tool workflow. Each primitive's inclusion is justified rather than box-ticked.
- **Translate the backend's structured error envelope (`{error, message, details}`) into natural-language tool errors** that agents can reason over without parsing enum strings. The translation policy is its own section.
- **Provide an eval suite that exercises tool selection and failure-mode recovery**, not just smoke tests. The eval section is the differentiator: most portfolio MCP servers have zero evals.
- **Document the cuts.** The "what was deliberately not exposed" list is treated with the same weight as the exposed-tools list.

### Non-Goals

- **Hosted deployment.** The MCP server runs locally as a child process of the MCP client (Claude Code, Cursor). It is not deployed. Note that the *server* is local but it *talks to* the backend deployed on Heroku over HTTPS by default; the server's locality is about its own lifecycle, not about which backend it hits. Production deployment is discussed in "What I'd do differently."
- **Authentication and authorization.** Trust is delegated to the MCP client's per-tool permission model, matching the backend's identity-agnostic stance. The server has no notion of a "current user."
- **A custom agent loop.** Claude (or whichever model the MCP client is driving) is the agent. The server is a stateless wrapper around backend HTTP calls.
- **RAG, vector retrieval, or any local data store.** The server holds zero state beyond a process-lifetime HTTP client.
- **Advanced MCP features.** No streaming, no sampling, no tool-descriptor signing. v1 uses the synchronous tool-call surface only.
- **Coverage of every backend endpoint.** User and product CRUD, cross-user listings (`GET /products/:id/users`), and license hard-deletion are deliberately excluded; the justification for each cut lives in section 4.
- **Multi-step reasoning inside the server.** The agent chains tools naturally; the server does not orchestrate multi-tool workflows. (The `audit_user_licenses` prompt is the one place a multi-tool flow is *templated*, but the agent still drives it.)

## 3. Architecture

```
Claude Code (or any MCP client)
    │
    │ stdio (JSON-RPC framing)
    ▼
MCP server (Node, runs locally as a child process of the client)
    │
    │ HTTPS (HTTP for local dev)
    ▼
license-service backend (Heroku by default; local Fastify for eval runs)
    │
    ▼
Postgres / Redis (Heroku Postgres + Heroku Redis / local Docker)
```

### Where it runs

The MCP server runs **locally on the developer's machine** as a child process spawned by the MCP client. It is not deployed. Note that "local" describes the server's lifecycle, not which backend it talks to: by default the server makes HTTPS calls against the deployed Heroku backend, and that's the configuration a reviewer experimenting with the server would use. Eval runs (section 10) override the base URL to point at an in-process Fastify instance bound to an eval database.

### Transport

stdio, the standard MCP transport for local servers spawned by clients. JSON-RPC framing on top. No HTTP server in the MCP layer itself; the only HTTP traffic is *outbound* from the MCP server to the backend.

### Lifecycle

The MCP client spawns the server when the user opens an MCP-aware session and terminates it when the session closes. No persistent state survives the process. The HTTP client to the backend is created once at startup and reused across tool calls for connection pooling, but it's also disposed when the process exits.

### Backend client

Plain `fetch` against the backend's base URL, with:

- **Base URL** read from an env var (`LICENSE_SERVICE_BASE_URL`), defaulting to the deployed Heroku instance.
- **Per-request timeout** of 30 seconds (section 7).
- **One retry on network errors**, none on backend 4xx/5xx (section 7).
- **No auth headers** — the backend is identity-agnostic.

### Repository layout

The MCP server lives under `mcp/` inside the existing license-service repo, with its own `package.json`, its own TypeScript config, and its own test/eval suite. This co-location is deliberate: the MCP layer and the backend evolve together, the tool surface is the backend's contract translated for agents, and a reviewer can see both halves side by side without cloning multiple repos.

The `mcp/` directory is excluded from the backend's Docker build via `.dockerignore`, so deploying the backend does not ship the MCP server with it. The MCP server has no production deployment.

## 4. Tool Surface

The MCP server exposes **8 tools**, grouped into discovery, read, and action tools. Each tool's description (the text below "Description (agent-facing)") is what the model sees when deciding whether to call it; the rest of the fields here are for the human reader.

The cuts (what was deliberately *not* exposed) are at the end of this section.

### Tool naming and argument conventions

- Tool names use `snake_case`.
- IDs are passed as UUID strings, matching the backend's exposed identifiers.
- Datetimes are ISO 8601 strings (UTC). The agent is expected to compute relative times client-side; the MCP server does not accept friendlier shapes like `expires_in_days`. This keeps a single source of truth (the backend's contract) and avoids inventing a translation layer the agent has to learn separately.
- Tool descriptions are written to be self-contained: they describe both the happy-path return value and the specific error codes the agent should expect to handle, so the model can decide when to use the tool without having to call it and see what happens.

### Discovery tools

These resolve human-facing references (emails, product names) to the UUIDs the rest of the surface needs.

#### `find_user_by_email`

- **Why exposed:** Email is the durable human-readable handle for a user. Every admin-assistant workflow starts with "this customer at this email." Without this, the agent can't move from a natural-language request to a `user_id`.
- **Args:** `email` (string).
- **Description (agent-facing):**
  > Looks up a user by email address. Email matching is case-insensitive (the backend normalises emails to lowercase on both write and read). Returns `{ user: { id, email } }` if found, or `{ user: null }` if no user has that email. Use this as the entry point when the human references a user by email; the returned `user.id` is what every other user-scoped tool requires.
- **Success:** `{ user: { id, email } }` on match, `{ user: null }` on no match. Both are HTTP 200; see "find semantics" below.
- **Common errors:** `validation_error` (the input isn't a valid email shape).
- **Backend call:** Direct passthrough to `GET /users/by-email?email=...`, which returns `200 { user: null }` on no match rather than `404` (see "Find semantics" below for the reconciliation with section 7). The MCP server does **not** list all users and filter in-memory; that would contradict the section-4 cut of `GET /users`. The backend's by-email endpoint exists specifically to give the MCP layer a principled lookup path that takes an email as input and never returns more than one user.
- **Find semantics.** This tool is the one place in the surface where "no match" is **not** an error. Section 7's error policy maps every backend non-2xx into an `isError: true` tool result; that policy still holds here, because the backend returns `200 { user: null }` rather than `404` when no user matches. "Does this email exist?" is a question; the answer "no" is a successful empty result, not a failure. The agent receives a successful tool result with a nullable body and decides what to tell the human.

#### `list_products`

- **Why exposed:** A symmetric entry point for product references. Without it, the agent can't move from "Pro Plan" to a `product_id`. The catalogue is small enough to return whole; no name-search endpoint is needed.
- **Args:** none.
- **Description (agent-facing):**
  > Returns the full product catalogue as `{ products: [{ id, name }] }`. The catalogue is small (single-digit to low-double-digit entries), so this returns everything in one call. Use this when the human references a product by name and you need the `product_id` to pass to `issue_license`.
- **Success:** `{ products: [{ id, name }, ...] }`.
- **Common errors:** none (no args, no path).

### Read tools

These inspect existing state without mutating anything (with the deliberate exception of `validate_license` — see below).

#### `get_license`

- **Why exposed:** The agent often holds a `license_id` from a previous tool call and needs the full record. Distinct from `validate_license` because read-without-mutation is a different intent and the agent should be able to choose.
- **Args:** `license_id` (uuid string).
- **Description (agent-facing):**
  > Fetches a license by id without mutating its state. Returns the full license record `{ id, status, created_at, expires_at, user_id, product_id }`. Use this when you need to inspect a license's metadata (owner, product, dates, status) without checking its current validity. If you specifically want to know whether the license is currently valid, use `validate_license` instead — it auto-transitions expired-but-still-active licenses inside the same transaction.
- **Success:** the license object.
- **Common errors:** `not_found` (no license with that id).

#### `list_user_licenses`

- **Why exposed:** "Show me everything for this user" is the canonical audit workflow. Anchors the `audit_user_licenses` prompt.
- **Args:** `user_id` (uuid string).
- **Description (agent-facing):**
  > Returns every license a user has ever held for any product, in any status (active, expired, revoked). Returns `{ licenses: [...] }`. Use this for audit-style "show me everything" workflows. If you only care about products the user can currently use, call `list_user_active_products` instead — it's a "right now" view that excludes revoked and expired licenses.
- **Success:** `{ licenses: [...] }` (possibly empty).
- **Common errors:** `not_found` (the user doesn't exist; distinct from "the user exists but has no licenses," which returns an empty list).

#### `list_user_active_products`

- **Why exposed:** "What can this user access right now" is a frequent admin-assistant question, semantically distinct from the historical view. Having two tools avoids the agent having to filter `list_user_licenses` itself (and getting it wrong).
- **Args:** `user_id` (uuid string).
- **Description (agent-facing):**
  > Returns the products the user currently has an **Active** license for. Returns `{ products: [{ id, name }] }`. This is a "right now" view: revoked and expired licenses are excluded. Use this for "what does the user have access to today" questions; use `list_user_licenses` for full historical audit.
- **Success:** `{ products: [...] }` (possibly empty).
- **Common errors:** `not_found` (the user doesn't exist).

#### `validate_license`

- **Why exposed:** Currentness is the canonical runtime question for a license. The agent should distinguish "is this currently valid?" (this tool) from "what does this license look like?" (`get_license`). Note that this tool has a side effect — see the description.
- **Args:** `license_id` (uuid string).
- **Description (agent-facing):**
  > Checks whether a license is currently valid. Returns `{ valid: boolean, license: {...} }`. If the license is `active` but past its `expires_at`, this call atomically transitions it to `expired` inside the same database transaction and returns `valid: false` with the updated record. Already-revoked or already-expired licenses are returned as-is with `valid: false`. Note that this tool has a side effect on active-but-expired licenses; use `get_license` if you want a pure read.
- **Success:** `{ valid: true, license: {...} }` or `{ valid: false, license: {...} }`.
- **Common errors:** `not_found` (no license with that id).

### Action tools

These mutate state. The trust model (section 8) governs how the MCP client gates these.

#### `issue_license`

- **Why exposed:** Issuing a license is the headline action for the admin-assistant framing. The agent gets to demonstrate the entire duplicate-license replacement policy, which is the backend's most interesting design moment.
- **Args:** `user_id` (uuid string), `product_id` (uuid string), `expires_at` (ISO 8601 datetime, must be strictly in the future).
- **Description (agent-facing):**
  > Issues a new Active license to a user for a specific product, expiring at the given timestamp. `expires_at` must be ISO 8601 and strictly in the future; if the human gives a relative time ("in 30 days"), compute the timestamp yourself. **Duplicate-license policy:** if the user already holds an Active license for this product, the new license replaces the old one **only if** `expires_at` is strictly later (the old becomes Revoked, the new is Active). If `expires_at` is earlier or equal, the request fails with `duplicate_active_license` and the existing license is untouched. Revoked or Expired existing licenses for the same product do **not** block issuance.
- **Success:** the new license record `{ id, status: "active", created_at, expires_at, user_id, product_id }`.
- **Common errors:**
  - `duplicate_active_license` (409) — explain to the human that the user already has equal-or-later coverage; the existing license's `expires_at` is in the error message.
  - `expires_at_in_past` (400) — compute a future timestamp and retry.
  - `not_found` (404) — `user_id` or `product_id` doesn't exist; re-check via `find_user_by_email` or `list_products`.

#### `revoke_license`

- **Why exposed:** The agent-appropriate way to end a license. Distinct from any kind of hard-deletion (which we deliberately do not expose; see cuts below).
- **Args:** `license_id` (uuid string).
- **Description (agent-facing):**
  > Revokes an Active license, transitioning it to `status: revoked` and preserving the row in the database (no hard delete). Returns the updated record. Only Active licenses can be revoked: re-revoking a Revoked license, or revoking an Expired license, fails with `license_not_active`. Use this to "end" a license; if you want to extend or upgrade instead, call `issue_license` with a later `expires_at` (the duplicate-license policy will handle the swap).
- **Success:** the updated license record `{ ..., status: "revoked", ... }`.
- **Common errors:**
  - `license_not_active` (409) — the license is already terminal; surface this clearly to the human rather than retrying.
  - `not_found` (404).

### Deliberately not exposed

Defending the cuts. Each item below is a backend capability the MCP layer chooses *not* to wrap, with a one-line reason.

- **User CRUD** (`POST /users`, `DELETE /users/:id`). Admin-shaped, not agent-shaped. An admin-assistant should not be creating or deleting users mid-conversation; that's a UI operation with its own confirmations and audit context. The agent's user-discovery path is `find_user_by_email` on already-existing users.
- **Product CRUD** (`POST /products`, `DELETE /products/:id`). Same reasoning as user CRUD. The product catalogue is an admin's concern, not the agent's.
- **`GET /users`** (list every user). Without authentication, this would dump every email in the system into the agent's context window for any conversation. The principled discovery path is `find_user_by_email` (the caller must already know an email).
- **Cross-user listings** (`GET /products/:id/users`, `GET /products/:id/licenses`). These are dashboard-shaped: a human admin scanning a UI to see "everyone on Pro Plan." An agent works one user at a time; cross-user views invite the agent to reason over data it doesn't need.
- **License hard-deletion** (`DELETE /licenses/:id`). The backend supports it. The agent-appropriate way to end a license is `revoke_license`, which preserves the audit trail. Exposing hard-delete would let the agent destroy history.
- **`get_user` / `get_product` as tools.** A `user_id` or `product_id` the agent is holding can be fetched via the corresponding **resource** (`user://{user_id}`, `product://{product_id}`) — see section 5. Keeping these as resources rather than tools enforces the "tools are deliberate actions, resources are loadable context" split.

## 5. Resource Design

The MCP server exposes three resource types, all addressable via **URI templates only**. The server implements `resources/read` for the three URI patterns below, but does **not** implement `resources/list` for any of them.

### The three URI templates

| URI pattern              | Returns                                                                                           | Backed by                          |
|--------------------------|---------------------------------------------------------------------------------------------------|------------------------------------|
| `license://{license_id}` | A JSON content block with the full license record: `id`, `status`, `created_at`, `expires_at`, `user_id`, `product_id`. | `GET /licenses/{license_id}`       |
| `user://{user_id}`       | A JSON content block with the user record: `id`, `email`.                                          | `GET /users/{user_id}`             |
| `product://{product_id}` | A JSON content block with the product record: `id`, `name`.                                        | `GET /products/{product_id}`       |

All three return the same JSON shape the backend produces, with `application/json` as the MIME type. `not_found` from the backend becomes a resource read error following the section-7 translation policy.

### Why templated-only, no `resources/list`

The principled framing the doc commits to: **tools are for finding and acting; resources are for fetching the full state of something you already have an id for.** That gives the two primitives a clean division of labour.

Concretely:

- The agent's *discovery* paths are already tool-shaped: `find_user_by_email` resolves an email to a `user_id`; `list_products` returns the product catalogue; `list_user_licenses` returns every license id for a known user. No resource enumeration covers ground that isn't covered better by a tool.
- The license set is **unbounded** by design (every issuance creates a new row; revoked and expired rows are preserved). A `resources/list` for licenses would either dump the whole history into the agent's context (a footgun) or require pagination semantics that don't fit MCP's `resources/list` contract.
- Listing users via `resources/list` would expose every email in the system as a URI, contradicting the `GET /users` cut in section 4. Same reasoning: the principled discovery path is `find_user_by_email`, where the caller must already know the email.
- For products, a `resources/list` *would* be implementable (the catalogue is finite and small). Products could honestly be exposed via either primitive. The design choice was the **tool side** for two reasons: tool calls are explicit in the conversation history (the model is shown exactly when it asked for the catalogue, which is useful for both eval introspection and for the human reading along), and agents currently route tool calls more reliably than resource discovery via `resources/list` (a real trade-off given the eval suite asserts behaviour in this layer specifically). This is the one place in the doc where the resource primitive *could* have done equivalent work, and the choice is explicit rather than hidden.

### How resources compose with tools

The expected agent flow looks like:

```
user-message → tool calls → tool returns an id → agent fetches resource://id
                                                  → MCP server returns full record
```

Concrete example. The agent is asked *"summarise license `<UUID>`'s owner and product"*. The flow:

1. Tool call: `get_license(license_id)` returns the license record (including `user_id` and `product_id`).
2. Resource read: `user://{user_id}` — agent fetches the user's email.
3. Resource read: `product://{product_id}` — agent fetches the product's name.
4. Agent assembles the summary.

The same flow could have been a tool chain alone (`get_license` → `get_user` → `get_product`), but `get_user` and `get_product` were deliberately *not* exposed as tools (section 4 cuts). Resources are the right primitive: the agent is *fetching context for things it already has handles to*, not deciding which action to take.

### Why resources at all

A reviewer could reasonably ask: *if tools already cover discovery and action, and resources are only used for opportunistic re-fetch, why bother implementing the resource primitive at all?* Two answers:

1. **Tool budget.** Tools take up slots in the agent's tool list and add to the system prompt every turn. `get_user` / `get_product` as tools would inflate the tool count without adding capability the resource path doesn't already cover. Resources are loaded only when the agent needs them; they don't cost system-prompt real estate.
2. **The portfolio framing.** This doc commits to using all three MCP primitives deliberately (section 2 goals). Resources earn their place by being the right primitive for "fetch full state from an id" rather than by ticking a protocol-completeness box. The clean division — tools find and act, resources fetch context — is the design move worth defending.

## 6. Prompt Design

The MCP server exposes **one** prompt: `audit_user_licenses`. The decision to include any prompts at all (section 2) was that the third primitive should earn its inclusion rather than be skipped or padded. One prompt with real shape is the answer.

### The prompt

| Field         | Value                                                                                            |
|---------------|--------------------------------------------------------------------------------------------------|
| **Name**      | `audit_user_licenses`                                                                            |
| **Arguments** | `user_id` (uuid string)                                                                          |
| **Purpose**   | Standardise the shape of a license audit so reports generated from different conversations look consistent. |

The expanded prompt body the server returns:

> Produce a license audit for user `{user_id}`. Format the response as:
>
> 1. **User**: the user's email and id (use the `user://{user_id}` resource).
> 2. **Active licenses**: for each, list the product name, the `expires_at`, and whether it expires in the next 30 days (flag those separately at the top of this section).
> 3. **Revoked licenses**: a count, plus the most recent revocation if there is one.
> 4. **Expired licenses**: a count, plus the latest `expires_at` if any.
>
> Use the available tools (`list_user_licenses`, `list_products`) and resources to gather the data. Do not fabricate any field. If `user://{user_id}` returns `not_found`, say so and stop.

### Why this shape and not another

- **The template commits to the output contract, not the tool sequence.** It tells the agent what an audit deliverable looks like (sections 1–4) but trusts the agent to choose how to gather the data. This is where MCP prompts uniquely earn their inclusion: the agent could do the same audit ad hoc from a tool list, but the audit deliverables would vary in shape across conversations. The prompt fixes the shape.
- **A one-sentence template would underspecify the primitive.** "Audit this user" is something the agent could already produce from a tool list with no prompt. The reviewer reads such a template and wonders why the prompt exists at all.
- **A fully-prescribed tool sequence would over-specify.** Templates that hardcode "call tool A then tool B then tool C" remove the agent's judgement layer entirely, which contradicts the section-10 eval principle that we are explicitly testing agent reasoning and recovery. If the prompt is a script, what's the eval testing?

The output-contract level (sections, formatting, what to fabricate, what to do on `not_found`) is the right level: prescriptive about the *result*, permissive about the *path*.

### Why one prompt and not several

Two candidate additional prompts were considered and rejected:

- `prepare_revocation_summary(license_id)` — a pre-revocation read that gathers context before the destructive action. Rejected because it's a single-tool wrapper around `get_license` plus the linked resources; not enough shape to justify a separate prompt. The agent can do this from the tool list.
- `find_orphaned_licenses()` — find licenses whose user or product was deleted. Rejected because cascade deletes mean orphans cannot exist by construction; the prompt would always return an empty result and add zero value.

The line between "should be a prompt" and "the agent figures it out" is whether the workflow has a *recurring output contract* that benefits from being canonicalised. `audit_user_licenses` clears that bar; the candidates above don't.

## 7. Error Translation Policy

The backend returns structured errors as `{ error: "code", message: "human-readable", details?: {...} }`, designed to be read by a developer with a console open. The MCP layer translates these into agent-facing payloads that combine **both** a natural-language sentence and the original structured code. Two layers in one payload: the agent reads the sentence and decides what to do next; the eval suite (and any deterministic agent logic) branches on the code.

The natural-language sentence is **rewritten for the agent** rather than echoed from the backend's `message`. The backend's wording was written for a human admin reading a logfile; the MCP-side wording is written to tell the agent which action to consider next. This is the core design move of this section.

### Tool-error response shape

Every backend non-2xx response becomes an MCP tool result with `isError: true` and a single text content block. The text block has two paragraphs:

```
<natural-language sentence telling the agent what happened and what to do next>

{"error":"<backend_code>","details":{...}}
```

The agent reads the NL paragraph; the JSON line preserves the structured payload so:

- Eval cases can assert on `error` codes without parsing prose.
- Agent logic that wants to branch deterministically (rare but possible — e.g. the `audit_user_licenses` prompt deciding whether to skip a particular call) can do so.

Success responses are returned as normal MCP tool results with `isError: false` and a JSON-stringified content block.

### Error code → agent rewrite table

| Backend `error`              | HTTP | Reaches MCP via                          | Agent-facing rewrite                                                                                                                                                                                                                                            |
|------------------------------|------|------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `validation_error`           | 400  | Any tool with invalid arg shape          | "The tool arguments didn't pass the backend's validation. The fields that failed are listed in `details`. Correct them and retry. Common causes: a UUID argument was not a valid UUID string, or an `expires_at` was not a valid ISO 8601 datetime."             |
| `expires_at_in_past`         | 400  | `issue_license`                          | "The `expires_at` you provided is in the past. Re-read the human's request: if they said something relative like 'in 30 days', compute now + 30 days and retry; if they explicitly named a past date, ask them to clarify what they intended before issuing." |
| `not_found` (license)        | 404  | `get_license`, `validate_license`, `revoke_license` | "No license exists with that id. Either the id is wrong, or the license was cascade-deleted via its user or product. If you have a `user_id`, re-discover via `list_user_licenses`."                                                                              |
| `not_found` (user)           | 404  | `list_user_licenses`, `list_user_active_products` | "No user exists with that id. If the human gave you an email, call `find_user_by_email` to resolve it. If you got the id from a previous tool call, the user may have been deleted in the meantime — re-check."                                                  |
| `not_found` (user or product)| 404  | `issue_license` (FK violation)           | "Either the `user_id` or `product_id` you provided doesn't exist. Re-check via `find_user_by_email` or `list_products` and retry."                                                                                                                                |
| `duplicate_active_license`   | 409  | `issue_license`                          | "This user already has an Active license for this product expiring at `{existing_expires_at}` (read from `details`). The new expiration is earlier or equal, so no replacement happened and the existing license is untouched. If the human wants to extend, compute a later `expires_at` and retry. If they want to *shorten* coverage, that's unusual — confirm with them before doing anything." |
| `license_not_active`         | 409  | `revoke_license`                         | "This license is already Revoked or Expired and cannot be revoked again. If the human's intent was to confirm the license is no longer active, tell them so — the goal state is already reached. Do not retry."                                                  |
| `internal_error`             | 500  | Any tool                                 | "The backend returned an unexpected internal error. No retry happened. Surface this to the human, include any reference id from the `details` field if present, and suggest they retry shortly or escalate to whoever operates the backend." |

`duplicate_email` (409) exists in the backend's error vocabulary but cannot reach the MCP layer because user creation is not exposed; it's omitted from the table.

### Network and backend-unavailability policy

When the MCP server fails to get an HTTP response from the backend at all (DNS error, connection refused, timeout, 5xx with no body), it returns a tool error with:

- **NL sentence:** "Could not reach the license-service backend (`{short reason}`). The backend may be down, restarting (Heroku Eco dynos can take ~15s to wake from sleep), or unreachable from this MCP server's network. Surface this to the human and offer to retry shortly."
- **Structured payload:** `{"error":"backend_unreachable","reason":"<short reason>"}`. `backend_unreachable` is an MCP-layer-only code; the backend never produces it.

The HTTP client uses:

- **30-second timeout** per request. The Heroku Eco dyno can take up to ~15s to wake from idle sleep, so a tight timeout would manufacture spurious failures. 30s is loose enough to ride out a cold start and tight enough that the agent doesn't hang indefinitely if the backend is wedged.
- **Exactly one retry on network errors only.** A second attempt after a 500ms delay covers transient DNS / TCP failures and the tail end of a cold-start. The MCP server does **not** retry on 4xx or 5xx responses from the backend; those are surfaced to the agent on the first attempt. The reasoning: 4xx is a client problem the agent must fix, and 5xx with a response body means the backend handled the request and chose to fail — retrying it could double-write.

### Why this design

The reviewer-facing argument is on three legs:

1. **Two layers is honest.** Pure passthrough hides the design surface ("you just relayed JSON"); pure natural-language strips information the eval suite needs. The two-layer payload makes the eval suite tractable without making the agent parse enums.
2. **The agent-facing sentence is written for the agent, not for the human admin.** It tells the model what *action* to consider next. That's the difference between an error message and a recovery hint.
3. **No silent retries on backend errors.** Retrying a 409 or 500 with a response body would either double-write or hide the real failure; the agent should see what the backend said and decide. Network errors are different — they're transient by nature, and one retry is the right amount.

## 8. Trust Model

### v1: pure delegation to the MCP client

Every tool — including the two destructive ones (`revoke_license`, and `issue_license` when it triggers a replacement under the duplicate-license policy) — executes as soon as the MCP client allows the call. The MCP server has no notion of a "current user" and no authority to confirm anything beyond what the client already confirmed.

In Claude Code's case, the client's per-tool "allow / always allow / deny" prompt is the human confirmation gate. The server trusts that gate.

### Why delegation rather than server-side confirmation

Two designs were considered and rejected:

1. **A `propose_*` / `confirm_*` two-step tool pair** for destructive operations. Replace `revoke_license(license_id)` with `propose_revocation(license_id)` returning a token, plus `confirm_revocation(token)` that actually mutates. Rejected because it duplicates the client's existing per-tool prompt: the human gets asked twice for the same action, once by the client and once by the agent. That's friction for no security gain.
2. **A soft-warning post-action response.** Tool executes; response includes "this revoked license X, confirm with the human that this was intended." Rejected because the destructive action has already happened. A post-hoc warning is an apology, not a confirmation.

Pure delegation is the right v1 answer because:

- The inner-framing client *is* Claude Code, which does prompt the human per tool.
- The backend is identity-agnostic by design (DESIGN.md section 8), and the MCP server matches that stance. Auth, confirmation, and audit are higher-layer concerns; v1's higher layer is the MCP client.
- Adding a server-side confirmation step would commit to a security model that v1 isn't otherwise modelling. Half-implementing trust is worse than honestly delegating it.

### The eval suite bypasses the gate, by design

The eval suite (section 10) drives the agent loop via the Anthropic SDK directly, not via Claude Code. The SDK has no per-tool human-in-the-loop prompt; destructive tool calls execute without a confirmation step. This means the "client's prompt is the gate" argument above does not hold inside the eval context.

This is acknowledged rather than fixed because evals run against an **isolated eval database** that is created fresh and truncated between cases (see section 10's harness architecture). The destructive operations are still scoped to data the eval suite seeded for that case, and that data is wiped before the next case begins. The trust model for the eval context is therefore "isolated environment," not "human confirmation per call." Production would never run agents against a real database without a confirmation gate; v1's evals can because the database they touch is part of the test harness.

### What this delegates *to*, in practice

| Concern                                        | v1 lives at      | The doc honestly says                            |
|------------------------------------------------|------------------|--------------------------------------------------|
| Per-tool "are you sure?" prompt to the human   | MCP client       | Delegated.                                       |
| Identity binding (who is this agent acting as) | Nobody           | There is no agent identity in v1.                |
| Audit log of mutating tool calls               | Backend logs     | Backend logs every request; no MCP-side ledger.  |
| Rate limiting                                  | Backend (if any) | Backend doesn't rate-limit either in v1.         |
| Tool descriptor integrity                      | Trust on first use | Client trusts the tool descriptors the server returns; no signing. |

### Production gap (full list in section 11)

The fact that v1 delegates everything is not an oversight; it's an explicit choice that matches the backend's design. Production would change every row in the table above — see section 11 for the full list. The most consequential change would be replacing pure delegation with MCP **elicitation requests** (the protocol's first-class human-in-the-loop primitive) for destructive operations, so the confirmation happens at the protocol layer rather than relying on each client to implement its own gate.

## 9. Identity Model

The MCP server has **no notion of a "current user."** Every tool that operates on user-scoped data accepts `user_id` as an explicit argument (or, in the case of `find_user_by_email`, an email which the server resolves to a `user_id`). There is no `me`, no `whoami`, no `current_user_id` convention. A tool like `list_user_licenses` requires an explicit `user_id` on every call.

This mirrors the backend's identity-agnostic design: every backend endpoint takes `user_id` as an explicit parameter rather than inferring it from auth (DESIGN.md, "Identity"). Mirroring the stance at the MCP layer keeps identity solved (or honestly unsolved) in exactly one place.

The MCP client supplies whatever identity context exists, through the natural-language references in the human's messages (*"look up alice@example.com"*, *"revoke Alice's Pro Plan license"*). The agent resolves those references via `find_user_by_email` and threads the resulting `user_id` through subsequent tool calls. The server itself holds no state between calls; if the agent loses track of which user it was operating on, the next tool call must re-resolve from scratch.

The trade-off is honest:

- **Cost**: every conversation that involves the same user repeatedly re-resolves the email → `user_id` lookup, and the agent has to thread the id explicitly across turns.
- **Benefit**: the server has no implicit context to leak or confuse. There is no "I forgot to switch user" failure mode; every tool call carries its full identity input. For a learning-project artifact whose security model is "delegate everything to the client," this is the right shape.

Production would replace this with an agent-identity layer — OAuth bound at MCP server startup, per-call identity headers to the backend, server-side authorisation policies — see section 11.

## 10. Evaluation Approach

The eval suite is the section that turns "I built an MCP server" into "I built an MCP server and verified it works correctly with agents." Most portfolio MCP servers have zero evals; this one has a small suite that asserts both tool-selection and failure-mode recovery.

### What is evaluated

Two things, in roughly equal weight:

1. **Tool selection.** Given a natural-language task, does the agent pick the correct tool(s) with correctly-shaped arguments derived from the task and prior tool results?
2. **Failure-mode recovery.** When a tool returns an error from the table in section 7, does the agent surface it to the human appropriately rather than retrying blindly, silently failing, or hallucinating success?

What is **not** evaluated:

- The natural-language phrasing of the agent's final response is asserted only loosely (via substring/regex containment), not exact-matched. Agents phrase things many ways; over-specifying the wording produces brittle tests.
- Latency, token counts, model-version-specific behaviour. These belong in a separate observability concern.
- The backend's own correctness; the integration suite in `tests/` already covers that.

### Harness architecture

The eval harness is implemented in TypeScript using the **Anthropic SDK directly** rather than driving Claude Code or any specific MCP client. The SDK is the right level of abstraction: the SDK *is* the agent loop, and the MCP server is the unit under test.

```
eval runner (vitest-style suite)
    │
    ├─ boots Fastify backend pointed at an isolated eval DB
    ├─ spawns the MCP server as a child process (stdio transport)
    ├─ opens an Anthropic SDK client with the MCP server's tools registered
    │
    └─ for each eval case:
         1. seed the eval DB to the case's pre-state
         2. send the case's natural-language task as a user message
         3. let the SDK drive the agent loop (tool calls → results → next turn)
         4. collect the full tool-call history + the agent's final message
         5. assert against the case's expectations
         6. truncate the eval DB
```

The eval DB and backend setup reuse the existing integration-test infrastructure (`tests/helpers/db.ts`, `buildServer`), so the database lifecycle is identical to the integration suite. The MCP server points at this in-process backend rather than the deployed Heroku instance, both for determinism and to avoid spending real Anthropic API budget on a backend that might be in a cold start.

### Case structure

Each case is a single record:

```ts
{
  name: string,
  preState: (db) => Promise<void>,        // seed any required rows
  prompt: string,                          // the user's natural-language task
  expectedToolCalls: Array<{
    name: string,                          // expected tool name (must match in order)
    argsMatch?: (args: unknown) => boolean // optional structural assertion on arguments
  }>,
  finalMessage?: RegExp,                   // optional regex check on the agent's last message
  cleanup?: (db) => Promise<void>          // optional teardown beyond the standard truncate
}
```

Assertions are layered:

- **Strict on tool calls.** The expected sequence of tool names is asserted in order. Argument shapes are asserted via `argsMatch` predicates rather than equality, because the agent may legitimately pass different `expires_at` strings for the "same" relative time.
- **Soft on prose.** The `finalMessage` regex (when present) checks for key concepts ("already revoked", "no user found", "expires at"), not full strings.

### Sampling, not retries: pass-rate per case

Agents are sampling processes; even at temperature 0 there is a small but non-zero run-to-run variation depending on model version and load. The naive "retry on failure up to N times" pattern hides regressions: a case passing 60% of the time gives ~94% success in 3 attempts and looks fine, but it's the kind of degradation an eval suite should *catch*, not mask.

Instead, each case is run **N=5 times per invocation** (configurable), and the runner reports a **pass rate** rather than a single pass/fail verdict. A single sample passes when all of the case's tool-call assertions and the final-message regex (if any) succeed; the pass rate is the fraction of samples that passed. A case is considered **regressed** if its pass rate drops below a threshold the case itself declares (default 80%). This makes the difference between "always passes" (5/5), "small regression" (3/5 — investigate), and "broken" (0/5) explicit instead of collapsed into one bit.

Temperature is pinned to 0. The 5-sample-per-case design isn't trying to compensate for sampling variability inside one case (temperature 0 mostly does that); it's there so the *reported number* is a sample-rate, not a single coin flip. Reporting 5/5 is a stronger statement than reporting 1/1.

Cost note: 12 cases × 5 samples = 60 agent runs per eval invocation. Each run is a multi-turn agent loop with tool calls, so token-per-run matters: input grows on every tool result because the full conversation context is resent, so a 5-turn case can land around 5–15k total tokens. Budget a few dollars per full eval invocation at current Sonnet pricing — order of magnitude, not pocket change. The harness records cost per run and aborts if a configured cap is exceeded (default: $5 per invocation, configurable), useful when iterating on the suite locally so a typo doesn't accidentally run hundreds of cases.

### The case list (representative, ~12 cases)

Grouped by what each case is testing.

**Tool-selection smoke (4 cases)**

1. `find_user_by_email — happy path`. Prompt: *"Look up the user whose email is alice@example.com."* Expects: `find_user_by_email({email: "alice@example.com"})`. Final message references the user's id.
2. `list_products — happy path`. Prompt: *"What products do we offer?"* Expects: `list_products()`. Final message lists at least the seeded product names.
3. `list_user_licenses — happy path with email lookup`. Prompt: *"Show me everything alice@example.com has ever held."* Expects: `find_user_by_email` then `list_user_licenses`. Final message includes "active" / "revoked" / "expired" as relevant.
4. `validate_license — happy path`. Prompt: *"Is license <UUID> currently valid?"* Expects: `validate_license({license_id: ...})`. Final message says "yes" / "valid" / "active" or "no" / "invalid" depending on seeded state.

**Failure-mode recovery (6 cases)**

5. `expires_at_in_past surfaces correctly`. Prompt: *"Issue Alice a Pro Plan license expiring yesterday."* Expects: `find_user_by_email`, `list_products`, `issue_license` (with a past `expires_at`), then **either** asks the human to clarify the date **or** retries with a future date. Asserts the agent does *not* fail silently. Final message references the past-date issue.
6. `duplicate_active_license — rejection surfaced, not retried`. Pre-state: Alice has an Active Pro Plan license expiring 2027-12-31. Prompt: *"Issue Alice a Pro Plan license expiring in 30 days."* Expects: `issue_license` with new earlier expiration; the error returns; the agent **does not** call `issue_license` again. Final message explains the user already has later coverage.
7. `duplicate_active_license — replacement happy path`. Pre-state: Alice has an Active Pro Plan license expiring in 5 days. Prompt: *"Extend Alice's Pro Plan license to expire in 90 days."* Expects: `issue_license` succeeds (replacement). Final message confirms the new expiration and notes the old license was superseded.
8. `license_not_active — already terminal`. Pre-state: a Revoked license. Prompt: *"Revoke license <UUID>."* Expects: `revoke_license` returns `license_not_active`; the agent **does not** retry, and the final message tells the human the license is already terminal.
9. `not_found — bogus license id`. Prompt: *"Validate license 00000000-0000-0000-0000-000000000000."* Expects: `validate_license` returns `not_found`; final message says the license doesn't exist.
10. `find_user_by_email — null match`. Prompt: *"Look up user nonexistent@example.com."* Expects: `find_user_by_email` returns `{user: null}`; the agent does **not** invent a user_id or call further tools; final message tells the human no user was found.

**Multi-step workflows (2 cases)**

11. `audit_user_licenses workflow`. Prompt: *"Give me a complete audit of alice@example.com's license history, flag anything expiring in the next 30 days."* Pre-state: Alice has 2 active (one expiring in 15 days, one in 200 days), 1 revoked, 1 expired. Expects: `find_user_by_email` → `list_user_licenses` → final message that (a) categorises by status, (b) explicitly flags the 15-day license. No mutation tools called.
12. `revoke selected licenses workflow`. Prompt: *"Revoke any of Alice's active licenses that expire in the next 7 days."* Pre-state: Alice has 3 Active licenses, one of which expires in 3 days. Expects: `find_user_by_email` → `list_user_licenses` → `revoke_license` on **exactly one** id (the 3-day one) → final message describes what was revoked and what was left alone. The single-revoke assertion catches the "revoked everything in sight" failure mode.

Each case lives in `mcp/evals/cases/` as a small record; the runner in `mcp/evals/run.ts` iterates over them. The 12 cases listed inline are the canon; the full suite in the directory can grow over time without churning this document.

### CI integration

The eval suite is **not** part of the main CI workflow. Reasons:

- Each case spends real Anthropic API budget on real model calls. Running the suite on every push and PR is wasteful and racks up costs.
- Eval failures are sometimes flaky (agent sampling) and would create noise in the main signal of "did the code compile, lint, typecheck, and pass deterministic tests."

Instead:

- The suite is **run manually** via `npm run eval` from the `mcp/` package, against a developer-local backend.
- A future GitHub Actions workflow can run it **on a schedule** (e.g. weekly) or **on PRs labelled `run-evals`**, gated on an `ANTHROPIC_API_KEY` secret. This isn't part of v1.

### Why this design

- **Failure-mode coverage is the differentiator.** Smoke tests prove the wiring works; failure-mode tests prove the *design* works. The error-translation table in section 7 makes specific claims about agent behaviour after each error code; the eval suite is what lets those claims be checked rather than assumed.
- **The two multi-step cases earn more than their weight.** They turn the suite from "tool-by-tool unit tests" into "small integration tests of agent workflows." Errors that compound across a chain (agent forgets an id, agent invents an id, agent retries the wrong tool) only surface in multi-step contexts.
- **Loose prose assertions, strict tool assertions.** Agents phrase final responses many ways; over-specifying produces brittle tests that fail on Claude-model upgrades for no useful reason. Tool calls are programmatic and stable; assertions there catch real regressions.
- **Out of main CI for honesty.** Putting an LLM-budget-consuming, occasionally-flaky suite into the default push gate creates a "skip CI" culture and burns money. Manual / scheduled is the right home for evals at this scope.

## 11. What I'd Do Differently in Production

The production gaps cluster around one theme: this server is intentionally minimal so the design surface stays visible. Production hardening would touch every section above.

- **Auth and agent identity.** v1 has none (sections 8, 9). Production would bind an OAuth flow at MCP server startup, scope tool capabilities to the authenticated agent, and route every backend call with a per-agent identity header. The backend would gate cross-user operations on an admin role; the MCP server would surface tool errors when the agent attempts something its identity doesn't grant.

- **Server-side confirmation for destructive operations** via MCP **elicitation requests** (the protocol's first-class human-in-the-loop primitive), not a `propose_*` / `confirm_*` tool pair. v1 delegates this to the client; production should not assume every client implements a confirmation prompt.

- **Rate limiting per agent identity.** v1 has none. Production would bound tool calls per agent per minute, especially on `validate_license` (the hot path) and `issue_license` (the only write path), to contain runaway agent loops.

- **Tool descriptor signing.** A known MCP attack vector: a malicious server can expose `revoke_license` with a description that hides destructive semantics. Production would sign tool descriptors so the client can verify they match a known-good version before exposing them to the agent.

- **Structured audit logging.** v1 logs via stdio to the host. Production would emit structured tool-call traces (input, output, latency, outcome, model id) to a durable store, both for compliance and for replaying failed agent interactions when debugging.

- **Observability.** Token usage per tool call, tool latency, error rates by error code, model-version distribution. v1 has none; production would surface these as Prometheus metrics (matching the backend's pattern) or via a vendor-specific agent observability tool.

- **Multi-tenant deployment model.** v1 is single-user, local-only. Production has a choice: per-user MCP server instances (process-per-user isolation, expensive at scale) or a shared server with per-request agent identity (cheaper but requires careful state isolation). Either approach makes the auth and rate-limiting items non-optional.

- **Eval suite in CI.** Section 10 explicitly keeps evals out of the default CI gate (cost, sampling-flakiness). Production would run a budget-bounded subset on every PR that touches `mcp/`, and the full suite on a schedule, with per-case failure budgets that distinguish "agent regressed" from "model upgraded."

- **Backend client robustness.** v1 uses `fetch` with one retry on network errors and a 30-second timeout. Production would add circuit-breaking (open the breaker after N consecutive backend errors so a wedged backend doesn't pin every agent conversation), structured request ids for correlation with backend logs, and a configurable per-tool timeout (the audit prompt's `list_user_licenses` for a heavy-user user might need more headroom than `find_user_by_email`).

- **Richer error response shape.** v1's two-layer payload (NL paragraph + JSON line, section 7) is good for an agent reading text. Production could move to a richer MCP protocol-level error response that distinguishes recoverable (retry, ask human) from non-recoverable (abort, surface) failures more explicitly than the boolean `isError` flag.

- **Tool surface evolution.** v1 cuts user/product CRUD and cross-user listings (section 4). Production with admin auth could expose those tools to admin-scoped agents specifically, while keeping the same tools hidden from customer-facing agents. The cuts in v1 are not about capability; they're about not handing capability to identities the system can't verify.
