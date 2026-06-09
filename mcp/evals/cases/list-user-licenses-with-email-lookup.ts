/**
 * Phase 7 smoke case. Picked deliberately over a single-tool happy-path
 * because it exercises every harness feature: multi-turn tool loop (the agent
 * chains find_user_by_email → list_user_licenses), pre-state seeding (a user
 * with two active licenses), and the final-message regex assertion.
 */

import type { EvalCase } from '../types.js';
import {
  createLicense,
  createProduct,
  createUser,
  deleteUserIfExists,
  futureIso,
} from '../seed.js';

// Distinctive email so the eval's seed data is easy to spot in the live DB
// and cleanup is unambiguous.
const SEED_EMAIL = 'eval-list-user-licenses@example.com';

export const listUserLicensesWithEmailLookup: EvalCase = {
  name: 'list_user_licenses — happy path with email lookup',

  prompt: `Look up the user ${SEED_EMAIL} and show me everything they have ever held — every license, every status. Summarise it for me.`,

  preState: async (baseUrl) => {
    // Idempotent: if a previous failed sample left state behind, drop it first.
    await deleteUserIfExists(baseUrl, SEED_EMAIL);

    const user = await createUser(baseUrl, SEED_EMAIL);
    // Two unique products per sample so we don't accidentally fall into the
    // backend's duplicate-active-license policy on a second run.
    const productA = await createProduct(baseUrl, `Eval Plan A ${user.id.slice(0, 8)}`);
    const productB = await createProduct(baseUrl, `Eval Plan B ${user.id.slice(0, 8)}`);

    await createLicense(baseUrl, {
      user_id: user.id,
      product_id: productA.id,
      expires_at: futureIso(30),
    });
    await createLicense(baseUrl, {
      user_id: user.id,
      product_id: productB.id,
      expires_at: futureIso(90),
    });
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
    { name: 'list_user_licenses' },
  ],

  // Soft prose check: the agent should mention at least one license-shaped detail.
  // Avoid asserting on counts or specific product names — the human-facing summary
  // can phrase those many ways.
  finalMessage: /(active|expires|license)/i,
};
