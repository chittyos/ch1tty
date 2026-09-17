import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from 'node:http';
import { LedgerClient } from './ledger-client.js';
import { createLedgerServer } from './server.js';
import { createLedgerMcpHttpApp } from './http-server.js';

const portEnv = process.env.LEDGER_MCP_PORT;

if (portEnv) {
  const port = Number(portEnv);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`[ledger-mcp] Invalid LEDGER_MCP_PORT: ${portEnv}\n`);
    process.exit(1);
  }
  const app = createLedgerMcpHttpApp({ mcpToken: process.env.LEDGER_MCP_TOKEN });
  const httpServer = createServer((req, res) => { void app.handleRequest(req, res); });
  httpServer.listen(port, '0.0.0.0', () => {
    process.stderr.write(`[ledger-mcp] HTTP server listening on port ${port}\n`);
  });
} else {
  const server = createLedgerServer(new LedgerClient());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
