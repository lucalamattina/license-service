import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BackendClient } from './backend-client.js';
import { createServer, SERVER_NAME } from './server.js';

const DEFAULT_BACKEND_BASE_URL =
  'https://llamattina-license-service-5c6fae72379f.herokuapp.com';

// stdout is the MCP protocol channel (stdio transport speaks JSON-RPC over it).
// All diagnostics go to stderr so we never corrupt the protocol stream.
function log(msg: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
}

async function main(): Promise<void> {
  const baseUrl = process.env.LICENSE_SERVICE_BASE_URL ?? DEFAULT_BACKEND_BASE_URL;
  log(`backend base url: ${baseUrl}`);

  const backend = new BackendClient({ baseUrl });
  const server = createServer({ backend });
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down on ${signal}`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await server.connect(transport);
  log('connected via stdio');
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
