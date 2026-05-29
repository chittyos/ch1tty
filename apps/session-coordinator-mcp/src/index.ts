import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  SessionClient,
  type CreateSessionInput,
  type UpdateSessionInput,
  type ListSessionsFilter,
  type AppendEventInput,
} from './session-client.js';

const client = new SessionClient();

const server = new Server(
  { name: 'session-coordinator-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_sessions',
      description: 'List sessions from ChittyOS Session Coordinator, with optional filtering by channel, user, or status.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Filter by channel (e.g. "claude-code", "slack", "web")' },
          user_id: { type: 'string', description: 'Filter by user identifier' },
          status: {
            type: 'string',
            enum: ['active', 'idle', 'closed'],
            description: 'Filter by session status',
          },
          limit: { type: 'number', description: 'Maximum number of results (default: 50)' },
        },
      },
    },
    {
      name: 'get_session',
      description: 'Get full details of a session by ID, including context and event count.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'create_session',
      description: 'Create a new cross-channel session in the Session Coordinator.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel identifier (e.g. "claude-code", "slack", "web")' },
          user_id: { type: 'string', description: 'Optional user identifier associated with the session' },
          context: {
            type: 'object',
            description: 'Optional initial context key-value pairs to store on the session',
            additionalProperties: true,
          },
        },
        required: ['channel'],
      },
    },
    {
      name: 'update_session',
      description: 'Update session status or context. Use to mark a session idle, or to merge new context values.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session ID to update' },
          status: {
            type: 'string',
            enum: ['active', 'idle'],
            description: 'New session status (cannot reopen a closed session via update; use create_session)',
          },
          context: {
            type: 'object',
            description: 'Context key-value pairs to merge into the session context',
            additionalProperties: true,
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'close_session',
      description: 'Close a session. Sets status to "closed" and records closed_at timestamp. Irreversible.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session ID to close' },
        },
        required: ['id'],
      },
    },
    {
      name: 'append_event',
      description: 'Append a structured event to a session\'s event log. Use to record agent actions, user interactions, or state transitions.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Session ID to append the event to' },
          type: { type: 'string', description: 'Event type (e.g. "user.message", "agent.tool_call", "state.transition")' },
          payload: {
            type: 'object',
            description: 'Optional structured event payload',
            additionalProperties: true,
          },
          actor: { type: 'string', description: 'Optional actor identifier (e.g. "user:u1", "agent:claude", "system")' },
        },
        required: ['session_id', 'type'],
      },
    },
    {
      name: 'list_events',
      description: 'List events in a session\'s event log, ordered by creation time.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          limit: { type: 'number', description: 'Maximum number of events to return (default: 50)' },
          cursor: { type: 'string', description: 'Pagination cursor from a previous list_events response' },
        },
        required: ['session_id'],
      },
    },
  ],
}));

function missingArg(tool: string, field: string) {
  return {
    content: [{ type: 'text' as const, text: `${tool}: required argument "${field}" is missing or not a string` }],
    isError: true,
  };
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, unknown>;

  try {
    let result: unknown;

    switch (name) {
      case 'list_sessions':
        result = await client.listSessions({
          channel: a['channel'] as string | undefined,
          user_id: a['user_id'] as string | undefined,
          status: a['status'] as ListSessionsFilter['status'],
          limit: a['limit'] as number | undefined,
        });
        break;

      case 'get_session':
        if (typeof a['id'] !== 'string' || !a['id']) return missingArg('get_session', 'id');
        result = await client.getSession(a['id']);
        break;

      case 'create_session':
        if (typeof a['channel'] !== 'string' || !a['channel']) return missingArg('create_session', 'channel');
        result = await client.createSession({
          channel: a['channel'],
          user_id: a['user_id'] as string | undefined,
          context: a['context'] as CreateSessionInput['context'],
        });
        break;

      case 'update_session':
        if (typeof a['id'] !== 'string' || !a['id']) return missingArg('update_session', 'id');
        result = await client.updateSession(a['id'], {
          status: a['status'] as UpdateSessionInput['status'],
          context: a['context'] as UpdateSessionInput['context'],
        });
        break;

      case 'close_session':
        if (typeof a['id'] !== 'string' || !a['id']) return missingArg('close_session', 'id');
        result = await client.closeSession(a['id']);
        break;

      case 'append_event':
        if (typeof a['session_id'] !== 'string' || !a['session_id']) return missingArg('append_event', 'session_id');
        if (typeof a['type'] !== 'string' || !a['type']) return missingArg('append_event', 'type');
        result = await client.appendEvent(a['session_id'], {
          type: a['type'],
          payload: a['payload'] as AppendEventInput['payload'],
          actor: a['actor'] as string | undefined,
        });
        break;

      case 'list_events':
        if (typeof a['session_id'] !== 'string' || !a['session_id']) return missingArg('list_events', 'session_id');
        result = await client.listEvents(a['session_id'], {
          limit: a['limit'] as number | undefined,
          cursor: a['cursor'] as string | undefined,
        });
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
