import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from 'node:http';
import { McpClientDispatch } from './dispatch.js';
import { createCommsMcpServer } from './server.js';
import { createCommsHttpApp } from './http-server.js';
import type { OwnerIdentity } from './types.js';

function ownerIdentity(): OwnerIdentity {
  const raw = process.env['COMMS_MCP_OWNER_IDENTIFIERS'] ?? '';
  return {
    identifiers: raw.split(',').map((s) => s.trim()).filter(Boolean),
    displayName: process.env['COMMS_MCP_OWNER_DISPLAY_NAME'] ?? null,
    chittyId: process.env['COMMS_MCP_OWNER_CHITTYID'] ?? null,
  };
}

const portEnv = process.env.COMMS_MCP_PORT;

if (portEnv) {
  const port = Number(portEnv);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`[comms-mcp] Invalid COMMS_MCP_PORT: ${portEnv}\n`);
    process.exit(1);
  }

  const app = createCommsHttpApp({ mcpToken: process.env.COMMS_MCP_TOKEN });
  const httpServer = createServer((req, res) => { void app.handleRequest(req, res); });
  httpServer.listen(port, '0.0.0.0', () => {
    process.stderr.write(`[comms-mcp] HTTP server listening on port ${port}\n`);
  });
} else {
  const dispatch = new McpClientDispatch();
  const server = createCommsMcpServer(dispatch, ownerIdentity());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
