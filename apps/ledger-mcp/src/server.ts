import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { LedgerClient, ListEntriesFilter, AppendEntryInput } from './ledger-client.js';

function missingArg(tool: string, field: string) {
  return {
    content: [{ type: 'text' as const, text: `${tool}: required argument "${field}" is missing` }],
    isError: true,
  };
}

/** Create and configure a ledger-mcp MCP Server backed by the given LedgerClient. */
export function createLedgerServer(client: LedgerClient): Server {
  const server = new Server(
    { name: 'ledger-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_namespaces',
        description: 'List all available ledger namespaces with entry counts and timestamps.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_entries',
        description: 'List entries in a ledger namespace. Supports cursor-based pagination and time-range filtering. The ledger is append-only — entries are never modified or deleted.',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: 'Ledger namespace name (required)' },
            cursor: { type: 'string', description: 'Pagination cursor from a previous list_entries response' },
            limit: { type: 'number', description: 'Maximum number of entries to return (default: 50)' },
            since: { type: 'string', description: 'ISO 8601 timestamp — return only entries created after this time' },
          },
          required: ['namespace'],
        },
      },
      {
        name: 'get_entry',
        description: 'Get a single ledger entry by namespace and entry ID.',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: 'Ledger namespace name' },
            id: { type: 'string', description: 'Entry ID' },
          },
          required: ['namespace', 'id'],
        },
      },
      {
        name: 'append_entry',
        description: 'Append a new immutable entry to a ledger namespace. Entries cannot be modified or deleted after creation.',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: 'Ledger namespace to append to (required)' },
            payload: {
              type: 'object',
              description: 'Arbitrary JSON payload to record (required)',
              additionalProperties: true,
            },
            metadata: {
              type: 'object',
              description: 'Optional metadata attached to this entry (source, actor, correlation_id, etc.)',
              additionalProperties: true,
            },
          },
          required: ['namespace', 'payload'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const a = args as Record<string, unknown>;

    try {
      let result: unknown;

      switch (name) {
        case 'list_namespaces':
          result = await client.listNamespaces();
          break;

        case 'list_entries':
          if (typeof a['namespace'] !== 'string' || !a['namespace']) return missingArg('list_entries', 'namespace');
          result = await client.listEntries(a['namespace'], {
            cursor: a['cursor'] as string | undefined,
            limit: a['limit'] as number | undefined,
            since: a['since'] as string | undefined,
          } satisfies ListEntriesFilter);
          break;

        case 'get_entry':
          if (typeof a['namespace'] !== 'string' || !a['namespace']) return missingArg('get_entry', 'namespace');
          if (typeof a['id'] !== 'string' || !a['id']) return missingArg('get_entry', 'id');
          result = await client.getEntry(a['namespace'], a['id']);
          break;

        case 'append_entry':
          if (typeof a['namespace'] !== 'string' || !a['namespace']) return missingArg('append_entry', 'namespace');
          if (a['payload'] === undefined || a['payload'] === null) return missingArg('append_entry', 'payload');
          result = await client.appendEntry(a['namespace'], {
            payload: a['payload'] as Record<string, unknown>,
            metadata: a['metadata'] as Record<string, unknown> | undefined,
          } satisfies AppendEntryInput);
          break;

        default:
          return {
            content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}
