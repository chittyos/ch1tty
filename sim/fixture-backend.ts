/**
 * FixtureBackend — a REAL implementation of the {@link Backend} interface for
 * driving the gateway through end-to-end simulation scenarios.
 *
 * This is NOT a module mock. It is a genuine Backend whose `listTools` / `callTool`
 * return realistic, ChittyOS-shaped data in-process so the Aggregator can be
 * exercised without live credentials. The gateway routes through the normal
 * registerServer → listTools → callTool path; only the transport is in-memory.
 *
 * Tool catalogs are deliberately seeded with near-miss tools across servers
 * (e.g. both stripe/create_invoice and notion/create_invoice_page) so that
 * `cast` resolution is actually tested — not mere enumeration.
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

export interface FixtureTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * The fixture tool catalog, keyed by real server id (from servers.json).
 * Descriptions mirror the shape of real MCP tool descriptions so keyword
 * scoring behaves the way it would against production backends.
 */
export const FIXTURE_TOOLS: Record<string, FixtureTool[]> = {
  // ── finance / ecosystem ──────────────────────────────────────
  stripe: [
    { name: 'create_invoice', description: 'Create a Stripe invoice for a customer with line items and amount' },
    { name: 'create_customer', description: 'Create a Stripe customer record with email and name' },
    { name: 'find_customer', description: 'Search Stripe customers by email or name' },
    { name: 'record_charge', description: 'Record a payment charge against a Stripe customer' },
    { name: 'list_subscriptions', description: 'List active Stripe subscriptions for a customer' },
  ],
  tasks: [
    { name: 'create_task', description: 'Create a task in the ChittyAgent distributed task queue' },
    { name: 'list_tasks', description: 'List queued tasks for a session or entity' },
    // near-miss: a tasks "invoice"-shaped tool to compete with stripe
    { name: 'record_billing_event', description: 'Record a billing event task for later invoice reconciliation' },
  ],

  // ── ledger / ecosystem ───────────────────────────────────────
  ledger: [
    { name: 'list_namespaces', description: 'List all ledger namespaces in the ChittyLedger append-only store' },
    { name: 'list_entries', description: 'List ledger entries in a namespace, with cursor pagination and since filter' },
    { name: 'get_entry', description: 'Get a specific ledger entry by namespace and entry ID' },
    { name: 'append_entry', description: 'Append an immutable entry to the ChittyLedger append-only ledger' },
  ],
  session: [
    { name: 'list_sessions', description: 'List cross-agent coordination sessions by channel or status' },
    { name: 'get_session', description: 'Get details of a specific coordination session by session ID' },
    { name: 'create_session', description: 'Create a new cross-agent coordination session for tracking a workflow' },
    { name: 'update_session', description: 'Update metadata or status of an existing coordination session' },
    { name: 'close_session', description: 'Close a coordination session and mark it as completed' },
    { name: 'append_event', description: 'Append an event to a coordination session event log' },
    { name: 'list_events', description: 'List events in a coordination session event log' },
  ],
  // ── chittyevidence / search ───────────────────────────────────
  // near-misses for the evidence server above — same family, different tools and IDs
  chittyevidence: [
    { name: 'ingest_document', description: 'Ingest a document into the evidence store and return its canonical chittycanon:// URI' },
    { name: 'list_documents', description: 'List evidence documents by kind, tag, or time range with cursor pagination' },
    { name: 'get_document', description: 'Get an evidence document by ID with full content and canonical URI' },
    { name: 'search_documents', description: 'Full-text search over the evidence document corpus by query' },
    { name: 'get_canonical_uri', description: 'Resolve an evidence document ID to its chittycanon:// canonical URI' },
  ],

  // ── governance / ecosystem + documents ───────────────────────
  chittyos: [
    { name: 'query_registry', description: 'Query the ChittyOS service registry for registered services and agents' },
    { name: 'verify_chittyid', description: 'Verify a ChittyID against the trust anchor' },
    { name: 'check_ledger', description: 'Check the ChittyLedger for a recorded entry or hash' },
  ],
  evidence: [
    { name: 'verify_fact', description: 'Verify a fact in the ChittyEvidence fact governance lifecycle (draft to verified to locked)' },
    { name: 'ingest_document', description: 'Ingest a document into the ChittyEvidence pipeline with chain of custody' },
    // near-miss: an evidence "registry"-shaped tool to compete with chittyos/query_registry
    { name: 'search_fact_registry', description: 'Search the evidence fact registry by claim, date, or amount' },
  ],
  neon: [
    { name: 'run_sql', description: 'Run a SQL query against a Neon Postgres database branch' },
    { name: 'list_projects', description: 'List Neon database projects for the organization' },
  ],
  notion: [
    { name: 'query_database', description: 'Query a Notion database view with filters and sorts' },
    { name: 'create_page', description: 'Create a Notion page in a database or workspace' },
    // near-miss: a notion "invoice"-shaped page tool to compete with stripe/create_invoice
    { name: 'create_invoice_page', description: 'Create a Notion page documenting an invoice record' },
  ],
  orchestrator: [
    // Provisioning layer — identity/session binding
    { name: 'provision_evaluate', description: 'Evaluate which ChittyID context entity should serve this session with TY-VY-RY scoring for identity, connectivity, and authority' },
    { name: 'provision_bind', description: 'Bind a session to a ChittyID context after provision_evaluate decision — executes the provisioning action' },
    { name: 'provision_fork', description: 'Fork a specialist context from an existing generalist entity inheriting domain strengths' },
    { name: 'provision_status', description: 'Get current provisioning state: active session binding, TY-VY-RY profile, recent decisions audit trail' },
    { name: 'provision_candidates', description: 'List TY-VY-RY scored candidates for session hints without making a provisioning decision — for review or override' },
    // Skill layer — find and execute registered ChittyOS skills
    { name: 'skill_list', description: 'List all available skills in the ChittyOS ecosystem with names, descriptions, triggers, and execution type' },
    { name: 'skill_search', description: 'Search for skills by intent, keyword, or trigger — returns ranked matches with relevance scores for skill discovery' },
    { name: 'skill_execute', description: 'Execute a registered skill by ID or name with arguments — delegates to skill MCP server, agent worker, or returns local instructions' },
    { name: 'skill_register', description: 'Register or update a skill in the skill index with triggers, plugin, and execution type' },
    // Agent layer — discover and route to specialist agents
    { name: 'agent_list', description: 'List all agents in the ChittyAgent ecosystem with binding status, capabilities, domains, and tool counts' },
    { name: 'agent_search', description: 'Search for agents by capability, domain, or keyword — find which agent handles a specific task' },
    { name: 'agent_execute', description: 'Execute a request on an agent through the orchestrator using the agent protocol envelope with focal trust gating' },
    { name: 'agent_register', description: 'Register or update agent metadata in the index including capabilities, descriptions, and tool counts' },
  ],

  // ── ops / ecosystem + code ───────────────────────────────────
  cloudflare: [
    { name: 'deploy_worker', description: 'Deploy a Cloudflare Worker script to production with routing configuration' },
    { name: 'list_workers', description: 'List all deployed Cloudflare Workers with current route configurations' },
    { name: 'get_worker_logs', description: 'Retrieve recent logs and errors from a deployed Cloudflare Worker' },
  ],
  'cloudflare-builds': [
    { name: 'workers_builds_list_builds', description: 'List recent Cloudflare Workers Builds build runs with status, timestamps, and error summaries for a Worker' },
    { name: 'workers_builds_get_build', description: 'Get details of a specific Cloudflare Workers Builds build run including configuration, status, and deployment outcome' },
    { name: 'workers_builds_get_build_logs', description: 'Get build logs from a specific Cloudflare Workers Builds run for debugging failed builds and deployment errors' },
    { name: 'workers_builds_set_active_worker', description: 'Set the active deployed version of a Cloudflare Worker project via Workers Builds to roll back or promote a build' },
  ],
  fs: [
    { name: 'read_file', description: 'Read the contents of a file from the filesystem by path' },
    { name: 'write_file', description: 'Write or overwrite a file on the filesystem at the given path' },
    { name: 'list_directory', description: 'List files and subdirectories in a filesystem directory path' },
  ],

  // ── design / desktop ─────────────────────────────────────────
  'browser-rendering': [
    { name: 'render_page', description: 'Render a web page to HTML or PDF via headless browser' },
    { name: 'capture_screenshot', description: 'Capture a screenshot of a rendered web page or URL' },
  ],
  playwright: [
    { name: 'navigate', description: 'Navigate a Playwright browser session to a URL' },
    { name: 'screenshot', description: 'Take a screenshot of the current Playwright page and save it' },
    { name: 'click', description: 'Click an element on the current Playwright page by selector' },
    // near-miss: a playwright "render"-shaped tool to compete with browser-rendering/render_page
    { name: 'render_to_pdf', description: 'Render the current Playwright page to a PDF file' },
  ],
  cowork: [
    { name: 'start_session', description: 'Start a Claude Co-Work desktop collaboration session' },
  ],

  // ── code / development ───────────────────────────────────────
  github: [
    { name: 'create_pull_request', description: 'Open a GitHub pull request from a branch' },
    { name: 'create_issue', description: 'Create a GitHub issue in a repository' },
  ],
  linear: [
    { name: 'list_issues', description: 'List or search Linear issues by keyword, assignee, or project' },
    { name: 'get_issue', description: 'Get full details of a Linear issue by ID or identifier' },
    { name: 'create_issue', description: 'Create a new Linear issue in a team or project' },
    { name: 'list_projects', description: 'List active Linear projects with status and completion' },
  ],
  context7: [
    { name: 'resolve-library-id', description: 'Resolve a package name or description to a Context7-compatible library ID' },
    // near-miss for governance.evidence-search: a "search library docs" tool competes with chittyevidence/search_documents
    { name: 'query-docs', description: 'Get documentation and code examples for a library from the Context7 context window' },
  ],

  // ── communication / messaging ────────────────────────────────
  chittymac: [
    { name: 'search_notes', description: 'Search Apple Notes for notes matching a text query' },
    { name: 'create_note', description: 'Create a new Apple Note in a folder' },
    { name: 'list_notes', description: 'List recent Apple Notes in a folder or inbox' },
    { name: 'get_note', description: 'Get the full content of an Apple Note by title or ID' },
  ],
  imessage: [
    { name: 'send_message', description: 'Send an iMessage or SMS text to a contact or group chat' },
    { name: 'list_conversations', description: 'List recent iMessage conversations with last message preview' },
    // near-miss: a search tool that competes with chittymac/search_notes for "search messages"
    { name: 'search_messages', description: 'Search iMessage conversation history by keyword or contact name' },
  ],

  // ── cross-focus near-miss servers (must stay reachable) ──────
  // documents-category server holding a cross-focus near-miss for the design lens:
  // "render a document to pdf" matches this strongly, but it is OUT of the design
  // focus (design covers desktop + browser/playwright/cowork, not documents).
  pdf: [
    { name: 'render_pdf', description: 'Render a document to a PDF file with page layout' },
    { name: 'extract_text', description: 'Extract text from a PDF document' },
  ],
};

