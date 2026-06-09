/**
 * Helpers that build MCP `CallToolResult` payloads.
 *
 * Success results carry the JSON-stringified data in a single text content
 * block. Error results follow the two-layer shape from MCP_DESIGN.md section
 * 7: a natural-language sentence on its own line, a blank line, then the
 * JSON-stringified structured payload. Both layers in a single text block.
 *
 * The text content block format was chosen over multiple content items because
 * agents read text blocks left-to-right and putting both layers in one block
 * preserves the reading order the section-7 doc commits to.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TranslatedError } from './error-translation.js';

export function toolSuccess(data: unknown): CallToolResult {
  return {
    isError: false,
    content: [
      {
        type: 'text',
        text: JSON.stringify(data),
      },
    ],
  };
}

export function toolError(translated: TranslatedError): CallToolResult {
  const text = `${translated.naturalLanguage}\n\n${JSON.stringify(translated.structured)}`;
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}
