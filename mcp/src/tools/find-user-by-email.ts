/**
 * Discovery tool: resolves an email to a `user_id`. Direct passthrough to the
 * backend's `GET /users/by-email?email=...` endpoint, which returns 200 with
 * `{ user: null }` on no match (not a 404). This tool inherits that "find
 * semantics": "no user with that email" is a successful empty result, not a
 * tool error.
 *
 * Description text is exported as a constant; the registration in `tools/index.ts`
 * reads it from here, and the design-doc section 4 mirrors it. Keeping the
 * canonical text in code means it can't drift undetected.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BackendCallError, type BackendClient } from '../backend-client.js';
import { translateBackendError } from '../error-translation.js';
import { toolError, toolSuccess } from '../tool-result.js';

export const TOOL_NAME = 'find_user_by_email';

export const DESCRIPTION =
  'Looks up a user by email address. Email matching is case-insensitive (the backend ' +
  'normalises emails to lowercase on both write and read). Returns { user: { id, email } } ' +
  'if found, or { user: null } if no user has that email. Use this as the entry point when ' +
  'the human references a user by email; the returned user.id is what every other ' +
  'user-scoped tool requires.';

export const inputSchema = {
  email: z.email(),
};

interface ByEmailResponse {
  user: { id: string; email: string } | null;
}

export async function handler(
  args: { email: string },
  deps: { backend: BackendClient },
): Promise<CallToolResult> {
  try {
    const result = await deps.backend.get<ByEmailResponse>(
      `/users/by-email?email=${encodeURIComponent(args.email)}`,
    );
    return toolSuccess(result);
  } catch (err) {
    if (err instanceof BackendCallError) {
      return toolError(translateBackendError(err.detail));
    }
    throw err;
  }
}
