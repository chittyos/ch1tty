import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Aggregator } from './aggregator.js';
import type { AggregatorOptions } from './aggregator.js';
import { loadConfigFromPath, resolveConfigPath } from './config.js';
import type { ServerAccess, ServerCategory } from './types.js';

async function main(): Promise<void> {
  const configPath = resolveConfigPath();
  const config = loadConfigFromPath(configPath);

  const options: AggregatorOptions = {};
  if (process.env.CH1TTY_ACCESS) {
    options.accessFilter = process.env.CH1TTY_ACCESS as ServerAccess;
  }
  if (process.env.CH1TTY_CATEGORY) {
    options.categoryFilter = process.env.CH1TTY_CATEGORY as ServerCategory;
  }

  const aggregator = new Aggregator(config.servers, options);

  const server = new Server(
    { name: 'ch1tty', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return aggregator.listAllTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return aggregator.callTool(name, (args ?? {}) as Record<string, unknown>);
  });

  // Graceful shutdown
  const cleanup = async () => {
    await aggregator.shutdown();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[ch1tty] MCP gateway started\n');
}

main().catch((err) => {
  process.stderr.write(`[ch1tty] Fatal error: ${err}\n`);
  process.exit(1);
});
