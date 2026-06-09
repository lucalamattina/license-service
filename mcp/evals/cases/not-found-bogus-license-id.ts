/**
 * Failure-mode case 9 from MCP_DESIGN.md section 10.
 *
 * Goal: the agent attempts to validate a UUID that doesn't exist. The backend
 * returns `not_found`. The agent must surface the absence rather than hide
 * it. No seeding required.
 *
 * The chosen UUID is a valid RFC 4122 v4 format (variant byte 8/9/a/b, version
 * nibble 4) so Zod's `z.uuid()` accepts it; the backend then 404s.
 */

import type { EvalCase } from '../types.js';

const BOGUS_LICENSE_ID = '00000000-0000-4000-8000-000000000000';

export const notFoundBogusLicenseId: EvalCase = {
  name: 'not_found — bogus license id',

  prompt: `Validate license ${BOGUS_LICENSE_ID}.`,

  preState: async () => {
    // No seed — the absence is the whole point.
  },

  expectedToolCalls: [
    {
      name: 'validate_license',
      argsMatch: (args) =>
        typeof args === 'object' &&
        args !== null &&
        (args as { license_id?: string }).license_id === BOGUS_LICENSE_ID,
    },
  ],

  // The retry guard: validating a not-found id twice is the failure mode.
  maxCallsByTool: { validate_license: 1 },

  // The agent should say the license doesn't exist. Phrasings observed in
  // the wild: "not found", "no license was found", "doesn't exist", "no such".
  // The "no .* found" branch tolerates a noun between the negation and the
  // verb ("no license was found", "no record found").
  finalMessage: /(no .{0,40}found|not found|doesn'?t exist|no such|missing|does not exist)/i,
};
