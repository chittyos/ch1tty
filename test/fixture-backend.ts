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
  durationMs: number;
  isError: boolean;
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
    _args?: Record<string, unknown>,
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
      this.callLog.push({ serverId, tool: toolName, durationMs, isError: true });
      return {
        content: [{ type: 'text', text: `Simulated error in ${serverId}/${toolName}` }],
        isError: true,
      };
    }
    const durationMs = Date.now() - start;
    this.callLog.push({ serverId, tool: toolName, durationMs, isError: false });
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
};
