import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BackendClient } from '../src/backend-client.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from '../src/server.js';
import { fakeBackend } from './helpers/fake-backend.js';

function makeStubBackend(): BackendClient {
  // No routes registered: any backend call from this test would throw.
  // Phase 0's smoke test exercises only the handshake; no tool is invoked.
  return new BackendClient({
    baseUrl: 'http://stub',
    fetch: fakeBackend([]),
  });
}

describe('server handshake + declared capabilities', () => {
  it('exposes our serverInfo and the capabilities for the primitives registered so far', async () => {
    const server = createServer({ backend: makeStubBackend() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: 'phase-0-smoke-test-client', version: '0.0.0' },
      { capabilities: {} },
    );

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // Our `serverInfo` (the name + version we set inside createServer)
    // reaches the client. Asserts our code, not the SDK's.
    const serverInfo = client.getServerVersion();
    expect(serverInfo).toBeDefined();
    expect(serverInfo?.name).toBe(SERVER_NAME);
    expect(serverInfo?.version).toBe(SERVER_VERSION);

    // Capabilities are added cumulatively as each phase registers primitives.
    // Phase 2 adds `tools` (discovery tools). Phase 5 will add `resources`.
    // Phase 6 will add `prompts`.
    const caps = client.getServerCapabilities();
    expect(caps).toBeDefined();
    expect(caps?.tools).toBeDefined();
    expect(caps?.resources).toBeUndefined();
    expect(caps?.prompts).toBeUndefined();

    await client.close();
    await server.close();
  });
});
