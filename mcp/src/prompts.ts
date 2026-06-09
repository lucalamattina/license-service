/**
 * MCP prompts for the license-service layer.
 *
 * v1 ships exactly one prompt: `audit_user_licenses`. Rationale and the
 * "code is canonical, doc references it" ownership rule are in MCP_DESIGN.md
 * section 6.
 *
 * The prompt body is constructed by `buildAuditPromptBody(userId)` below.
 * That function is the canonical source of truth for the prompt text;
 * MCP_DESIGN.md section 6 includes a near-verbatim copy for reference but
 * points readers here for the authoritative version.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const PROMPT_NAME = 'audit_user_licenses';

export const DESCRIPTION =
  "Produce a structured license audit for a user: their email and id, active licenses " +
  "(with 30-day-expiry flagging), plus counts of revoked and expired licenses. The agent " +
  "uses list_user_licenses, list_products, and the user:// resource to gather the data.";

export const argsSchema = {
  user_id: z.uuid().describe('The UUID of the user to audit.'),
};

/**
 * Canonical prompt body. Returns the prose the agent receives as a `user`
 * message when the prompt is invoked. The user id is interpolated in both
 * the structured-output requirements (item 1) and the resource URI hint
 * (item 4 closing sentence).
 */
export function buildAuditPromptBody(userId: string): string {
  return [
    `Produce a license audit for user ${userId}. Format the response as:`,
    '',
    `1. **User**: the user's email and id (use the \`user://${userId}\` resource).`,
    '2. **Active licenses**: for each, list the product name, the `expires_at`, and whether it expires in the next 30 days (flag those separately at the top of this section).',
    '3. **Revoked licenses**: a count, plus the most recent revocation if there is one.',
    '4. **Expired licenses**: a count, plus the latest `expires_at` if any.',
    '',
    `Use the available tools (\`list_user_licenses\`, \`list_products\`) and resources to gather the data. Do not fabricate any field. If \`user://${userId}\` returns \`not_found\`, say so and stop.`,
  ].join('\n');
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    PROMPT_NAME,
    {
      description: DESCRIPTION,
      argsSchema,
    },
    async (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: buildAuditPromptBody(args.user_id),
          },
        },
      ],
    }),
  );
}
