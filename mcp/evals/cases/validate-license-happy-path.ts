/**
 * Smoke case 4 from MCP_DESIGN.md section 10.
 *
 * Goal: the agent calls `validate_license` when handed an explicit license
 * UUID and surfaces a yes/no answer. The license UUID is only known after
 * `preState` runs, so the prompt is a thunk that closes over module-level
 * seeded state.
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

const SEED_EMAIL = 'eval-validate-happy@example.com';
const SEED_PRODUCT = 'EvalValidateHappyProduct';

let seeded: { licenseId: string } | null = null;

export const validateLicenseHappyPath: EvalCase = {
  name: 'validate_license — happy path',

  prompt: () => {
    if (!seeded) throw new Error('preState must run before prompt');
    return `Is license ${seeded.licenseId} currently valid?`;
  },

  preState: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, [SEED_PRODUCT]);

    const user = await createUser(baseUrl, SEED_EMAIL);
    const product = await createProduct(baseUrl, SEED_PRODUCT);
    const license = await createLicense(baseUrl, {
      user_id: user.id,
      product_id: product.id,
      expires_at: futureIso(60),
    });
    seeded = { licenseId: license.id };
  },

  cleanup: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, [SEED_PRODUCT]);
    seeded = null;
  },

  expectedToolCalls: [
    {
      name: 'validate_license',
      argsMatch: (args) =>
        typeof args === 'object' &&
        args !== null &&
        (args as { license_id?: string }).license_id === seeded?.licenseId,
    },
  ],

  // The license was seeded active with a 60-day expiration, so the answer is
  // "yes / valid / active". Match any of those affirmative terms.
  finalMessage: /(yes|valid|active)/i,
};
