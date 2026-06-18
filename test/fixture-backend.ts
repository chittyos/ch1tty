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
};
