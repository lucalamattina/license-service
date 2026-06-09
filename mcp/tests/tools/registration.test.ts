import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BackendClient } from '../../src/backend-client.js';
import { createServer } from '../../src/server.js';
import * as findUserByEmail from '../../src/tools/find-user-by-email.js';
import * as listProducts from '../../src/tools/list-products.js';
import { fakeBackend } from '../helpers/fake-backend.js';

function makeStubBackend(): BackendClient {
  return new BackendClient({ baseUrl: 'http://stub', fetch: fakeBackend([]) });
}

async function buildConnectedClient(): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createServer({ backend: makeStubBackend() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'registration-test-client', version: '0.0.0' },
    { capabilities: {} },
  );
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('tool registration via SDK listTools', () => {
  it('exposes the discovery and read tools registered so far', async () => {
    // This list grows phase-by-phase. Phase 2 added the two discovery tools;
    // Phase 3 added the four read tools below. Phase 4 will add the two action
    // tools (issue_license, revoke_license).
    const { client, cleanup } = await buildConnectedClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        'find_user_by_email',
        'get_license',
        'list_products',
        'list_user_active_products',
        'list_user_licenses',
        'validate_license',
      ]);
    } finally {
      await cleanup();
    }
  });

  it('exposes find_user_by_email with the description text from its module', async () => {
    const { client, cleanup } = await buildConnectedClient();
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === findUserByEmail.TOOL_NAME);
      expect(tool).toBeDefined();
      expect(tool?.description).toBe(findUserByEmail.DESCRIPTION);
      // inputSchema is published as JSON Schema; assert it has the email field.
      expect(tool?.inputSchema).toBeDefined();
      const schemaProps = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties;
      expect(schemaProps).toHaveProperty('email');
    } finally {
      await cleanup();
    }
  });

  it('exposes list_products with no required arguments', async () => {
    const { client, cleanup } = await buildConnectedClient();
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === listProducts.TOOL_NAME);
      expect(tool).toBeDefined();
      expect(tool?.description).toBe(listProducts.DESCRIPTION);
      // No-arg tool: properties is empty or required is empty/absent.
      const schemaProps = (tool?.inputSchema as { properties?: Record<string, unknown> })?.properties;
      const schemaRequired = (tool?.inputSchema as { required?: string[] })?.required;
      const hasNoProps = !schemaProps || Object.keys(schemaProps).length === 0;
      const hasNoRequired = !schemaRequired || schemaRequired.length === 0;
      expect(hasNoProps || hasNoRequired).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('end-to-end via SDK callTool: find_user_by_email returns a success result', async () => {
    // This goes through the full SDK tool-call surface: client.callTool sends
    // a tools/call request, the server dispatches to our handler, and the
    // result comes back through the protocol. Verifies the wiring is real.
    const fetchStub = fakeBackend([
      {
        method: 'GET',
        path: '/users/by-email',
        query: { email: 'alice@example.com' },
        response: { status: 200, body: { user: { id: 'u1', email: 'alice@example.com' } } },
      },
    ]);
    const backend = new BackendClient({ baseUrl: 'http://stub', fetch: fetchStub });
    const server = createServer({ backend });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'e2e-test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({
        name: 'find_user_by_email',
        arguments: { email: 'alice@example.com' },
      });
      expect(result.isError).toBe(false);
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0]!.text)).toEqual({
        user: { id: 'u1', email: 'alice@example.com' },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
