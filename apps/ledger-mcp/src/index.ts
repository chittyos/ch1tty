import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LedgerClient, type AppendEntryInput, type ListEntriesFilter } from './ledger-client.js';

const client = new LedgerClient();

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
        result = await client.listEntries(a['namespace'] as string, {
          cursor: a['cursor'] as string | undefined,
          limit: a['limit'] as number | undefined,
          since: a['since'] as string | undefined,
        } satisfies ListEntriesFilter);
        break;

      case 'get_entry':
        result = await client.getEntry(a['namespace'] as string, a['id'] as string);
        break;

      case 'append_entry':
        result = await client.appendEntry(a['namespace'] as string, {
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

const transport = new StdioServerTransport();
await server.connect(transport);
