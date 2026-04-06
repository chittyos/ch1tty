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
import { HttpMcpServer } from './http-server.js';
import { log } from './logger.js';
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

  // HTTP server with MCP transport + health endpoints
  let httpServer: HttpMcpServer | null = null;
  const httpPort = process.env.CH1TTY_PORT ? parseInt(process.env.CH1TTY_PORT, 10) : null;
  if (httpPort && Number.isFinite(httpPort)) {
    httpServer = new HttpMcpServer(aggregator, {
      port: httpPort,
      mcpToken: process.env.CH1TTY_MCP_TOKEN,
    });
    await httpServer.start();
    log.info(`HTTP server listening on 0.0.0.0:${httpPort}`);
    if (process.env.CH1TTY_MCP_TOKEN) {
      log.info(`MCP endpoint: /mcp (bearer token required)`);
    } else {
      log.warn(`MCP endpoint: /mcp (no auth — set CH1TTY_MCP_TOKEN to secure)`);
    }
  }

  // Stdio transport — always active, single session
  const stdioSessionId = `stdio-${crypto.randomUUID().slice(0, 8)}`;
  aggregator.sessions.getOrCreate(stdioSessionId, 'stdio');

  const server = new Server(
    { name: 'ch1tty', version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return aggregator.listAllTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return aggregator.callTool(name, (args ?? {}) as Record<string, unknown>, stdioSessionId);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return aggregator.listAllResources();
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return aggregator.listAllResourceTemplates();
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return aggregator.readResource(request.params.uri);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return aggregator.listAllPrompts();
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return aggregator.getPrompt(name, args);
  });

  // Lifecycle
  const cleanup = async () => {
    if (httpServer) await httpServer.stop();
    await aggregator.shutdown();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info(`MCP gateway v${VERSION} started (slim-mcp: search + execute)`);
}

main().catch((err) => {
  log.error(`Fatal error: ${err}`);
  process.exit(1);
});
