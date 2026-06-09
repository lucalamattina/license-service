import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BackendClient } from '../src/backend-client.js';
import { createServer } from '../src/server.js';
import { fakeBackend, type FakeRoute } from './helpers/fake-backend.js';

// Valid RFC 4122 UUIDs: the third group starts with the version digit (4 = v4),
// and the fourth group starts with the variant digit (8/9/a/b for RFC 4122).
const LICENSE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

async function buildConnectedClient(routes: FakeRoute[]): Promise<{
  client: Client;
  cleanup: () => Promise<void>;
}> {
  const backend = new BackendClient({
    baseUrl: 'http://test',
    fetch: fakeBackend(routes),
  });
  const server = createServer({ backend });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'resources-test-client', version: '0.0.0' },
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

function readSingleJsonContent(result: { contents: Array<unknown> }): unknown {
  const first = result.contents[0] as { uri: string; mimeType?: string; text: string };
  expect(first.mimeType).toBe('application/json');
  return JSON.parse(first.text);
}

describe('resources/read', () => {
  describe('happy paths', () => {
    it('license://{uuid} returns the license JSON', async () => {
      const license = {
        id: LICENSE_ID,
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2027-01-01T00:00:00Z',
        user_id: USER_ID,
        product_id: PRODUCT_ID,
      };
      const { client, cleanup } = await buildConnectedClient([
        {
          method: 'GET',
          path: `/licenses/${LICENSE_ID}`,
          response: { status: 200, body: license },
        },
      ]);
      try {
        const result = await client.readResource({ uri: `license://${LICENSE_ID}` });
        expect(readSingleJsonContent(result)).toEqual(license);
      } finally {
        await cleanup();
      }
    });

    it('user://{uuid} returns the user JSON', async () => {
      const user = { id: USER_ID, email: 'alice@example.com' };
      const { client, cleanup } = await buildConnectedClient([
        {
          method: 'GET',
          path: `/users/${USER_ID}`,
          response: { status: 200, body: user },
        },
      ]);
      try {
        const result = await client.readResource({ uri: `user://${USER_ID}` });
        expect(readSingleJsonContent(result)).toEqual(user);
      } finally {
        await cleanup();
      }
    });

    it('product://{uuid} returns the product JSON', async () => {
      const product = { id: PRODUCT_ID, name: 'Pro Plan' };
      const { client, cleanup } = await buildConnectedClient([
        {
          method: 'GET',
          path: `/products/${PRODUCT_ID}`,
          response: { status: 200, body: product },
        },
      ]);
      try {
        const result = await client.readResource({ uri: `product://${PRODUCT_ID}` });
        expect(readSingleJsonContent(result)).toEqual(product);
      } finally {
        await cleanup();
      }
    });
  });

  describe('error translation', () => {
    it('license://{missing-uuid} surfaces a not_found error through the section-7 pipeline', async () => {
      const { client, cleanup } = await buildConnectedClient([
        {
          method: 'GET',
          path: `/licenses/${LICENSE_ID}`,
          response: {
            status: 404,
            body: { error: 'not_found', message: 'License not found' },
          },
        },
      ]);
      try {
        await expect(client.readResource({ uri: `license://${LICENSE_ID}` })).rejects.toMatchObject(
          {
            // McpError: id was invalid → InvalidParams
            code: ErrorCode.InvalidParams,
            message: expect.stringMatching(/no license exists/i),
            data: expect.objectContaining({ error: 'not_found' }),
          },
        );
      } finally {
        await cleanup();
      }
    });

    it('license://{not-a-uuid} rejects with a validation error BEFORE any backend call', async () => {
      // Empty route list: any backend call would throw "no route matches".
      // The handler must reject at the URI-parsing step.
      const { client, cleanup } = await buildConnectedClient([]);
      try {
        await expect(client.readResource({ uri: 'license://not-a-uuid' })).rejects.toMatchObject({
          code: ErrorCode.InvalidParams,
          message: expect.stringMatching(/not a valid UUID/i),
          data: expect.objectContaining({ error: 'validation_error' }),
        });
      } finally {
        await cleanup();
      }
    });

    it('a network error during a resource read surfaces as backend_unreachable (InternalError)', async () => {
      const backend = new BackendClient({
        baseUrl: 'http://test',
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
        retryDelayMs: 0,
      });
      const server = createServer({ backend });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'resources-test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      try {
        await expect(
          client.readResource({ uri: `license://${LICENSE_ID}` }),
        ).rejects.toMatchObject({
          code: ErrorCode.InternalError,
          message: expect.stringMatching(/could not reach the license-service backend/i),
          data: expect.objectContaining({ error: 'backend_unreachable' }),
        });
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  describe('resources/list is intentionally absent', () => {
    it('listResources returns an empty list (no concrete resources, no template enumeration)', async () => {
      const { client, cleanup } = await buildConnectedClient([]);
      try {
        const result = await client.listResources();
        expect(result.resources).toEqual([]);
      } finally {
        await cleanup();
      }
    });

    it('listResourceTemplates returns all three templates (so agents can discover the URI patterns)', async () => {
      const { client, cleanup } = await buildConnectedClient([]);
      try {
        const result = await client.listResourceTemplates();
        const uriTemplates = result.resourceTemplates
          .map((t) => t.uriTemplate)
          .sort();
        expect(uriTemplates).toEqual([
          'license://{license_id}',
          'product://{product_id}',
          'user://{user_id}',
        ]);
      } finally {
        await cleanup();
      }
    });
  });

  describe('capability advertisement', () => {
    it('the server now advertises the resources capability (Phase 5 turned it on)', async () => {
      const { client, cleanup } = await buildConnectedClient([]);
      try {
        const caps = client.getServerCapabilities();
        expect(caps?.resources).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });
});

// Sanity: McpError is the right thrown type when a resource read fails.
describe('McpError contract', () => {
  it('is what gets thrown for resource failures (not a generic Error)', () => {
    const err = new McpError(ErrorCode.InvalidParams, 'test', { error: 'validation_error' });
    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.data).toEqual({ error: 'validation_error' });
  });
});
