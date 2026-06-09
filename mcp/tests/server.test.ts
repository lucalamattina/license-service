import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from '../src/server.js';

describe('Phase 0 server', () => {
  it('completes the initialize handshake exposing our serverInfo and capabilities', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: 'phase-0-smoke-test-client', version: '0.0.0' },
      { capabilities: {} },
    );

    // The handshake runs as a side effect of connecting both ends.
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // 1. Our `serverInfo` (the name + version we set inside createServer)
    //    reaches the client. This asserts our code, not the SDK's.
    const serverInfo = client.getServerVersion();
    expect(serverInfo).toBeDefined();
    expect(serverInfo?.name).toBe(SERVER_NAME);
    expect(serverInfo?.version).toBe(SERVER_VERSION);

    // 2. Our declared capabilities for Phase 0: nothing yet. We deliberately
    //    pass an empty capabilities object in createServer; later phases will
    //    add `tools`, `resources`, and `prompts` keys.
    const caps = client.getServerCapabilities();
    expect(caps).toBeDefined();
    expect(caps?.tools).toBeUndefined();
    expect(caps?.resources).toBeUndefined();
    expect(caps?.prompts).toBeUndefined();

    await client.close();
    await server.close();
  });
});
