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
    { name: 'search', description: 'Search the orchestrator capability index for skills and agents' },
    { name: 'execute', description: 'Execute a registered orchestrator capability by name' },
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

  // ── out-of-focus servers (must stay reachable) ───────────────
  github: [
    { name: 'create_pull_request', description: 'Open a GitHub pull request from a branch' },
    { name: 'create_issue', description: 'Create a GitHub issue in a repository' },
  ],
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

  registerServer(config: ServerConfig): void {
    this.configs.set(config.id, config);
  }

  isRegistered(serverId: string): boolean {
    return this.configs.has(serverId);
  }

  getStatus(serverId: string): BackendStatus {
    const tools = FIXTURE_TOOLS[serverId] ?? [];
    return { connected: this.configs.has(serverId), toolCount: tools.length, toolCacheAge: 0 };
  }

  async listTools(serverId: string): Promise<ToolEntry[]> {
    const tools = FIXTURE_TOOLS[serverId] ?? [];
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }));
  }

  async callTool(serverId: string, toolName: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    this.calls.push({ serverId, toolName, args });
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
