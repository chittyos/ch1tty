import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Aggregator } from './aggregator.js';
import type { AggregatorOptions } from './aggregator.js';
import { loadConfigFromPath, resolveConfigPath } from './config.js';
import type { ServerAccess, ServerCategory } from './types.js';

async function main(): Promise<void> {
  const configPath = resolveConfigPath();
  const config = loadConfigFromPath(configPath);

  const options: AggregatorOptions = { configPath };
  if (process.env.CH1TTY_ACCESS) {
    options.accessFilter = process.env.CH1TTY_ACCESS as ServerAccess;
  }
  if (process.env.CH1TTY_CATEGORY) {
    options.categoryFilter = process.env.CH1TTY_CATEGORY as ServerCategory;
  }

  const aggregator = new Aggregator(config.servers, options);

  const server = new Server(
    { name: 'ch1tty', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  // ── Tools ───────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return aggregator.listAllTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return aggregator.callTool(name, (args ?? {}) as Record<string, unknown>);
  });

  // ── Resources ───────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return aggregator.listAllResources();
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return aggregator.listAllResourceTemplates();
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return aggregator.readResource(request.params.uri);
  });

  // ── Prompts ─────────────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return aggregator.listAllPrompts();
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return aggregator.getPrompt(name, args);
  });

  // ── Lifecycle ───────────────────────────────────────────────
  const cleanup = async () => {
    await aggregator.shutdown();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[ch1tty] MCP gateway v2.0 started\n');
}

main().catch((err) => {
  process.stderr.write(`[ch1tty] Fatal error: ${err}\n`);
  process.exit(1);
});
