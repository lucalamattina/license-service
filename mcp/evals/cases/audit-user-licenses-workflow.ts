/**
 * Multi-step workflow case 11 from MCP_DESIGN.md section 10.
 *
 * Goal: the agent runs the full audit pattern — resolve the email, list every
 * license the user holds, then categorise and flag anything expiring soon.
 * No mutation is permitted; this is a read-only workflow.
 *
 * Pre-state covers all three terminal states the audit might encounter:
 * two active (one expiring in 15 days, one in 200), one revoked, one expired.
 * The expired license is seeded via the validate-to-expire trick because the
 * backend rejects past expirations server-side at issue time.
 */

import type { EvalCase } from '../types.js';
import {
  createExpiredLicense,
  createLicense,
  createProduct,
  createUser,
  deleteProductsByNames,
  deleteUserIfExists,
  futureIso,
  revokeLicenseDirect,
} from '../seed.js';

const SEED_EMAIL = 'eval-audit-workflow@example.com';
const SEED_PRODUCTS = [
  'EvalAuditProductA', // active, 15 days — should be flagged
  'EvalAuditProductB', // active, 200 days
  'EvalAuditProductC', // revoked
  'EvalAuditProductD', // expired (via lazy transition)
];

export const auditUserLicensesWorkflow: EvalCase = {
  name: 'audit_user_licenses — workflow',

  prompt: `Give me a complete audit of ${SEED_EMAIL}'s license history, flag anything expiring in the next 30 days.`,

  preState: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, SEED_PRODUCTS);

    const user = await createUser(baseUrl, SEED_EMAIL);
    const productA = await createProduct(baseUrl, SEED_PRODUCTS[0]!);
    const productB = await createProduct(baseUrl, SEED_PRODUCTS[1]!);
    const productC = await createProduct(baseUrl, SEED_PRODUCTS[2]!);
    const productD = await createProduct(baseUrl, SEED_PRODUCTS[3]!);

    await createLicense(baseUrl, {
      user_id: user.id,
      product_id: productA.id,
      expires_at: futureIso(15),
    });
    await createLicense(baseUrl, {
      user_id: user.id,
      product_id: productB.id,
      expires_at: futureIso(200),
    });
    const toRevoke = await createLicense(baseUrl, {
      user_id: user.id,
      product_id: productC.id,
      expires_at: futureIso(60),
    });
    await revokeLicenseDirect(baseUrl, toRevoke.id);
    // Expired via the validate-on-near-future-expiry trick; ~4s wall time.
    await createExpiredLicense(baseUrl, {
      user_id: user.id,
      product_id: productD.id,
    });
  },

  cleanup: async (baseUrl) => {
    await deleteUserIfExists(baseUrl, SEED_EMAIL);
    await deleteProductsByNames(baseUrl, SEED_PRODUCTS);
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

  // Audit is read-only. The forbidden-tools list catches the failure mode of
  // an agent that interprets "audit" as "tidy up".
  forbiddenTools: ['issue_license', 'revoke_license'],

  // The audit summary must flag the 15-day license. "15" is the strongest
  // signal; "soon", "30 days", or "expiring" all also indicate the agent
  // identified the at-risk license. We don't assert on "active/revoked/
  // expired" individually — the categorisation phrasing varies too much
  // run-to-run to be a reliable assertion.
  finalMessage: /(15|30 days?|soon|expiring|imminent|next month)/i,
};
