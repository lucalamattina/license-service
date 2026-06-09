/**
 * Failure-mode case 10 from MCP_DESIGN.md section 10.
 *
 * Goal: the lookup returns `{user: null}` (which is a successful response per
 * the design's find-semantics) and the agent must NOT chain into any further
 * tool call. A naive agent might invent a `user_id` and continue; we forbid
 * every other tool to catch that.
 *
 * The email chosen is reserved and very unlikely to clash with any real
 * seeded data. preState scrubs it defensively in case a previous run inserted
 * it for some reason.
 */

import type { EvalCase } from '../types.js';
import { deleteUserIfExists } from '../seed.js';

const NONEXISTENT_EMAIL = 'eval-nonexistent-do-not-create@example.com';

export const findUserByEmailNullMatch: EvalCase = {
  name: 'find_user_by_email — null match',

  prompt: `Look up user ${NONEXISTENT_EMAIL}.`,

  preState: async (baseUrl) => {
    // Defensive scrub — if the email somehow exists, the case becomes invalid.
    await deleteUserIfExists(baseUrl, NONEXISTENT_EMAIL);
  },

  cleanup: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, NONEXISTENT_EMAIL);
  },

  expectedToolCalls: [
    {
      name: 'find_user_by_email',
      argsMatch: (args) =>
        typeof args === 'object' &&
        args !== null &&
        (args as { email?: string }).email === NONEXISTENT_EMAIL,
    },
  ],

  // After a null match, the agent must not chain into anything else. Every
  // other tool is forbidden — the failure mode is the agent inventing a
  // user id and continuing.
  forbiddenTools: [
    'list_products',
    'get_license',
    'list_user_licenses',
    'list_user_active_products',
    'validate_license',
    'issue_license',
    'revoke_license',
  ],

  // The final message must tell the human no user matched.
  finalMessage: /(no user|not found|doesn'?t exist|no match|no such)/i,
};
