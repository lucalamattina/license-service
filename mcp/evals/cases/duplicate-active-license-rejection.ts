/**
 * Failure-mode case 6 from MCP_DESIGN.md section 10.
 *
 * Goal: the user already has an active license that expires LATER than what
 * was requested. The backend rejects with `duplicate_active_license` and the
 * agent must **not** retry — the design's error-translation rewrite for this
 * code deliberately discourages retry. A naive agent might try again with
 * different args; we cap `issue_license` at 1 to catch that.
 */

import type { EvalCase } from '../types.js';
import {
  createLicense,
  createProduct,
  createUser,
  deleteProductsByNames,
  deleteUserIfExists,
  futureIso,
} from '../seed.js';

const SEED_EMAIL = 'eval-dup-rejection@example.com';
const SEED_PRODUCT = 'EvalDupRejectionProPlan';

export const duplicateActiveLicenseRejection: EvalCase = {
  name: 'duplicate_active_license — rejection surfaced, not retried',

  prompt: `Issue ${SEED_EMAIL} a ${SEED_PRODUCT} license expiring in 30 days.`,

  preState: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, [SEED_PRODUCT]);
    const user = await createUser(baseUrl, SEED_EMAIL);
    const product = await createProduct(baseUrl, SEED_PRODUCT);
    // Existing coverage stretches well past the requested 30 days — so the new
    // license would be a regression and the backend rejects.
    await createLicense(baseUrl, {
      user_id: user.id,
      product_id: product.id,
      expires_at: futureIso(365 * 2),
    });
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

  // The retry guard: a second issue_license attempt is the failure mode.
  maxCallsByTool: { issue_license: 1 },

  // The agent should explain that later coverage exists rather than just
  // saying "it failed."
  finalMessage: /(already|existing|active|later|cover|2027|year|expir)/i,
};
