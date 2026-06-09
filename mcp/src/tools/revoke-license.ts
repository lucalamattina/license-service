/**
 * Action tool: transitions an Active license to Revoked.
 *
 * The agent-appropriate way to "end" a license. Hard-deletion of licenses is
 * deliberately not exposed (DESIGN.md section 4 cuts) — revocation preserves
 * the audit trail.
 *
 * Error variants the agent will see:
 *   - `license_not_active` (409): the license is already Revoked or Expired.
 *     The section-7 rewrite is explicit that no retry should happen.
 *   - `not_found` (404): no license with that id. 'license' translation variant.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BackendCallError, type BackendClient } from '../backend-client.js';
import { translateBackendError } from '../error-translation.js';
import { toolError, toolSuccess } from '../tool-result.js';

export const TOOL_NAME = 'revoke_license';

export const DESCRIPTION =
  "Revokes an Active license, transitioning it to status: revoked and preserving the row " +
  "in the database (no hard delete). Returns the updated record. Only Active licenses can " +
  "be revoked: re-revoking a Revoked license, or revoking an Expired license, fails with " +
  "license_not_active. Use this to \"end\" a license; if you want to extend or upgrade " +
  "instead, call issue_license with a later expires_at (the duplicate-license policy will " +
  "handle the swap).";

export const inputSchema = {
  license_id: z.uuid(),
};

interface LicenseRecord {
  id: string;
  status: 'active' | 'expired' | 'revoked';
  created_at: string;
  expires_at: string;
  user_id: string;
  product_id: string;
}

export async function handler(
  args: { license_id: string },
  deps: { backend: BackendClient },
): Promise<CallToolResult> {
  try {
    const result = await deps.backend.post<LicenseRecord>(
      `/licenses/${args.license_id}/revoke`,
      {},
    );
    return toolSuccess(result);
  } catch (err) {
    if (err instanceof BackendCallError) {
      return toolError(translateBackendError(err.detail, { notFoundVariant: 'license' }));
    }
    throw err;
  }
}
