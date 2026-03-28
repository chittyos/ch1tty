/**
 * Shared MCP Server factory — creates a configured Server instance wired to the Aggregator.
 * Used by both stdio transport (index.ts) and HTTP transport (health-server.ts).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Aggregator } from './aggregator.js';
import { VERSION } from './utils.js';

export function createMcpServer(aggregator: Aggregator): Server {
  const server = new Server(
    { name: 'ch1tty', version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return aggregator.listAllTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return aggregator.callTool(name, (args ?? {}) as Record<string, unknown>);
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

  return server;
}
