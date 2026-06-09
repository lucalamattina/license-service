/**
 * Action tool: issues a new Active license to a user for a specific product.
 *
 * The headline behaviour is the duplicate-license replacement policy
 * (DESIGN.md): the backend either replaces an existing Active license
 * (if `expires_at` is strictly later), or rejects with `duplicate_active_license`.
 * The tool's job is to surface the backend's verdict; the policy itself lives
 * in the backend's transaction.
 *
 * Error variants the agent will see:
 *   - `expires_at_in_past` (400): agent should re-read the human's request.
 *   - `duplicate_active_license` (409): backend has equal-or-later coverage;
 *     the existing license's expires_at is in `details`.
 *   - `not_found` (404): either user_id or product_id doesn't exist (FK
 *     violation). Routed through the 'user-or-product' translation variant.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BackendCallError, type BackendClient } from '../backend-client.js';
import { translateBackendError } from '../error-translation.js';
import { toolError, toolSuccess } from '../tool-result.js';

export const TOOL_NAME = 'issue_license';

export const DESCRIPTION =
  "Issues a new Active license to a user for a specific product, expiring at the given " +
  "timestamp. expires_at must be ISO 8601 and strictly in the future; if the human gives a " +
  "relative time (\"in 30 days\"), compute the timestamp yourself. " +
  "**Duplicate-license policy:** if the user already holds an Active license for this " +
  "product, the new license replaces the old one **only if** expires_at is strictly later " +
  "(the old becomes Revoked, the new is Active). If expires_at is earlier or equal, the " +
  "request fails with duplicate_active_license and the existing license is untouched. " +
  "Revoked or Expired existing licenses for the same product do **not** block issuance.";

export const inputSchema = {
  user_id: z.uuid(),
  product_id: z.uuid(),
  expires_at: z.iso.datetime(),
};

interface IssueLicenseArgs {
  user_id: string;
  product_id: string;
  expires_at: string;
}

interface LicenseRecord {
  id: string;
  status: 'active' | 'expired' | 'revoked';
  created_at: string;
  expires_at: string;
  user_id: string;
  product_id: string;
}

export async function handler(
  args: IssueLicenseArgs,
  deps: { backend: BackendClient },
): Promise<CallToolResult> {
  try {
    const result = await deps.backend.post<LicenseRecord>('/licenses', {
      user_id: args.user_id,
      product_id: args.product_id,
      expires_at: args.expires_at,
    });
    return toolSuccess(result);
  } catch (err) {
    if (err instanceof BackendCallError) {
      // FK violation on user_id or product_id returns 404 with not_found;
      // route through the variant that mentions both possibilities.
      return toolError(
        translateBackendError(err.detail, { notFoundVariant: 'user-or-product' }),
      );
    }
    throw err;
  }
}
