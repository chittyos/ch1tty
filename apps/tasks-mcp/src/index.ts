import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from 'node:http';
import { TasksClient } from './tasks-client.js';
import { createTaskServer } from './server.js';
import { createTasksHttpApp } from './http-server.js';

const portEnv = process.env.TASKS_MCP_PORT;

if (portEnv) {
  const port = Number(portEnv);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`[tasks-mcp] Invalid TASKS_MCP_PORT: ${portEnv}\n`);
    process.exit(1);
  }

  const app = createTasksHttpApp({ mcpToken: process.env.TASKS_MCP_TOKEN });
  const httpServer = createServer((req, res) => { void app.handleRequest(req, res); });
  httpServer.listen(port, '0.0.0.0', () => {
    process.stderr.write(`[tasks-mcp] HTTP server listening on port ${port}\n`);
  });
} else {
  const client = new TasksClient();
  const server = createTaskServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
