/**
 * Failure-mode case 5 from MCP_DESIGN.md section 10.
 *
 * Goal: the agent surfaces the past-date problem rather than failing silently.
 * Two equally acceptable agent shapes:
 *   (a) Call issue_license, get the 400, then ask or retry with a future date.
 *   (b) Anticipate the problem (the prompt literally says "yesterday") and
 *       ask for clarification before calling issue_license at all.
 *
 * Sonnet 4.6 takes branch (b) reliably in this scenario — it sees "yesterday"
 * and asks before burning a backend round-trip on a known-bad call. The
 * eval's expected sequence therefore covers only the context-gathering calls
 * (find_user_by_email + list_products) and leans on the finalMessage regex
 * to confirm the date issue was actually surfaced.
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
  ],

  // The agent's final message must reference the date problem somehow —
  // either by naming it ("past", "yesterday", "future") or by asking for
  // clarification. Silent retries with no acknowledgement should fail this.
  finalMessage: /(past|yesterday|future|expir|clarif|invalid|date)/i,
};
