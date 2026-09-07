/**
 * FixtureBackend — a real Backend implementation backed by in-memory fixture data.
 *
 * Implements the full Backend interface using pre-defined fixture responses
 * that mirror real backend tool shapes (neon, stripe, tasks, chittyos, etc.).
 * This is NOT a mock: it fully implements the interface with realistic data.
 * Use it to drive the real Aggregator routing + scoring paths in scenario tests.
 */
import type {
  Backend,
  BackendStatus,
  ContentItem,
  PromptEntry,
  ResourceEntry,
  ResourceTemplateEntry,
  ServerConfig,
  ToolCallResult,
  ToolEntry,
} from '../src/types.js';

export interface FixtureToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Either a result to return, or 'error' to simulate a tool-level failure. */
  response: ToolCallResult | 'error';
}

export interface FixtureServerDef {
  tools: FixtureToolDef[];
  prompts?: PromptEntry[];
  resources?: ResourceEntry[];
  /** Simulated latency in ms (applied to listTools and callTool). */
  latencyMs?: number;
  /** If true, listTools throws (simulates a backend connectivity failure). */
  listToolsError?: boolean;
}

export interface CallRecord {
  serverId: string;
  tool: string;
  args: Record<string, unknown>;
  durationMs: number;
  isError: boolean;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FixtureBackend implements Backend {
  private readonly servers = new Map<string, FixtureServerDef>();
  private readonly callLog: CallRecord[] = [];

  defineServer(serverId: string, def: FixtureServerDef): void {
    this.servers.set(serverId, def);
  }

  getCallLog(): readonly CallRecord[] {
    return this.callLog;
  }

  clearCallLog(): void {
    this.callLog.length = 0;
  }

  registerServer(_config: ServerConfig): void {
    // Registration is handled via defineServer; servers.json config is irrelevant here.
  }

  isRegistered(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  getStatus(serverId: string): BackendStatus {
    const def = this.servers.get(serverId);
    return {
      connected: !!def && !def.listToolsError,
      toolCount: def?.tools.length ?? 0,
      toolCacheAge: def ? 0 : null,
    };
  }

  async listTools(serverId: string): Promise<ToolEntry[]> {
    const def = this.servers.get(serverId);
    if (!def) return [];
    if (def.latencyMs) await sleep(def.latencyMs);
    if (def.listToolsError) {
      throw new Error(`Simulated listTools failure for server "${serverId}"`);
    }
    return def.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(
    serverId: string,
    toolName: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<ToolCallResult> {
    const def = this.servers.get(serverId);
    if (!def) {
      return {
        content: [{ type: 'text', text: `FixtureBackend: no fixture for server "${serverId}"` }],
        isError: true,
      };
    }
    const tool = def.tools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `FixtureBackend: no fixture for tool "${serverId}/${toolName}"` }],
        isError: true,
      };
    }
    const start = Date.now();
    if (def.latencyMs) await sleep(def.latencyMs);
    if (tool.response === 'error') {
      const durationMs = Date.now() - start;
      this.callLog.push({ serverId, tool: toolName, args: args ?? {}, durationMs, isError: true, timeoutMs: options?.timeoutMs });
      return {
        content: [{ type: 'text', text: `Simulated error in ${serverId}/${toolName}` }],
        isError: true,
      };
    }
    const durationMs = Date.now() - start;
    this.callLog.push({ serverId, tool: toolName, args: args ?? {}, durationMs, isError: false, timeoutMs: options?.timeoutMs });
    return tool.response;
  }

  async listResources(
    serverId: string,
  ): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    const def = this.servers.get(serverId);
    return { resources: def?.resources ?? [], templates: [] };
  }

  async readResource(
    _serverId: string,
    uri: string,
  ): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }> {
    return { contents: [{ uri, mimeType: 'text/plain', text: `fixture content for ${uri}` }] };
  }

  async listPrompts(serverId: string): Promise<PromptEntry[]> {
    const def = this.servers.get(serverId);
    return def?.prompts ?? [];
  }

  async getPrompt(
    _serverId: string,
    name: string,
  ): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return {
      description: `Fixture prompt: ${name}`,
      messages: [{ role: 'user', content: { type: 'text', text: `Run: ${name}` } }],
    };
  }

  async shutdown(): Promise<void> {
    // Nothing to tear down.
  }
}

// ── Realistic fixture definitions ─────────────────────────────────────────────
// These mirror the real tool shapes exposed by the corresponding backends.
// Responses are representative data, not random stubs.

function text(t: string): ToolCallResult {
  return { content: [{ type: 'text', text: t }] };
}

