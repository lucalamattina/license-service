/**
 * Discovery tool: returns the full product catalogue.
 *
 * The backend returns the list-envelope shape `{ data: [...] }` (matching the
 * envelope convention in DESIGN.md). This tool unwraps and re-keys to
 * `{ products: [...] }` because that's the shape the design doc commits to
 * for agents — the `data` key is REST-conventional but uninformative to an LLM.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BackendCallError, type BackendClient } from '../backend-client.js';
import { translateBackendError } from '../error-translation.js';
import { toolError, toolSuccess } from '../tool-result.js';

export const TOOL_NAME = 'list_products';

export const DESCRIPTION =
  'Returns the full product catalogue as { products: [{ id, name }] }. The catalogue is ' +
  'small (single-digit to low-double-digit entries), so this returns everything in one call. ' +
  'Use this when the human references a product by name and you need the product_id to pass ' +
  'to issue_license.';

interface ProductListEnvelope {
  data: { id: string; name: string }[];
}

export async function handler(
  _args: Record<string, never>,
  deps: { backend: BackendClient },
): Promise<CallToolResult> {
  try {
    const result = await deps.backend.get<ProductListEnvelope>('/products');
    return toolSuccess({ products: result.data });
  } catch (err) {
    if (err instanceof BackendCallError) {
      return toolError(translateBackendError(err.detail));
    }
    throw err;
  }
}
