import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, SERVER_NAME } from './server.js';

// stdout is the MCP protocol channel (stdio transport speaks JSON-RPC over it).
// All diagnostics go to stderr so we never corrupt the protocol stream.
function log(msg: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
}

async function main(): Promise<void> {
  const server = createServer();
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
