/**
 * Multi-step workflow case 12 from MCP_DESIGN.md section 10 — the case that
 * matters most. Three active licenses, one of which expires in 3 days. The
 * agent must revoke EXACTLY that one. The "revoked everything in sight"
 * failure mode (cap revoke_license at 1) is the specific regression this
 * case is designed to catch.
 *
 * preState tracks both the to-revoke license id (for argsMatch and final
 * cleanup verification) and the to-keep license ids (so a future assertion
 * could verify they survived; we don't post-check status here because the
 * tool-call assertion is already tight enough).
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

const SEED_EMAIL = 'eval-revoke-selected@example.com';
const SEED_PRODUCTS = [
  'EvalRevokeSelectedShortFuse', // 3 days — should be revoked
  'EvalRevokeSelectedSafeA',     // 60 days — keep
  'EvalRevokeSelectedSafeB',     // 365 days — keep
];

let seeded: { shortFuseLicenseId: string } | null = null;

export const revokeSelectedLicensesWorkflow: EvalCase = {
  name: 'revoke selected licenses — workflow',

  prompt: `Revoke any of ${SEED_EMAIL}'s active licenses that expire in the next 7 days.`,

  preState: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, SEED_PRODUCTS);

    const user = await createUser(baseUrl, SEED_EMAIL);
    const shortFuseProduct = await createProduct(baseUrl, SEED_PRODUCTS[0]!);
    const safeProductA = await createProduct(baseUrl, SEED_PRODUCTS[1]!);
    const safeProductB = await createProduct(baseUrl, SEED_PRODUCTS[2]!);

    const shortFuse = await createLicense(baseUrl, {
      user_id: user.id,
      product_id: shortFuseProduct.id,
      expires_at: futureIso(3),
    });
    await createLicense(baseUrl, {
      user_id: user.id,
      product_id: safeProductA.id,
      expires_at: futureIso(60),
    });
    await createLicense(baseUrl, {
      user_id: user.id,
      product_id: safeProductB.id,
      expires_at: futureIso(365),
    });

    seeded = { shortFuseLicenseId: shortFuse.id };
  },

  cleanup: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, SEED_PRODUCTS);
    seeded = null;
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
    {
      name: 'revoke_license',
      // The critical assertion: the revoke targets the short-fuse license, not
      // one of the safe ones. This catches "agent confused which is which."
      argsMatch: (args) =>
        typeof args === 'object' &&
        args !== null &&
        (args as { license_id?: string }).license_id === seeded?.shortFuseLicenseId,
    },
  ],

  // The "exactly one revoke" guard. A second revoke would mean the agent
  // also took out a safe license — the exact failure mode the design calls
  // out as the reason this case exists.
  maxCallsByTool: { revoke_license: 1 },

  // No issuance during a revoke-selection workflow.
  forbiddenTools: ['issue_license'],

  // The agent should describe what it did. We don't try to assert it named
  // specific licenses — phrasing varies too much — only that a revoke
  // happened.
  finalMessage: /(revok|expir)/i,
};
