import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export const SERVER_NAME = 'license-service-mcp';
export const SERVER_VERSION = '0.1.0';

/**
 * Builds the MCP `Server` instance. Phase 0 wires nothing — no tools, no
 * resources, no prompts. The declared capabilities object is empty; later
 * phases will add `tools`, `resources`, and `prompts` keys as primitives land.
 *
 * The server is returned uncoupled to any transport. The caller decides whether
 * to connect a stdio transport (production, see `index.ts`) or an in-memory
 * transport (tests).
 */
export function createServer(): Server {
  return new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: {} },
  );
}