export class FixtureBackend implements Backend {
  private configs = new Map<string, ServerConfig>();
  /** Records of callTool invocations, for harness inspection. */
  readonly calls: Array<{ serverId: string; toolName: string; args?: Record<string, unknown> }> = [];

  /** Servers whose listTools will throw (simulates connectivity loss). */
  private readonly _degraded = new Set<string>();
  /** Tools (`serverId/toolName`) whose callTool returns isError: true. */
  private readonly _toolErrors = new Set<string>();

  /** Mark a server as degraded — listTools will throw for this server. */
  setDegraded(serverId: string): void {
    this._degraded.add(serverId);
  }

  /** Mark a specific tool as failing — callTool will return isError: true. */
  setToolError(serverId: string, toolName: string): void {
    this._toolErrors.add(`${serverId}/${toolName}`);
  }

  registerServer(config: ServerConfig): void {
    this.configs.set(config.id, config);
  }

  isRegistered(serverId: string): boolean {
    return this.configs.has(serverId);
  }

  getStatus(serverId: string): BackendStatus {
    const tools = FIXTURE_TOOLS[serverId] ?? [];
    return { connected: this.configs.has(serverId) && !this._degraded.has(serverId), toolCount: tools.length, toolCacheAge: 0 };
  }

  async listTools(serverId: string): Promise<ToolEntry[]> {
    if (this._degraded.has(serverId)) {
      throw new Error(`[sim] backend "${serverId}" is degraded`);
    }
    const tools = FIXTURE_TOOLS[serverId] ?? [];
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }));
  }

  async callTool(serverId: string, toolName: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    this.calls.push({ serverId, toolName, args });
    if (this._toolErrors.has(`${serverId}/${toolName}`)) {
      return {
        content: [{ type: 'text', text: `[sim] tool ${serverId}/${toolName} returned an error` } as ContentItem],
        isError: true,
      };
    }
    const known = (FIXTURE_TOOLS[serverId] ?? []).some((t) => t.name === toolName);
    if (!known) {
      return {
        content: [{ type: 'text', text: `Unknown tool ${serverId}/${toolName}` } as ContentItem],
        isError: true,
      };
    }
    // Realistic, ChittyOS-shaped success envelope.
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, server: serverId, tool: toolName, args: args ?? {} }),
      } as ContentItem],
    };
  }

  async listResources(): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: [], templates: [] };
  }

  async readResource(): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    return { contents: [] };
  }

  async listPrompts(): Promise<PromptEntry[]> {
    return [];
  }

  async getPrompt(): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [] };
  }

  async shutdown(): Promise<void> {
    // no-op for in-process fixture
  }
}
