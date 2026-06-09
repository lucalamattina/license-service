/**
 * Resource templates for the MCP server.
 *
 * Three URI templates, all `resources/read` only — no `resources/list`.
 * The `list: undefined` on each `ResourceTemplate` is what opts out (per the
 * SDK's API, you must explicitly pass `undefined` so you can't accidentally
 * forget). The design rationale lives in MCP_DESIGN.md section 5.
 *
 * Error handling: resource reads can't return a tool-style `isError` payload,
 * so failures throw `McpError`. The natural-language sentence goes in the
 * `message` field; the structured payload (matching the section-7 shape) goes
 * in `data`. The translation pipeline from `error-translation.ts` is reused
 * unchanged.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BackendCallError, type BackendClient, type BackendError } from './backend-client.js';
import { translateBackendError, type NotFoundVariant } from './error-translation.js';

const uuidSchema = z.uuid();

function validateUuid(raw: unknown, fieldName: string): string {
  const parsed = uuidSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  throw new McpError(
    ErrorCode.InvalidParams,
    `The ${fieldName} in the resource URI is not a valid UUID. ` +
      `Resource URIs of the form license://{id}, user://{id}, product://{id} require a UUID after the scheme.`,
    {
      error: 'validation_error',
      details: { field: fieldName, value: String(raw) },
    },
  );
}

function backendErrorToMcpError(
  detail: BackendError,
  notFoundVariant: NotFoundVariant,
): McpError {
  const translated = translateBackendError(detail, { notFoundVariant });
  // not_found means "the id you supplied points at nothing" → InvalidParams.
  // Everything else (5xx, network) is on our side → InternalError.
  const isNotFound = detail.kind === 'backend_error' && detail.body.error === 'not_found';
  return new McpError(
    isNotFound ? ErrorCode.InvalidParams : ErrorCode.InternalError,
    translated.naturalLanguage,
    translated.structured,
  );
}

async function readBackendRecord<T>(
  uri: URL,
  backend: BackendClient,
  backendPath: string,
  notFoundVariant: NotFoundVariant,
): Promise<ReadResourceResult> {
  try {
    const record = await backend.get<T>(backendPath);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify(record),
        },
      ],
    };
  } catch (err) {
    if (err instanceof BackendCallError) {
      throw backendErrorToMcpError(err.detail, notFoundVariant);
    }
    throw err;
  }
}

export interface ResourceDeps {
  backend: BackendClient;
}

export function registerResources(server: McpServer, deps: ResourceDeps): void {
  // license://{license_id}
  server.registerResource(
    'license',
    new ResourceTemplate('license://{license_id}', { list: undefined }),
    {
      description:
        'A license record fetched by its UUID. Returns the full license JSON ' +
        '(id, status, created_at, expires_at, user_id, product_id).',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = validateUuid(variables.license_id, 'license_id');
      return readBackendRecord(uri, deps.backend, `/licenses/${id}`, 'license');
    },
  );

  // user://{user_id}
  server.registerResource(
    'user',
    new ResourceTemplate('user://{user_id}', { list: undefined }),
    {
      description: 'A user record fetched by its UUID. Returns the full user JSON (id, email).',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = validateUuid(variables.user_id, 'user_id');
      return readBackendRecord(uri, deps.backend, `/users/${id}`, 'user');
    },
  );

  // product://{product_id}
  server.registerResource(
    'product',
    new ResourceTemplate('product://{product_id}', { list: undefined }),
    {
      description:
        'A product record fetched by its UUID. Returns the full product JSON (id, name).',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = validateUuid(variables.product_id, 'product_id');
      // The backend's not-found wording for products is the generic "user-or-product"
      // variant because the only place not_found-on-product surfaces is the
      // issue-license FK violation. Standalone GET /products/:id 404 is rare
      // and acceptably-translated by either variant; pick 'user-or-product' so
      // the rewrite stays consistent with the issuance flow.
      return readBackendRecord(uri, deps.backend, `/products/${id}`, 'user-or-product');
    },
  );
}
