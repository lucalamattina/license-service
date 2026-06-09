/**
 * Failure-mode case 5 from MCP_DESIGN.md section 10.
 *
 * Goal: the agent attempts `issue_license` with a past `expires_at`, the
 * backend rejects with `expires_at_in_past`, and the agent surfaces the
 * problem (either asks for clarification, or retries with a future date).
 * Either branch is acceptable — what's not acceptable is silent failure.
 *
 * We assert the initial 3-call prefix (discover user, list products, attempt
 * issue) and leave the prefix open-ended so a retry chain doesn't fail the
 * test.
 */

import type { EvalCase } from '../types.js';
import {
  createProduct,
  createUser,
  deleteProductsByNames,
  deleteUserIfExists,
} from '../seed.js';

const SEED_EMAIL = 'eval-expires-past@example.com';
const SEED_PRODUCT = 'EvalExpiresPastProPlan';

export const expiresAtInPast: EvalCase = {
  name: 'expires_at_in_past — surfaces correctly',

  // "Yesterday" is the design-doc canonical phrasing; it forces a past date.
  prompt: `Issue ${SEED_EMAIL} a ${SEED_PRODUCT} license expiring yesterday.`,

  preState: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, [SEED_PRODUCT]);
    await createUser(baseUrl, SEED_EMAIL);
    await createProduct(baseUrl, SEED_PRODUCT);
  },

  cleanup: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, [SEED_PRODUCT]);
  },

  expectedToolCalls: [
    {
      name: 'find_user_by_email',
      argsMatch: (args) =>
        typeof args === 'object' &&
        args !== null &&
        (args as { email?: string }).email === SEED_EMAIL,
    },
    { name: 'list_products' },
    { name: 'issue_license' },
  ],

  // The agent's final message must reference the date problem somehow —
  // either by naming it ("past", "yesterday", "future") or by asking for
  // clarification. Silent retries with no acknowledgement should fail this.
  finalMessage: /(past|yesterday|future|expir|clarif|invalid|date)/i,
};
