/**
 * Read tool: returns every license a user has ever held, in every status
 * (active, expired, revoked).
 *
 * Backend listing-semantics distinction (DESIGN.md): this endpoint returns
 * the historical view (all statuses); pair it with `list_user_active_products`
 * for the "right now" view that filters to Active only.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BackendCallError, type BackendClient } from '../backend-client.js';
import { translateBackendError } from '../error-translation.js';
import { toolError, toolSuccess } from '../tool-result.js';

export const TOOL_NAME = 'list_user_licenses';

export const DESCRIPTION =
  "Returns every license a user has ever held for any product, in any status " +
  "(active, expired, revoked). Returns { licenses: [...] }. Use this for audit-style " +
  "\"show me everything\" workflows. If you only care about products the user can currently " +
  "use, call list_user_active_products instead — it's a \"right now\" view that excludes " +
  "revoked and expired licenses.";

export const inputSchema = {
  user_id: z.uuid(),
};

interface LicenseRecord {
  id: string;
  status: 'active' | 'expired' | 'revoked';
  created_at: string;
  expires_at: string;
  user_id: string;
  product_id: string;
}

interface LicenseListEnvelope {
  data: LicenseRecord[];
}

export async function handler(
  args: { user_id: string },
  deps: { backend: BackendClient },
): Promise<CallToolResult> {
  try {
    const result = await deps.backend.get<LicenseListEnvelope>(
      `/users/${args.user_id}/licenses`,
    );
    return toolSuccess({ licenses: result.data });
  } catch (err) {
    if (err instanceof BackendCallError) {
      return toolError(translateBackendError(err.detail, { notFoundVariant: 'user' }));
    }
    throw err;
  }
}
