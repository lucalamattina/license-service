/**
 * Failure-mode case 7 from MCP_DESIGN.md section 10.
 *
 * Goal: the user has an active license expiring SOON; the request extends it.
 * The backend treats this as a replacement (revokes the old, issues the new)
 * inside one transaction — see docs/algorithms/license-issuance.md. From the
 * agent's perspective `issue_license` returns success on a single call.
 *
 * This case exists alongside the rejection case because the two together
 * exercise both branches of the duplicate-active-license decision.
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

const SEED_EMAIL = 'eval-dup-replace@example.com';
const SEED_PRODUCT = 'EvalDupReplaceProPlan';

export const duplicateActiveLicenseReplacement: EvalCase = {
  name: 'duplicate_active_license — replacement happy path',

  prompt: `Extend ${SEED_EMAIL}'s ${SEED_PRODUCT} license to expire in 90 days.`,

  preState: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, [SEED_PRODUCT]);
    const user = await createUser(baseUrl, SEED_EMAIL);
    const product = await createProduct(baseUrl, SEED_PRODUCT);
    // Existing coverage expires sooner than the 90-day target so the new
    // license is a strict extension — the replacement branch.
    await createLicense(baseUrl, {
      user_id: user.id,
      product_id: product.id,
      expires_at: futureIso(5),
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

  // One issue_license call is the replacement. A second would suggest the
  // agent got confused by the operation and tried again.
  maxCallsByTool: { issue_license: 1 },

  // The agent should confirm the extension landed (any of: extended,
  // 90, issued, replaced, expir).
  finalMessage: /(extend|90|issu|replace|expir|new)/i,
};
