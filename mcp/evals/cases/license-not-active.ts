/**
 * Failure-mode case 8 from MCP_DESIGN.md section 10.
 *
 * Goal: the requested license is already revoked. `revoke_license` returns
 * `license_not_active` (409). The agent must surface that the license is
 * already terminal and must **not** retry — retrying a terminal-state error
 * is the failure mode the design's error rewrite is meant to prevent.
 *
 * The license id is only known after `preState` runs, so prompt + argsMatch
 * close over module-level seeded state.
 */

import type { EvalCase } from '../types.js';
import {
  createLicense,
  createProduct,
  createUser,
  deleteProductsByNames,
  deleteUserIfExists,
  futureIso,
  revokeLicenseDirect,
} from '../seed.js';

const SEED_EMAIL = 'eval-license-not-active@example.com';
const SEED_PRODUCT = 'EvalLicenseNotActiveProduct';

let seeded: { licenseId: string } | null = null;

export const licenseNotActive: EvalCase = {
  name: 'license_not_active — already terminal',

  prompt: () => {
    if (!seeded) throw new Error('preState must run before prompt');
    return `Revoke license ${seeded.licenseId}.`;
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
    // Flip it to revoked so the agent's revoke call hits the terminal-state path.
    await revokeLicenseDirect(baseUrl, license.id);
    seeded = { licenseId: license.id };
  },

  cleanup: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, [SEED_PRODUCT]);
    seeded = null;
  },

  expectedToolCalls: [
    {
      name: 'revoke_license',
      argsMatch: (args) =>
        typeof args === 'object' &&
        args !== null &&
        (args as { license_id?: string }).license_id === seeded?.licenseId,
    },
  ],

  // The retry guard. A naive agent might re-attempt after the 409.
  maxCallsByTool: { revoke_license: 1 },

  // The agent should mention the terminal status — "already" / "revoked" /
  // "cannot" are all acceptable phrasings.
  finalMessage: /(already|revoked|terminal|cannot|not active)/i,
};
