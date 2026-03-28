import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Aggregator } from './aggregator.js';
import type { AggregatorOptions } from './aggregator.js';
import { loadConfigFromPath, resolveConfigPath } from './config.js';
import { VERSION } from './utils.js';
import { HttpServer } from './http-server.js';
import { createMcpServer } from './mcp-server.js';
import type { ServerAccess, ServerCategory } from './types.js';

async function main(): Promise<void> {
  const configPath = resolveConfigPath();
  const config = loadConfigFromPath(configPath);

  const options: AggregatorOptions = { configPath };
  const accessEnv = process.env.CH1TTY_ACCESS;
  if (accessEnv) {
    if (!['read', 'write', 'readwrite'].includes(accessEnv)) {
      throw new Error(`Invalid CH1TTY_ACCESS value: "${accessEnv}". Must be read, write, or readwrite`);
    }
    options.accessFilter = accessEnv as ServerAccess;
  }
  const categoryEnv = process.env.CH1TTY_CATEGORY;
  if (categoryEnv) {
    options.categoryFilter = categoryEnv as ServerCategory;
  }

  const aggregator = new Aggregator(config.servers, options);

  // HTTP server — health, status, and remote MCP endpoint
  let httpServer: HttpServer | null = null;
  const httpPort = process.env.CH1TTY_PORT
    ? parseInt(process.env.CH1TTY_PORT, 10)
    : process.env.CH1TTY_HEALTH_PORT
      ? parseInt(process.env.CH1TTY_HEALTH_PORT, 10)
      : null;
  if (httpPort && Number.isFinite(httpPort)) {
    const mcpToken = process.env.CH1TTY_MCP_TOKEN;
    httpServer = new HttpServer(aggregator, {
      port: httpPort,
      enableMcp: true,
      mcpToken,
    });
    await httpServer.start();
    const mcpStatus = mcpToken ? 'auth required' : 'open';
    process.stderr.write(`[ch1tty] HTTP server on 0.0.0.0:${httpPort} — /health /api/v1/status /mcp (${mcpStatus})\n`);
  }

  // Stdio MCP server for local clients (Claude Code, IDE)
  const stdioServer = createMcpServer(aggregator);

  const cleanup = async () => {
    if (httpServer) await httpServer.stop();
    await aggregator.shutdown();
    await stdioServer.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const transport = new StdioServerTransport();
  await stdioServer.connect(transport);
  process.stderr.write(`[ch1tty] MCP gateway v${VERSION} started\n`);
}

main().catch((err) => {
  process.stderr.write(`[ch1tty] Fatal error: ${err}\n`);
  process.exit(1);
});
