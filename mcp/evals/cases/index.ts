/**
 * The 12 eval cases from MCP_DESIGN.md section 10.
 *
 * Order mirrors the design doc: smoke first, failure-mode middle, multi-step
 * workflows last. The runner consumes this array verbatim.
 */

import type { EvalCase } from '../types.js';
import { findUserByEmailHappyPath } from './find-user-by-email-happy-path.js';
import { listProductsHappyPath } from './list-products-happy-path.js';
import { listUserLicensesWithEmailLookup } from './list-user-licenses-with-email-lookup.js';
import { validateLicenseHappyPath } from './validate-license-happy-path.js';
import { expiresAtInPast } from './expires-at-in-past.js';
import { duplicateActiveLicenseRejection } from './duplicate-active-license-rejection.js';
import { duplicateActiveLicenseReplacement } from './duplicate-active-license-replacement.js';
import { licenseNotActive } from './license-not-active.js';
import { notFoundBogusLicenseId } from './not-found-bogus-license-id.js';
import { findUserByEmailNullMatch } from './find-user-by-email-null-match.js';
import { auditUserLicensesWorkflow } from './audit-user-licenses-workflow.js';
import { revokeSelectedLicensesWorkflow } from './revoke-selected-licenses-workflow.js';

export const ALL_CASES: EvalCase[] = [
  // Tool-selection smoke (4)
  findUserByEmailHappyPath,
  listProductsHappyPath,
  listUserLicensesWithEmailLookup,
  validateLicenseHappyPath,
  // Failure-mode recovery (6)
  expiresAtInPast,
  duplicateActiveLicenseRejection,
  duplicateActiveLicenseReplacement,
  licenseNotActive,
  notFoundBogusLicenseId,
  findUserByEmailNullMatch,
  // Multi-step workflows (2)
  auditUserLicensesWorkflow,
  revokeSelectedLicensesWorkflow,
];
