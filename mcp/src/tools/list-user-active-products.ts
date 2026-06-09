/**
 * Read tool: returns the products the user CURRENTLY has an Active license for.
 *
 * This is the "right now" view (DESIGN.md listing-semantics rule): revoked
 * and expired licenses are excluded. Pair with `list_user_licenses` for the
 * historical view.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BackendCallError, type BackendClient } from '../backend-client.js';
import { translateBackendError } from '../error-translation.js';
import { toolError, toolSuccess } from '../tool-result.js';

export const TOOL_NAME = 'list_user_active_products';

export const DESCRIPTION =
  "Returns the products the user currently has an Active license for. Returns " +
  "{ products: [{ id, name }] }. This is a \"right now\" view: revoked and expired " +
  "licenses are excluded. Use this for \"what does the user have access to today\" " +
  "questions; use list_user_licenses for full historical audit.";

export const inputSchema = {
  user_id: z.uuid(),
};

interface ProductListEnvelope {
  data: { id: string; name: string }[];
}

export async function handler(
  args: { user_id: string },
  deps: { backend: BackendClient },
): Promise<CallToolResult> {
  try {
    const result = await deps.backend.get<ProductListEnvelope>(
      `/users/${args.user_id}/products`,
    );
    return toolSuccess({ products: result.data });
  } catch (err) {
    if (err instanceof BackendCallError) {
      return toolError(translateBackendError(err.detail, { notFoundVariant: 'user' }));
    }
    throw err;
  }
}
