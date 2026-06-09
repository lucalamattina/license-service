/**
 * Smoke case 2 from MCP_DESIGN.md section 10.
 *
 * Goal: the agent calls `list_products` for an open-ended catalogue question
 * and surfaces at least one product name.
 *
 * Distinctive product names so the assertion can confirm the seeded items
 * round-tripped to the agent's final message; cleanup tears them down so the
 * catalogue doesn't accumulate test-only entries.
 */

import type { EvalCase } from '../types.js';
import { createProduct, deleteProductsByNames } from '../seed.js';

const SEED_PRODUCT_NAMES = [
  'EvalListProductsAlpha',
  'EvalListProductsBeta',
];

export const listProductsHappyPath: EvalCase = {
  name: 'list_products — happy path',

  prompt: 'What products do we offer?',

  preState: async (baseUrl) => {
    await deleteProductsByNames(baseUrl, SEED_PRODUCT_NAMES);
    for (const name of SEED_PRODUCT_NAMES) {
      await createProduct(baseUrl, name);
    }
  },

  cleanup: async (baseUrl) => {
    await deleteProductsByNames(baseUrl, SEED_PRODUCT_NAMES);
  },

  expectedToolCalls: [{ name: 'list_products' }],

  // At least one seeded product must surface in the agent's summary.
  // RegExp character classes don't tolerate unescaped pipes between literals,
  // so spell out both names; either match passes.
  finalMessage: /(EvalListProductsAlpha|EvalListProductsBeta)/,
};
