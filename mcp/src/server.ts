import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BackendClient } from './backend-client.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerTools } from './tools/index.js';

export const SERVER_NAME = 'license-service-mcp';
export const SERVER_VERSION = '0.1.0';

export interface ServerDeps {
  backend: BackendClient;
}

/**
 * Builds the MCP server. The `McpServer` (the high-level SDK wrapper) is used
 * because its `registerTool` / `registerResource` / `registerPrompt` methods
 * auto-declare capabilities, so the constructor's `capabilities: {}` is just a
 * floor that gets added to as primitives are registered.
 *
 * The server is returned uncoupled to any transport. The caller decides whether
 * to connect a stdio transport (production, see `index.ts`) or an in-memory
 * transport (tests).
 */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: {} },
  );

  registerTools(server, deps);
  registerResources(server, deps);
  registerPrompts(server);

  return server;
}
