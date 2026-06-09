/**
 * Translates a `BackendError` from `backend-client.ts` into the two-layer
 * agent-facing payload defined in MCP_DESIGN.md section 7.
 *
 * Two layers in one return value:
 *   - `naturalLanguage`: a sentence written for the agent (not for a human
 *     reading a logfile). Tells the agent what happened and what to consider
 *     next. Verbatim from the section-7 rewrite table.
 *   - `structured`: the backend's `error` code plus its `details`. Preserved
 *     so eval cases and any deterministic agent logic can branch on the code.
 *
 * The `tool-result.ts` helper renders both layers into the single text content
 * block the MCP protocol expects.
 */

import type { BackendError } from './backend-client.js';

export interface TranslatedError {
  naturalLanguage: string;
  structured: {
    error: string;
    details?: unknown;
  };
}

/**
 * Which "shape" of `not_found` the caller wants. Three of the section-7 table's
 * rows are `not_found` and they read differently depending on which resource
 * was missed; tools opt in to the right variant.
 */
export type NotFoundVariant = 'license' | 'user' | 'user-or-product';

export interface TranslateOptions {
  /** Required when the backend returns `not_found`; tools must pick the right rewrite. */
  notFoundVariant?: NotFoundVariant;
}

export function translateBackendError(
  err: BackendError,
  opts: TranslateOptions = {},
): TranslatedError {
  if (err.kind === 'network_error') {
    return {
      naturalLanguage:
        `Could not reach the license-service backend (${err.reason}). The backend may be down, ` +
        `restarting (Heroku Eco dynos can take ~15s to wake from sleep), or unreachable from this ` +
        `MCP server's network. Surface this to the human and offer to retry shortly.`,
      structured: { error: 'backend_unreachable', details: { reason: err.reason } },
    };
  }

  const { body } = err;
  const code = body.error;

  switch (code) {
    case 'validation_error':
      return {
        naturalLanguage:
          `The tool arguments didn't pass the backend's validation. The fields that failed are ` +
          `listed in details. Correct them and retry. Common causes: a UUID argument was not a ` +
          `valid UUID string, or an expires_at was not a valid ISO 8601 datetime.`,
        structured: { error: code, details: body.details },
      };

    case 'expires_at_in_past':
      return {
        naturalLanguage:
          `The expires_at you provided is in the past. Re-read the human's request: if they said ` +
          `something relative like 'in 30 days', compute now + 30 days and retry; if they ` +
          `explicitly named a past date, ask them to clarify what they intended before issuing.`,
        structured: { error: code },
      };

    case 'not_found':
      return translateNotFound(opts.notFoundVariant ?? 'license');

    case 'duplicate_active_license':
      return {
        naturalLanguage:
          `This user already has an Active license for this product expiring at the timestamp in ` +
          `the details. The new expiration is earlier or equal, so no replacement happened and the ` +
          `existing license is untouched. If the human wants to extend, compute a later expires_at ` +
          `and retry. If they want to shorten coverage, that's unusual — confirm with them before ` +
          `doing anything.`,
        structured: { error: code, details: body.details },
      };

    case 'license_not_active':
      return {
        naturalLanguage:
          `This license is already Revoked or Expired and cannot be revoked again. If the human's ` +
          `intent was to confirm the license is no longer active, tell them so — the goal state is ` +
          `already reached. Do not retry.`,
        structured: { error: code },
      };

    case 'internal_error':
      return {
        naturalLanguage:
          `The backend returned an unexpected internal error. No retry happened. Surface this to ` +
          `the human, include any reference id from the details field if present, and suggest they ` +
          `retry shortly or escalate to whoever operates the backend.`,
        structured: { error: code, details: body.details },
      };

    default:
      // The backend introduced a new error code we haven't translated yet.
      // Surface as internal_error so the agent at least sees something coherent.
      return {
        naturalLanguage:
          `The backend returned an error code (${code}) the MCP layer does not have a translation ` +
          `for. The original backend message is in the details. Surface this to the human as an ` +
          `unexpected error and suggest they escalate.`,
        structured: {
          error: 'internal_error',
          details: { unmappedBackendCode: code, originalMessage: body.message },
        },
      };
  }
}

function translateNotFound(variant: NotFoundVariant): TranslatedError {
  switch (variant) {
    case 'license':
      return {
        naturalLanguage:
          `No license exists with that id. Either the id is wrong, or the license was cascade-` +
          `deleted via its user or product. If you have a user_id, re-discover via list_user_licenses.`,
        structured: { error: 'not_found' },
      };
    case 'user':
      return {
        naturalLanguage:
          `No user exists with that id. If the human gave you an email, call find_user_by_email to ` +
          `resolve it. If you got the id from a previous tool call, the user may have been deleted ` +
          `in the meantime — re-check.`,
        structured: { error: 'not_found' },
      };
    case 'user-or-product':
      return {
        naturalLanguage:
          `Either the user_id or product_id you provided doesn't exist. Re-check via ` +
          `find_user_by_email or list_products and retry.`,
        structured: { error: 'not_found' },
      };
  }
}
