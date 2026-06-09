/**
 * Read-with-side-effect tool: checks whether a license is currently valid.
 *
 * If the license is Active but past its `expires_at`, the backend atomically
 * transitions it to Expired inside the same transaction and returns
 * `valid: false` with the updated record. This side effect is the design's
 * way of guaranteeing the caller always sees up-to-date state; the trade-off
 * is that this tool isn't safe for "pure read" use cases (use `get_license`
 * for that).
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BackendCallError, type BackendClient } from '../backend-client.js';
import { translateBackendError } from '../error-translation.js';
import { toolError, toolSuccess } from '../tool-result.js';

export const TOOL_NAME = 'validate_license';

export const DESCRIPTION =
  "Checks whether a license is currently valid. Returns { valid: boolean, license: {...} }. " +
  "If the license is active but past its expires_at, this call atomically transitions it to " +
  "expired inside the same database transaction and returns valid: false with the updated " +
  "record. Already-revoked or already-expired licenses are returned as-is with valid: false. " +
  "Note that this tool has a side effect on active-but-expired licenses; use get_license if " +
  "you want a pure read.";

export const inputSchema = {
  license_id: z.uuid(),
};

interface ValidateResponse {
  valid: boolean;
  license: {
    id: string;
    status: 'active' | 'expired' | 'revoked';
    created_at: string;
    expires_at: string;
    user_id: string;
    product_id: string;
  };
}

export async function handler(
  args: { license_id: string },
  deps: { backend: BackendClient },
): Promise<CallToolResult> {
  try {
    const result = await deps.backend.post<ValidateResponse>(
      `/licenses/${args.license_id}/validate`,
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
