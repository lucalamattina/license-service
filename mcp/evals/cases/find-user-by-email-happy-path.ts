/**
 * Smoke case 1 from MCP_DESIGN.md section 10.
 *
 * Goal: the agent picks `find_user_by_email` when given an email, and surfaces
 * something user-facing about the lookup. The final-message check is
 * deliberately loose (any of "found", "user", "id", or a UUID) because the
 * agent's natural-language phrasing varies across runs.
 */

import type { EvalCase } from '../types.js';
import { createUser, deleteUserIfExists } from '../seed.js';

const SEED_EMAIL = 'eval-find-user-happy@example.com';

export const findUserByEmailHappyPath: EvalCase = {
  name: 'find_user_by_email — happy path',

  prompt: `Look up the user whose email is ${SEED_EMAIL}.`,

  preState: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await createUser(baseUrl, SEED_EMAIL);
  },

  cleanup: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
  },

  expectedToolCalls: [
    {
      name: 'find_user_by_email',
      argsMatch: (args) =>
        typeof args === 'object' &&
        args !== null &&
        (args as { email?: string }).email === SEED_EMAIL,
    },
  ],

  // Match any UUID-shape token (the user id) or a confirming verb.
  finalMessage: /(found|exists|user|[0-9a-f]{8}-[0-9a-f]{4})/i,
};
