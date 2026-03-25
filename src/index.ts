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
import { VERSION } from './utils.js';
import { HealthServer } from './health-server.js';
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

  // Optional health HTTP server (for registration compliance + observability)
  let healthServer: HealthServer | null = null;
  const healthPort = process.env.CH1TTY_HEALTH_PORT ? parseInt(process.env.CH1TTY_HEALTH_PORT, 10) : null;
  if (healthPort && Number.isFinite(healthPort)) {
    healthServer = new HealthServer(aggregator, { port: healthPort });
    await healthServer.start();
    process.stderr.write(`[ch1tty] Health server listening on 127.0.0.1:${healthPort}\n`);
  }

  const server = new Server(
    { name: 'ch1tty', version: VERSION },
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
    if (healthServer) await healthServer.stop();
    await aggregator.shutdown();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[ch1tty] MCP gateway v${VERSION} started\n`);
}

main().catch((err) => {
  process.stderr.write(`[ch1tty] Fatal error: ${err}\n`);
  process.exit(1);
});
