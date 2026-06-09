import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BackendClient } from '../backend-client.js';
import * as findUserByEmail from './find-user-by-email.js';
import * as getLicense from './get-license.js';
import * as issueLicense from './issue-license.js';
import * as listProducts from './list-products.js';
import * as listUserActiveProducts from './list-user-active-products.js';
import * as listUserLicenses from './list-user-licenses.js';
import * as revokeLicense from './revoke-license.js';
import * as validateLicense from './validate-license.js';

export interface ToolDeps {
  backend: BackendClient;
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  // Discovery (Phase 2)
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

  // Read tools (Phase 3)
  server.registerTool(
    getLicense.TOOL_NAME,
    {
      description: getLicense.DESCRIPTION,
      inputSchema: getLicense.inputSchema,
    },
    async (args) => getLicense.handler(args, deps),
  );

  server.registerTool(
    listUserLicenses.TOOL_NAME,
    {
      description: listUserLicenses.DESCRIPTION,
      inputSchema: listUserLicenses.inputSchema,
    },
    async (args) => listUserLicenses.handler(args, deps),
  );

  server.registerTool(
    listUserActiveProducts.TOOL_NAME,
    {
      description: listUserActiveProducts.DESCRIPTION,
      inputSchema: listUserActiveProducts.inputSchema,
    },
    async (args) => listUserActiveProducts.handler(args, deps),
  );

  server.registerTool(
    validateLicense.TOOL_NAME,
    {
      description: validateLicense.DESCRIPTION,
      inputSchema: validateLicense.inputSchema,
    },
    async (args) => validateLicense.handler(args, deps),
  );

  // Action tools (Phase 4)
  server.registerTool(
    issueLicense.TOOL_NAME,
    {
      description: issueLicense.DESCRIPTION,
      inputSchema: issueLicense.inputSchema,
    },
    async (args) => issueLicense.handler(args, deps),
  );

  server.registerTool(
    revokeLicense.TOOL_NAME,
    {
      description: revokeLicense.DESCRIPTION,
      inputSchema: revokeLicense.inputSchema,
    },
    async (args) => revokeLicense.handler(args, deps),
  );
}
