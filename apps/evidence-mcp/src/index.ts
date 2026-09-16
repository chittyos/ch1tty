import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from 'node:http';
import { EvidenceClient } from './evidence-client.js';
import { createEvidenceServer } from './server.js';
import { createEvidenceHttpApp } from './http-server.js';

const portEnv = process.env.EVIDENCE_MCP_PORT;

if (portEnv) {
  const port = Number(portEnv);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`[evidence-mcp] Invalid EVIDENCE_MCP_PORT: ${portEnv}\n`);
    process.exit(1);
  }

  const app = createEvidenceHttpApp({ mcpToken: process.env.EVIDENCE_MCP_TOKEN });
  const httpServer = createServer((req, res) => { void app.handleRequest(req, res); });
  httpServer.listen(port, '0.0.0.0', () => {
    process.stderr.write(`[evidence-mcp] HTTP server listening on port ${port}\n`);
  });
} else {
  const server = createEvidenceServer(new EvidenceClient());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
