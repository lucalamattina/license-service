import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BackendClient } from '../src/backend-client.js';
import {
  buildAuditPromptBody,
  DESCRIPTION,
  PROMPT_NAME,
} from '../src/prompts.js';
import { createServer } from '../src/server.js';
import { fakeBackend } from './helpers/fake-backend.js';

// Valid RFC 4122 UUID (v4, variant 8 — matches Zod 4's `z.uuid()` strict check).
const USER_ID = '11111111-1111-4111-8111-111111111111';

async function buildConnectedClient(): Promise<{
  client: Client;
  cleanup: () => Promise<void>;
}> {
  // Prompts never call the backend, so the stub fetch has no routes.
  const backend = new BackendClient({
    baseUrl: 'http://test',
    fetch: fakeBackend([]),
  });
  const server = createServer({ backend });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'prompts-test-client', version: '0.0.0' },
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

describe('prompts/list', () => {
  it('exposes audit_user_licenses with its description and user_id argument', async () => {
    const { client, cleanup } = await buildConnectedClient();
    try {
      const { prompts } = await client.listPrompts();
      expect(prompts).toHaveLength(1);
      const prompt = prompts[0]!;
      expect(prompt.name).toBe(PROMPT_NAME);
      expect(prompt.description).toBe(DESCRIPTION);
      expect(prompt.arguments).toHaveLength(1);
      const arg = prompt.arguments![0]!;
      expect(arg.name).toBe('user_id');
      expect(arg.required).toBe(true);
      expect(arg.description).toBe('The UUID of the user to audit.');
    } finally {
      await cleanup();
    }
  });
});

describe('prompts/get', () => {
  it('returns the canonical body with the user_id interpolated in both anchored places', async () => {
    const { client, cleanup } = await buildConnectedClient();
    try {
      const result = await client.getPrompt({
        name: PROMPT_NAME,
        arguments: { user_id: USER_ID },
      });
      expect(result.messages).toHaveLength(1);
      const message = result.messages[0]!;
      expect(message.role).toBe('user');
      const text = (message.content as { type: 'text'; text: string }).text;

      // The id is referenced twice: once in the opening sentence, once in the
      // user:// resource URI hint. Both must contain the supplied id.
      expect(text).toContain(`Produce a license audit for user ${USER_ID}`);
      expect(text).toContain(`user://${USER_ID}`);
      // Sanity: structured-output headings make it through.
      expect(text).toMatch(/Active licenses/);
      expect(text).toMatch(/Revoked licenses/);
      expect(text).toMatch(/Expired licenses/);
    } finally {
      await cleanup();
    }
  });

  it('the returned text matches buildAuditPromptBody byte-for-byte (single source of truth)', async () => {
    // prompts.ts is the canonical source; this test pins the contract.
    const { client, cleanup } = await buildConnectedClient();
    try {
      const result = await client.getPrompt({
        name: PROMPT_NAME,
        arguments: { user_id: USER_ID },
      });
      const text = (result.messages[0]!.content as { type: 'text'; text: string }).text;
      expect(text).toBe(buildAuditPromptBody(USER_ID));
    } finally {
      await cleanup();
    }
  });

  it('rejects a non-UUID user_id with an InvalidParams protocol error', async () => {
    const { client, cleanup } = await buildConnectedClient();
    try {
      await expect(
        client.getPrompt({
          name: PROMPT_NAME,
          arguments: { user_id: 'not-a-uuid' },
        }),
      ).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });
});

describe('capability advertisement', () => {
  it('the server now advertises the prompts capability (Phase 6 turned it on)', async () => {
    const { client, cleanup } = await buildConnectedClient();
    try {
      const caps = client.getServerCapabilities();
      expect(caps?.prompts).toBeDefined();
    } finally {
      await cleanup();
    }
  });
});
