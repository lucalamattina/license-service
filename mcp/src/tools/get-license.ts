/**
 * Read tool: fetches a license by id without mutating its state.
 *
 * Distinct from `validate_license` in the design doc (section 4): this is the
 * pure-read variant. If the caller wants to know whether the license is
 * currently valid (which can transition Active→Expired as a side effect),
 * they should use `validate_license` instead.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BackendCallError, type BackendClient } from '../backend-client.js';
import { translateBackendError } from '../error-translation.js';
import { toolError, toolSuccess } from '../tool-result.js';

export const TOOL_NAME = 'get_license';

export const DESCRIPTION =
  "Fetches a license by id without mutating its state. Returns the full license record " +
  "{ id, status, created_at, expires_at, user_id, product_id }. Use this when you need to " +
  "inspect a license's metadata (owner, product, dates, status) without checking its current " +
  "validity. If you specifically want to know whether the license is currently valid, use " +
  "validate_license instead — it auto-transitions expired-but-still-active licenses inside " +
  "the same transaction.";

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
    const result = await deps.backend.get<LicenseRecord>(`/licenses/${args.license_id}`);
    return toolSuccess(result);
  } catch (err) {
    if (err instanceof BackendCallError) {
      return toolError(translateBackendError(err.detail, { notFoundVariant: 'license' }));
    }
    throw err;
  }
}