export const FIXTURE_SERVERS: Record<string, FixtureServerDef> = {
  neon: {
    tools: [
      {
        name: 'list_projects',
        description: 'List all Neon database projects in the account',
        inputSchema: { type: 'object', properties: {} },
        response: text(JSON.stringify([
          { id: 'proj-abc123', name: 'ch1tty-prod', region: 'us-east-2', created_at: '2025-11-01T00:00:00Z' },
          { id: 'proj-def456', name: 'ch1tty-dev', region: 'us-east-2', created_at: '2025-12-01T00:00:00Z' },
        ])),
      },
      {
        name: 'run_sql',
        description: 'Execute a SQL query against a Neon project database',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string' },
            sql: { type: 'string' },
          },
          required: ['project_id', 'sql'],
        },
        response: text(JSON.stringify({ rows: [{ count: '42' }], rowCount: 1 })),
      },
      {
        name: 'describe_table_schema',
        description: 'Describe the schema of a table in a Neon database project',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string' },
            table_name: { type: 'string' },
          },
          required: ['project_id', 'table_name'],
        },
        response: text(JSON.stringify({
          table: 'sessions',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'session_id', type: 'text', nullable: false },
            { name: 'created_at', type: 'timestamptz', nullable: false },
          ],
        })),
      },
      {
        name: 'create_project',
        description: 'Create a new Neon database project',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' }, region: { type: 'string' } },
          required: ['name'],
        },
        response: text(JSON.stringify({ id: 'proj-new789', name: 'new-project', status: 'creating' })),
      },
    ],
    prompts: [
      { name: 'neon-query-helper', description: 'Guide for writing efficient Neon SQL queries' },
    ],
  },

  stripe: {
    tools: [
      {
        name: 'list_payments',
        description: 'List recent payment intents from the Stripe account',
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number' }, status: { type: 'string' } },
        },
        response: text(JSON.stringify({
          data: [
            { id: 'pi_abc', amount: 2999, currency: 'usd', status: 'succeeded' },
            { id: 'pi_def', amount: 4999, currency: 'usd', status: 'requires_payment_method' },
          ],
          has_more: false,
        })),
      },
      {
        name: 'get_balance',
        description: 'Get the current Stripe account balance for payments and billing',
        inputSchema: { type: 'object', properties: {} },
        response: text(JSON.stringify({ available: [{ amount: 150000, currency: 'usd' }] })),
      },
      {
        name: 'create_payment_intent',
        description: 'Create a new Stripe payment intent for a charge or billing event',
        inputSchema: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            currency: { type: 'string' },
          },
          required: ['amount', 'currency'],
        },
        response: text(JSON.stringify({ id: 'pi_new', status: 'requires_payment_method' })),
      },
    ],
  },

  tasks: {
    tools: [
      {
        name: 'list_tasks',
        description: 'List tasks for a ChittyOS entity or project',
        inputSchema: {
          type: 'object',
          properties: {
            entity_id: { type: 'string' },
            status: { type: 'string', enum: ['open', 'done', 'all'] },
          },
        },
        response: text(JSON.stringify([
          { id: 'task-1', title: 'Review PR #49', status: 'open', priority: 'high' },
          { id: 'task-2', title: 'Write scenario tests', status: 'done', priority: 'medium' },
        ])),
      },
      {
        name: 'create_task',
        description: 'Create a new task for a ChittyOS entity',
        inputSchema: {
          type: 'object',
          properties: {
            entity_id: { type: 'string' },
            title: { type: 'string' },
            priority: { type: 'string' },
          },
          required: ['entity_id', 'title'],
        },
        response: text(JSON.stringify({ id: 'task-new', status: 'open' })),
      },
      {
        name: 'update_task',
        description: 'Update the status or details of an existing task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            status: { type: 'string' },
          },
          required: ['task_id'],
        },
        response: text(JSON.stringify({ id: 'task-1', status: 'done' })),
      },
    ],
  },

  session: {
    tools: [
      {
        name: 'list_sessions',
        description: 'List sessions from ChittyOS Session Coordinator, with optional filtering by channel, user, or status.',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            user_id: { type: 'string' },
            status: { type: 'string', enum: ['active', 'idle', 'closed'] },
            limit: { type: 'number' },
          },
        },
        response: text(JSON.stringify([
          { id: 'sess-1', channel: 'claude-code', user_id: 'u1', status: 'active', event_count: 5, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T11:00:00Z' },
          { id: 'sess-2', channel: 'slack', user_id: 'u2', status: 'idle', event_count: 0, created_at: '2026-01-02T08:00:00Z', updated_at: '2026-01-02T08:00:00Z' },
        ])),
      },
      {
        name: 'get_session',
        description: 'Get full details of a session by ID, including context and event count.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: text(JSON.stringify({ id: 'sess-1', channel: 'claude-code', user_id: 'u1', status: 'active', context: { project: 'ch1tty' }, event_count: 5, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T11:00:00Z' })),
      },
      {
        name: 'create_session',
        description: 'Create a new cross-channel session in the Session Coordinator.',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            user_id: { type: 'string' },
            context: { type: 'object' },
          },
          required: ['channel'],
        },
        response: text(JSON.stringify({ id: 'sess-1', channel: 'claude-code', status: 'active', event_count: 0, created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z' })),
      },
      {
        name: 'update_session',
        description: 'Update session status or context.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['active', 'idle', 'closed'] },
            context: { type: 'object' },
          },
          required: ['id'],
        },
        response: text(JSON.stringify({ id: 'sess-1', status: 'idle', updated_at: '2026-09-05T01:00:00Z' })),
      },
      {
        name: 'close_session',
        description: 'Close a session. Sets status to "closed" and records closed_at timestamp.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: text(JSON.stringify({ id: 'sess-1', status: 'closed', closed_at: '2026-09-05T02:00:00Z' })),
      },
      {
        name: 'append_event',
        description: 'Append a structured event to a session\'s event log.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: { type: 'string' },
            type: { type: 'string' },
            payload: { type: 'object' },
            actor: { type: 'string' },
          },
          required: ['session_id', 'type'],
        },
        response: text(JSON.stringify({ id: 'ev-new', session_id: 'sess-1', type: 'agent.tool_call', created_at: '2026-09-05T00:05:00Z' })),
      },
      {
        name: 'list_events',
        description: 'List events in a session\'s event log, ordered by creation time.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: { type: 'string' },
            limit: { type: 'number' },
            after: { type: 'string' },
          },
          required: ['session_id'],
        },
        response: text(JSON.stringify({
          events: [
            { id: 'ev-1', session_id: 'sess-1', type: 'user.message', payload: { text: 'hello' }, actor: 'user:u1', created_at: '2026-01-01T10:05:00Z' },
            { id: 'ev-2', session_id: 'sess-1', type: 'agent.tool_call', payload: { tool: 'search', query: 'neon' }, actor: 'agent:claude', created_at: '2026-01-01T10:06:00Z' },
          ],
          has_more: false,
        })),
      },
    ],
  },

  chittyos: {
    tools: [
      {
        name: 'get_entity',
        description: 'Retrieve a ChittyOS entity by its chittyId',
        inputSchema: {
          type: 'object',
          properties: { chitty_id: { type: 'string' } },
          required: ['chitty_id'],
        },
        response: text(JSON.stringify({ chittyId: 'nick@nevershitty.com', tier: 1, status: 'active' })),
      },
      {
        name: 'list_services',
        description: 'List registered ChittyOS services in the ecosystem registry',
        inputSchema: { type: 'object', properties: { category: { type: 'string' } } },
        response: text(JSON.stringify([
          { id: 'ch1tty', domain: 'ch1tty.chitty.cc', status: 'healthy' },
          { id: 'chittyauth', domain: 'auth.chitty.cc', status: 'healthy' },
        ])),
      },
      {
        name: 'get_health',
        description: 'Get the health status of a ChittyOS service by ID',
        inputSchema: {
          type: 'object',
          properties: { service_id: { type: 'string' } },
          required: ['service_id'],
        },
        response: text(JSON.stringify({ status: 'healthy', uptime: 99.98 })),
      },
    ],
    prompts: [
      { name: 'chittyos-onboarding', description: 'ChittyOS ecosystem onboarding guide' },
    ],
  },

  playwright: {
    tools: [
      {
        name: 'navigate',
        description: 'Navigate the browser to a URL for desktop automation',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
        response: text(JSON.stringify({ status: 'navigated', url: 'https://example.com' })),
      },
      {
        name: 'screenshot',
        description: 'Take a screenshot of the current browser viewport',
        inputSchema: {
          type: 'object',
          properties: { fullPage: { type: 'boolean' } },
        },
        response: { content: [{ type: 'text', text: 'screenshot:data:image/png;base64,abc123' }] },
      },
      {
        name: 'click',
        description: 'Click a DOM element identified by CSS selector for desktop automation',
        inputSchema: {
          type: 'object',
          properties: { selector: { type: 'string' } },
          required: ['selector'],
        },
        response: text(JSON.stringify({ clicked: true })),
      },
      {
        name: 'fill_form',
        description: 'Fill a form field in the browser for desktop automation',
        inputSchema: {
          type: 'object',
          properties: { selector: { type: 'string' }, value: { type: 'string' } },
          required: ['selector', 'value'],
        },
        response: text(JSON.stringify({ filled: true })),
      },
    ],
  },

  notion: {
    tools: [
      {
        name: 'search',
        description: 'Search pages and databases in the Notion workspace for documents',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        response: text(JSON.stringify({ results: [{ id: 'page-abc', title: 'Architecture Notes' }] })),
      },
      {
        name: 'create_page',
        description: 'Create a new page in a Notion workspace for documentation',
        inputSchema: {
          type: 'object',
          properties: {
            parent_id: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['title'],
        },
        response: text(JSON.stringify({ id: 'page-new', url: 'https://notion.so/page-new' })),
      },
      {
        name: 'get_page',
        description: 'Get the content of a Notion page document by ID',
        inputSchema: {
          type: 'object',
          properties: { page_id: { type: 'string' } },
          required: ['page_id'],
        },
        response: text(JSON.stringify({ id: 'page-abc', title: 'Architecture Notes', blocks: [] })),
      },
    ],
    resources: [
      { uri: 'notion://workspace', name: 'Notion Workspace', description: 'Full Notion workspace access' },
    ],
  },

  github: {
    tools: [
      {
        name: 'create_pull_request',
        description: 'Create a GitHub pull request to merge a feature branch into the target branch',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string' },
            head: { type: 'string' },
            base: { type: 'string' },
          },
          required: ['owner', 'repo', 'title', 'head'],
        },
        response: text(JSON.stringify({ number: 42, html_url: 'https://github.com/org/repo/pull/42', state: 'open' })),
      },
      {
        name: 'create_issue',
        description: 'Create a GitHub issue for bug tracking or feature requests in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['owner', 'repo', 'title'],
        },
        response: text(JSON.stringify({ number: 7, html_url: 'https://github.com/org/repo/issues/7', state: 'open' })),
      },
      {
        name: 'list_pull_requests',
        description: 'List open pull requests in a GitHub repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            state: { type: 'string', enum: ['open', 'closed', 'all'] },
          },
          required: ['owner', 'repo'],
        },
        response: text(JSON.stringify([
          { number: 41, title: 'feat: add code focus profile', state: 'open' },
          { number: 42, title: 'fix: circuit breaker timing', state: 'open' },
        ])),
      },
      {
        name: 'search_code',
        description: 'Search GitHub code repositories for source code patterns or function definitions',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            language: { type: 'string' },
          },
          required: ['query'],
        },
        response: text(JSON.stringify({ total_count: 3, items: [{ path: 'src/aggregator.ts', score: 0.9 }] })),
      },
    ],
  },

  context7: {
    tools: [
      {
        name: 'query-docs',
        description: 'Get library documentation and code examples for a package by library ID',
        inputSchema: {
          type: 'object',
          properties: {
            libraryId: { type: 'string' },
            query: { type: 'string' },
          },
          required: ['libraryId', 'query'],
        },
        response: text(JSON.stringify({
          libraryId: '/modelcontextprotocol/typescript-sdk',
          snippets: [
            { content: 'const server = new McpServer({ name: "my-server", version: "1.0.0" });', description: 'Creating an MCP server' },
            { content: 'server.tool("my-tool", async (args) => { ... })', description: 'Registering a tool handler' },
          ],
        })),
      },
      {
        name: 'resolve-library-id',
        description: 'Resolve a library name or npm package name to its context7 library ID',
        inputSchema: {
          type: 'object',
          properties: { libraryName: { type: 'string' } },
          required: ['libraryName'],
        },
        response: text(JSON.stringify({ libraryId: '/modelcontextprotocol/typescript-sdk', name: '@modelcontextprotocol/sdk' })),
      },
    ],
  },

  imessage: {
    tools: [
      {
        name: 'send_message',
        description: 'Send an iMessage or SMS text message to a contact or phone number',
        inputSchema: {
          type: 'object',
          properties: {
            recipient: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['recipient', 'message'],
        },
        response: text(JSON.stringify({ delivered: true, timestamp: '2026-05-30T00:00:00Z' })),
      },
      {
        name: 'search_messages',
        description: 'Search iMessage chat history for a contact or keyword',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            contact: { type: 'string' },
          },
          required: ['query'],
        },
        response: text(JSON.stringify([
          { id: 'msg-1', text: 'Deployment went live at 10pm', timestamp: '2026-05-29T22:00:00Z' },
        ])),
      },
      {
        name: 'list_recent_messages',
        description: 'List recent iMessage conversations and messages',
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number' } },
        },
        response: text(JSON.stringify([
          { contact: 'team', lastMessage: 'Ready for code review', timestamp: '2026-05-30T00:00:00Z' },
        ])),
      },
    ],
  },

  cloudflare: {
    tools: [
      {
        name: 'deploy_worker',
        description: 'Deploy a Cloudflare Worker script to production or a named environment',
        inputSchema: {
          type: 'object',
          properties: {
            script_name: { type: 'string' },
            script: { type: 'string' },
            environment: { type: 'string', enum: ['production', 'staging'] },
          },
          required: ['script_name', 'script'],
        },
        response: text(JSON.stringify({ id: 'worker-abc', name: 'my-worker', status: 'deployed', url: 'https://my-worker.example.workers.dev' })),
      },
      {
        name: 'list_workers',
        description: 'List all Cloudflare Workers deployed in the account',
        inputSchema: {
          type: 'object',
          properties: { environment: { type: 'string' } },
        },
        response: text(JSON.stringify([
          { id: 'worker-ch1tty', name: 'ch1tty-gateway', status: 'active', last_deployed: '2026-05-30T00:00:00Z' },
          { id: 'worker-chittyauth', name: 'chittyauth', status: 'active', last_deployed: '2026-05-29T12:00:00Z' },
        ])),
      },
      {
        name: 'get_worker_logs',
        description: 'Get recent logs and error traces from a deployed Cloudflare Worker for debugging',
        inputSchema: {
          type: 'object',
          properties: {
            worker_name: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['worker_name'],
        },
        response: text(JSON.stringify({
          worker: 'ch1tty-gateway',
          logs: [
            { timestamp: '2026-05-30T03:00:00Z', level: 'info', message: 'Request handled in 45ms' },
            { timestamp: '2026-05-30T02:59:00Z', level: 'error', message: 'Backend timeout: neon connection refused' },
          ],
        })),
      },
    ],
  },

  'cloudflare-builds': {
    tools: [
      {
        name: 'workers_builds_list_builds',
        description: 'List recent Cloudflare Workers Builds build runs with status, timestamps, and error summaries for a Worker',
        inputSchema: {
          type: 'object',
          properties: {
            workerId: { type: 'string' },
            page: { type: 'number' },
            perPage: { type: 'number' },
          },
          required: [],
        },
        response: text(JSON.stringify([
          { buildUUID: 'uuid-abc', worker: 'ch1tty-gateway', status: 'success', triggered_at: '2026-06-05T06:00:00Z', duration_ms: 45000 },
          { buildUUID: 'uuid-xyz', worker: 'ch1tty-gateway', status: 'failed', triggered_at: '2026-06-04T22:00:00Z', error: 'Build command exited with code 1' },
        ])),
      },
      {
        name: 'workers_builds_get_build',
        description: 'Get details of a specific Cloudflare Workers Builds build run including configuration, status, and deployment outcome',
        inputSchema: {
          type: 'object',
          properties: {
            buildUUID: { type: 'string' },
          },
          required: ['buildUUID'],
        },
        response: text(JSON.stringify({
          buildUUID: 'uuid-xyz',
          worker: 'ch1tty-gateway',
          status: 'failed',
          triggered_at: '2026-06-04T22:00:00Z',
          error: 'Build command exited with code 1',
        })),
      },
      {
        name: 'workers_builds_get_build_logs',
        description: 'Get build logs from a specific Cloudflare Workers Builds run for debugging failed builds and deployment errors',
        inputSchema: {
          type: 'object',
          properties: {
            buildUUID: { type: 'string' },
          },
          required: ['buildUUID'],
        },
        response: text(JSON.stringify({
          buildUUID: 'uuid-xyz',
          logs: 'Error: Build command exited with code 1\nnpm ERR! missing script: build',
        })),
      },
      {
        name: 'workers_builds_set_active_worker',
        description: 'Set the active Worker ID for subsequent Workers Builds API calls in this session',
        inputSchema: {
          type: 'object',
          properties: {
            workerId: { type: 'string' },
          },
          required: ['workerId'],
        },
        response: text(JSON.stringify({ workerId: 'ch1tty-gateway', status: 'active' })),
      },
    ],
  },

  orchestrator: {
    tools: [
      {
        name: 'skill_search',
        description: 'Search for skills by intent, keyword, or trigger — returns ranked matches with relevance scores for skill discovery',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
        response: text(JSON.stringify([{ id: 'chittyos-devops:chitty-deploy', name: 'chitty-deploy', score: 0.92 }])),
      },
      {
        name: 'skill_execute',
        description: 'Execute a registered skill by ID or name with arguments — delegates to skill MCP server, agent worker, or returns local instructions',
        inputSchema: {
          type: 'object',
          properties: {
            skill_id: { type: 'string' },
            args: { type: 'object' },
          },
          required: ['skill_id'],
        },
        response: text(JSON.stringify({ ok: true, skill_id: 'chittyos-devops:chitty-deploy', result: { deployed: true } })),
      },
      {
        name: 'agent_list',
        description: 'List all agents in the ChittyAgent ecosystem with binding status, capabilities, domains, and tool counts',
        inputSchema: {
          type: 'object',
          properties: {
            status_filter: { type: 'string', enum: ['bound', 'unbound', 'all'] },
          },
        },
        response: text(JSON.stringify([
          { id: 'cloudflare', status: 'bound', capabilities: ['deploy', 'dns'], tools: 14 },
          { id: 'notion', status: 'bound', capabilities: ['pages', 'databases'], tools: 22 },
        ])),
      },
      {
        name: 'provision_evaluate',
        description: 'Evaluate which ChittyID context entity should serve this session with TY-VY-RY scoring for identity, connectivity, and authority',
        inputSchema: {
          type: 'object',
          properties: {
            intent: { type: 'string' },
            support_type: { type: 'string' },
          },
        },
        response: text(JSON.stringify({ session_id: 'sess-abc123', decision: 'bind_existing', candidate: 'chittyagent-devops', ty: 4.2, vy: 3.8, ry: 4.0 })),
      },
    ],
  },

  fs: {
    tools: [
      {
        name: 'read_file',
        description: 'Read the contents of a file from the filesystem',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        response: text(JSON.stringify({ path: '/home/user/ch1tty/servers.json', content: '{"servers":[...]}', size: 4096 })),
      },
      {
        name: 'write_file',
        description: 'Write content to a file on the filesystem',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
        response: text(JSON.stringify({ path: '/tmp/deploy-report.md', written: true, bytes: 256 })),
      },
      {
        name: 'list_directory',
        description: 'List files and directories in a filesystem path',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        response: text(JSON.stringify([
          { name: 'src', type: 'directory' },
          { name: 'test', type: 'directory' },
          { name: 'package.json', type: 'file', size: 692 },
        ])),
      },
    ],
  },

  chittyevidence: {
    tools: [
      {
        name: 'ingest_document',
        description: 'Submit a document for indexing in ChittyEvidence. Returns the document record with its assigned canonical URI.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            kind: { type: 'string' },
            title: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['content', 'kind'],
        },
        response: text(JSON.stringify({
          id: 'doc-1',
          canonical_uri: 'chittycanon://evidence/doc-1',
          kind: 'note',
          title: 'Test Document',
          content: 'Sample content',
          tags: ['test'],
          metadata: {},
          created_at: '2026-09-05T00:00:00Z',
        })),
      },
      {
        name: 'list_documents',
        description: 'List ingested documents with optional filtering by kind, tag, or creation time.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            tag: { type: 'string' },
            since: { type: 'string' },
            cursor: { type: 'string' },
            limit: { type: 'number' },
          },
        },
        response: text(JSON.stringify({
          documents: [
            { id: 'doc-1', canonical_uri: 'chittycanon://evidence/doc-1', kind: 'note', title: 'Architecture Decision', tags: ['architecture'], created_at: '2026-09-01T00:00:00Z' },
            { id: 'doc-2', canonical_uri: 'chittycanon://evidence/doc-2', kind: 'report', title: 'Q3 Evidence Report', tags: ['report', 'q3'], created_at: '2026-09-02T00:00:00Z' },
          ],
          has_more: false,
        })),
      },
      {
        name: 'get_document',
        description: 'Get a single document by its ID, including content, canonical URI, and metadata.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: text(JSON.stringify({
          id: 'doc-1',
          canonical_uri: 'chittycanon://evidence/doc-1',
          kind: 'note',
          title: 'Architecture Decision',
          content: 'We decided to use the slim-MCP pattern for all gateway surfaces.',
          tags: ['architecture'],
          metadata: { author: 'nick@nevershitty.com' },
          created_at: '2026-09-01T00:00:00Z',
        })),
      },
      {
        name: 'search_documents',
        description: 'Search the evidence corpus by keyword or phrase. Returns ranked matches.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            kind: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
        response: text(JSON.stringify({
          documents: [
            { id: 'doc-1', canonical_uri: 'chittycanon://evidence/doc-1', kind: 'note', title: 'Architecture Decision', tags: ['architecture'], created_at: '2026-09-01T00:00:00Z' },
          ],
          total: 1,
        })),
      },
      {
        name: 'get_canonical_uri',
        description: 'Resolve a document ID to its canonical URI (chittycanon:// scheme).',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: text(JSON.stringify({ id: 'doc-1', canonical_uri: 'chittycanon://evidence/doc-1' })),
      },
    ],
  },

  comms: {
    tools: [
      {
        name: 'comms.recentLog',
        description: 'Recent communications with person X — fuses late-bound message providers (quo/imessage/email) into one time-ordered UnifiedCommsEntry[] log',
        inputSchema: {
          type: 'object',
          oneOf: [{ required: ['person'] }, { required: ['identifier'] }],
          properties: {
            person: { type: 'string' },
            identifier: { type: 'string' },
            channels: { type: 'array', items: { type: 'string', enum: ['quo', 'imessage', 'email', 'twilio', 'voice'] } },
            days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
            since: { type: 'string', format: 'date-time' },
            until: { type: 'string', format: 'date-time' },
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
            order: { type: 'string', enum: ['desc', 'asc'], default: 'desc' },
            includeBody: { type: 'boolean', default: false },
          },
        },
        response: text(JSON.stringify({
          ok: true,
          entries: [
            {
              id: 'entry-001',
              channel: 'quo',
              direction: 'inbound',
              self: false,
              timestamp: '2026-09-04T18:32:00Z',
              snippet: 'Deploy looked good — all green.',
              parties: [{ identifier: '+13122186717', self: false, displayName: 'Nick' }],
            },
            {
              id: 'entry-002',
              channel: 'imessage',
              direction: 'outbound',
              self: true,
              timestamp: '2026-09-04T18:30:00Z',
              snippet: 'Just pushed the fix — checking CI now.',
              parties: [{ identifier: '+13122186717', self: false, displayName: 'Nick' }],
            },
            {
              id: 'entry-003',
              channel: 'email',
              direction: 'inbound',
              self: false,
              timestamp: '2026-09-04T09:15:00Z',
              snippet: 'Re: Q3 planning — can we meet Thursday?',
              parties: [{ identifier: 'nick@nevershitty.com', self: false, displayName: 'Nick' }],
            },
          ],
          channelResults: [
            { channel: 'quo', ok: true, count: 1 },
            { channel: 'imessage', ok: true, count: 1 },
            { channel: 'email', ok: true, count: 1 },
          ],
        })),
      },
    ],
  },

  chittymac: {
    tools: [
      {
        name: 'search_notes',
        description: 'Search Apple Notes for content matching a query',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        response: text(JSON.stringify([
          { id: 'note-1', title: 'Team meeting 2026-05-29', content: 'Action items: review PRs, update docs' },
        ])),
      },
      {
        name: 'create_note',
        description: 'Create a new Apple Note with title and content',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            folder: { type: 'string' },
          },
          required: ['title'],
        },
        response: text(JSON.stringify({ id: 'note-new', title: 'New Note', created: true })),
      },
      {
        name: 'list_notes',
        description: 'List all Apple Notes in a folder',
        inputSchema: {
          type: 'object',
          properties: { folder: { type: 'string' } },
        },
        response: text(JSON.stringify([
          { id: 'note-1', title: 'Team meeting 2026-05-29', folder: 'Work' },
          { id: 'note-2', title: 'Architecture decisions', folder: 'Work' },
        ])),
      },
    ],
  },

  turbotenant: {
    tools: [
      {
        name: 'list_properties',
        description: 'List all managed rental properties in TurboTenant account',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            status: { type: 'string', enum: ['active', 'inactive', 'all'] },
          },
        },
        response: text(JSON.stringify({
          properties: [
            { id: 'prop-001', address: '123 Main St, Chicago, IL 60601', units: 4, status: 'active', monthly_rent: 1400 },
            { id: 'prop-002', address: '456 Oak Ave, Chicago, IL 60614', units: 1, status: 'active', monthly_rent: 1850 },
          ],
          total: 2,
        })),
      },
      {
        name: 'get_property',
        description: 'Get details for a specific rental property by ID',
        inputSchema: {
          type: 'object',
          properties: { property_id: { type: 'string' } },
          required: ['property_id'],
        },
        response: text(JSON.stringify({
          id: 'prop-001',
          address: '123 Main St, Chicago, IL 60601',
          units: 4,
          status: 'active',
          monthly_rent: 1400,
          owner: 'nick@nevershitty.com',
          created_at: '2025-01-15T00:00:00Z',
        })),
      },
      {
        name: 'list_tenants',
        description: 'List tenants for a specific property with lease and contact details',
        inputSchema: {
          type: 'object',
          properties: {
            property_id: { type: 'string' },
            status: { type: 'string', enum: ['active', 'past', 'all'] },
          },
          required: ['property_id'],
        },
        response: text(JSON.stringify({
          tenants: [
            { id: 'ten-101', name: 'Alice Johnson', unit: '1A', lease_end: '2027-01-31', rent_status: 'current', email: 'alice@example.com' },
            { id: 'ten-102', name: 'Bob Martinez', unit: '1B', lease_end: '2026-12-31', rent_status: 'current', email: 'bob@example.com' },
          ],
          total: 2,
        })),
      },
      {
        name: 'list_maintenance_requests',
        description: 'List open and recent maintenance requests across managed properties',
        inputSchema: {
          type: 'object',
          properties: {
            property_id: { type: 'string' },
            status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'all'] },
            limit: { type: 'number' },
          },
        },
        response: text(JSON.stringify({
          requests: [
            { id: 'mr-201', property_id: 'prop-001', unit: '1A', category: 'plumbing', description: 'Leaking faucet in kitchen', status: 'open', priority: 'medium', reported_at: '2026-09-01T08:00:00Z' },
            { id: 'mr-202', property_id: 'prop-001', unit: '1B', category: 'hvac', description: 'AC not cooling', status: 'in_progress', priority: 'high', reported_at: '2026-09-03T14:00:00Z' },
          ],
          total: 2,
        })),
      },
      {
        name: 'create_maintenance_request',
        description: 'Create a new maintenance request for a rental property unit',
        inputSchema: {
          type: 'object',
          properties: {
            property_id: { type: 'string' },
            unit: { type: 'string' },
            category: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'emergency'] },
          },
          required: ['property_id', 'unit', 'description'],
        },
        response: text(JSON.stringify({
          id: 'mr-new',
          property_id: 'prop-001',
          unit: '2A',
          category: 'electrical',
          description: 'Outlet not working',
          status: 'open',
          priority: 'medium',
          created_at: '2026-09-06T12:00:00Z',
        })),
      },
    ],
  },

  ledger: {
    tools: [
      {
        name: 'list_namespaces',
        description: 'List all available ledger namespaces with entry counts and timestamps',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        response: text(JSON.stringify([
          { name: 'events', entry_count: 42, created_at: '2026-01-01T00:00:00Z', last_entry_at: '2026-09-01T10:00:00Z' },
          { name: 'audit', entry_count: 7, created_at: '2026-02-01T00:00:00Z', last_entry_at: '2026-08-30T09:00:00Z' },
        ])),
      },
      {
        name: 'list_entries',
        description: 'List entries in a ledger namespace with optional cursor pagination and time-range filtering',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string' },
            cursor: { type: 'string' },
            limit: { type: 'number' },
            since: { type: 'string' },
          },
          required: ['namespace'],
        },
        response: text(JSON.stringify({
          entries: [
            { id: 'e1', namespace: 'events', payload: { type: 'deploy', service: 'ch1tty' }, sequence: 1, created_at: '2026-09-01T10:00:00Z' },
            { id: 'e2', namespace: 'events', payload: { type: 'config.reload', service: 'ch1tty' }, sequence: 2, created_at: '2026-09-01T10:05:00Z' },
          ],
          has_more: false,
        })),
      },
      {
        name: 'get_entry',
        description: 'Get a single ledger entry by namespace and entry ID',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string' },
            id: { type: 'string' },
          },
          required: ['namespace', 'id'],
        },
        response: text(JSON.stringify({
          id: 'e-new',
          namespace: 'events',
          payload: { type: 'deploy', service: 'ch1tty' },
          sequence: 1,
          created_at: '2026-09-01T10:00:00Z',
        })),
      },
      {
        name: 'append_entry',
        description: 'Append a new immutable entry to a ledger namespace',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string' },
            payload: { type: 'object', additionalProperties: true },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['namespace', 'payload'],
        },
        response: text(JSON.stringify({
          id: 'e-new',
          namespace: 'events',
          payload: { type: 'audit.record' },
          sequence: 43,
          created_at: '2026-09-05T12:00:00Z',
        })),
      },
    ],
  },
  google: {
    tools: [
      {
        name: 'list_events',
        description: 'List upcoming Google Calendar events for the authenticated user',
        inputSchema: {
          type: 'object',
          properties: {
            calendar_id: { type: 'string' },
            max_results: { type: 'number' },
            time_min: { type: 'string', description: 'ISO 8601 start bound' },
          },
        },
        response: text(JSON.stringify({
          events: [
            { id: 'evt-001', summary: 'Weekly Standup', start: '2026-09-08T09:00:00Z', end: '2026-09-08T09:30:00Z', attendees: ['alice@example.com', 'bob@example.com'] },
            { id: 'evt-002', summary: 'Product Review', start: '2026-09-08T14:00:00Z', end: '2026-09-08T15:00:00Z', attendees: ['nick@nevershitty.com'] },
          ],
          total: 2,
        })),
      },
      {
        name: 'list_files',
        description: 'List files in Google Drive matching a query',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            page_size: { type: 'number' },
            folder_id: { type: 'string' },
          },
        },
        response: text(JSON.stringify({
          files: [
            { id: 'file-001', name: 'Q3 Report.docx', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-08-30T10:00:00Z' },
            { id: 'file-002', name: 'Budget 2026.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-01T08:00:00Z' },
          ],
          total: 2,
        })),
      },
      {
        name: 'send_email',
        description: 'Send an email via Gmail on behalf of the authenticated user',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            subject: { type: 'string' },
            body: { type: 'string' },
            cc: { type: 'string' },
          },
          required: ['to', 'subject', 'body'],
        },
        response: text(JSON.stringify({
          message_id: 'msg-001',
          thread_id: 'thread-001',
          status: 'sent',
          to: 'alice@example.com',
        })),
      },
      {
        name: 'create_document',
        description: 'Create a new Google Doc with given title and optional initial content',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            folder_id: { type: 'string' },
          },
          required: ['title'],
        },
        response: text(JSON.stringify({
          document_id: 'doc-001',
          title: 'Meeting Notes — 2026-09-08',
          url: 'https://docs.google.com/document/d/doc-001/edit',
          created_at: '2026-09-08T09:30:00Z',
        })),
      },
    ],
  },
  gam: {
    tools: [
      {
        name: 'list_users',
        description: 'List all users in the Google Workspace organization via GAM',
        inputSchema: {
          type: 'object',
          properties: {
            domain: { type: 'string' },
            max_results: { type: 'number' },
            query: { type: 'string' },
          },
        },
        response: text(JSON.stringify({
          users: [
            { id: 'usr-001', email: 'alice@example.com', name: 'Alice Johnson', suspended: false, admin: false },
            { id: 'usr-002', email: 'bob@example.com', name: 'Bob Martinez', suspended: false, admin: false },
            { id: 'usr-003', email: 'nick@nevershitty.com', name: 'Nick', suspended: false, admin: true },
          ],
          total: 3,
        })),
      },
      {
        name: 'get_user',
        description: 'Get details for a specific Google Workspace user by email or user ID',
        inputSchema: {
          type: 'object',
          properties: { user_key: { type: 'string' } },
          required: ['user_key'],
        },
        response: text(JSON.stringify({
          id: 'usr-001',
          email: 'alice@example.com',
          name: 'Alice Johnson',
          suspended: false,
          admin: false,
          last_login: '2026-09-05T08:00:00Z',
          org_unit: '/Engineering',
        })),
      },
      {
        name: 'list_groups',
        description: 'List Google Groups in the organization',
        inputSchema: {
          type: 'object',
          properties: {
            domain: { type: 'string' },
            user_key: { type: 'string' },
          },
        },
        response: text(JSON.stringify({
          groups: [
            { id: 'grp-001', email: 'eng@example.com', name: 'Engineering', direct_members_count: 8 },
            { id: 'grp-002', email: 'all@example.com', name: 'All Staff', direct_members_count: 25 },
          ],
          total: 2,
        })),
      },
      {
        name: 'suspend_user',
        description: 'Suspend a Google Workspace user account via GAM',
        inputSchema: {
          type: 'object',
          properties: { user_key: { type: 'string' }, reason: { type: 'string' } },
          required: ['user_key'],
        },
        response: text(JSON.stringify({
          user_key: 'alice@example.com',
          suspended: true,
          updated_at: '2026-09-08T10:00:00Z',
        })),
      },
    ],
  },
};
