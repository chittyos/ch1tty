import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { recentLog } from './recent-log.js';
import type { CommsDispatch, OwnerIdentity, RecentLogInput } from './types.js';

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  oneOf: [{ required: ['person'] }, { required: ['identifier'] }],
  properties: {
    person: {
      type: 'string',
      description:
        'ChittyID of the counterparty Person (T=P). Preferred selector. @canon core-types: P.',
      pattern: '^[A-Z0-9]{2}-[A-Z0-9]-[A-Z0-9]{3}-[A-Z0-9]{4}-P-[A-Z0-9]{2,4}-[A-Z0-9]-[A-Z0-9]{1,2}$',
    },
    identifier: {
      type: 'string',
      description: 'Raw endpoint when no ChittyID is known: E.164 phone (+13122186717) or email.',
    },
    channels: {
      type: 'array',
      items: { type: 'string', enum: ['quo', 'imessage', 'email', 'twilio', 'voice'] },
      default: ['quo', 'imessage', 'email'],
      description: 'Which channels to fuse. Omitted => default set. Each maps to a bound provider.',
    },
    days: { type: 'integer', minimum: 1, maximum: 365, default: 30, description: 'Lookback window in days. Mutually exclusive with since/until.' },
    since: { type: 'string', format: 'date-time', description: 'Explicit window start (overrides days).' },
    until: { type: 'string', format: 'date-time', description: 'Explicit window end.' },
    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100, description: 'Max merged entries returned post-merge.' },
    order: { type: 'string', enum: ['desc', 'asc'], default: 'desc', description: 'Time order. desc = most-recent-first.' },
    includeBody: { type: 'boolean', default: false, description: 'Hydrate full body via getMessage where list returned only snippets.' },
  },
} as const;

/** Create and configure a comms-mcp MCP Server backed by the given dispatch + owner identity. */
export function createCommsMcpServer(dispatch: CommsDispatch, owner: OwnerIdentity): Server {
  const server = new Server(
    { name: 'comms-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'comms.recentLog',
        description:
          'Recent communications with person X — fuses late-bound message providers (quo/imessage/email) into one time-ordered UnifiedCommsEntry[] log. Per-channel failures degrade to ok:false (no silent fallback); the rest of the log still returns.',
        inputSchema,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      if (name !== 'comms.recentLog') {
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }

      const a = args as Record<string, unknown>;
      if (!a['person'] && !a['identifier']) {
        throw new Error('comms.recentLog requires exactly one of: person, identifier');
      }

      const input: RecentLogInput = {
        person: a['person'] as string | undefined,
        identifier: a['identifier'] as string | undefined,
        channels: a['channels'] as RecentLogInput['channels'],
        days: a['days'] as number | undefined,
        since: a['since'] as string | undefined,
        until: a['until'] as string | undefined,
        limit: a['limit'] as number | undefined,
        order: a['order'] as RecentLogInput['order'],
        includeBody: a['includeBody'] as boolean | undefined,
      };

      const result = await recentLog(input, { dispatch, owner });

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
