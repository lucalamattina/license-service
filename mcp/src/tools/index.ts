import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BackendClient } from '../backend-client.js';
import * as findUserByEmail from './find-user-by-email.js';
import * as listProducts from './list-products.js';

export interface ToolDeps {
  backend: BackendClient;
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    findUserByEmail.TOOL_NAME,
    {
      description: findUserByEmail.DESCRIPTION,
      inputSchema: findUserByEmail.inputSchema,
    },
    async (args) => findUserByEmail.handler(args, deps),
  );

  // No `inputSchema`: the SDK invokes the callback with just `extra`, no args.
  server.registerTool(
    listProducts.TOOL_NAME,
    {
      description: listProducts.DESCRIPTION,
    },
    async () => listProducts.handler({}, deps),
  );
}
