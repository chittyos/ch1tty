// Ch1ttyMcpAgent — Cloudflare Agents SDK (McpAgent) transport for the ch1tty
// gateway, served at /mcp2 (streamable HTTP). Runs the SAME Ch1ttyCore as the
// legacy JSON-RPC DO at /mcp: every meta-tool is registered on an McpServer
// with zod schemas (mirroring workers/chittyagent-ch1tty's schema style), and
// resource/prompt passthrough is wired via the low-level server handlers.
//
// Ledger/evaluator flush semantics are preserved with the Agents scheduler
// (this.schedule → flushTick) instead of a raw DO alarm — McpAgent owns the
// underlying alarm for its own scheduling, so we ride it rather than override.
import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Ch1ttyCore, SESSION_IDLE_MS } from './core.js';
import { LEDGER_FLUSH_INTERVAL_MS } from './ledger.js';
import type { Env, ToolCallResult } from './types.js';
import { VERSION } from './utils.js';
import { log } from './logger.js';

const FLUSH_TICK_SECONDS = Math.max(1, Math.ceil(LEDGER_FLUSH_INTERVAL_MS / 1000));

/** MCP SDK CallToolResult content union (text | image | resource with text XOR blob). */
type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } | { uri: string; mimeType?: string; blob: string } };

/**
 * Adapt the gateway's ToolCallResult to the MCP SDK's stricter CallToolResult:
 * the SDK requires embedded resources to carry `text` XOR `blob` (both required
 * variants), while the gateway type leaves them optional.
 */
function toMcpResult(r: ToolCallResult): { [key: string]: unknown; content: McpContent[]; isError?: boolean } {
  const content: McpContent[] = r.content.map((c) => {
    if (c.type === 'resource') {
      const { uri, mimeType, text, blob } = c.resource;
      return blob !== undefined
        ? { type: 'resource' as const, resource: { uri, mimeType, blob } }
        : { type: 'resource' as const, resource: { uri, mimeType, text: text ?? '' } };
    }
    return c;
  });
  return { ...r, content };
}

// ── Zod schemas (all params .describe()d, mirroring the DO's JSON schemas) ──

const SearchSchema = {
  query: z.string().optional().describe('Search keywords matched against tool names and descriptions'),
  server: z.string().optional().describe('Filter by server id (e.g. "neon", "chittyos")'),
  category: z.string().optional().describe('Filter by category (ecosystem, code, search, reasoning, desktop, documents, communication)'),
  focus: z.string().optional().describe('Focus profile to bias results toward. A soft lens — out-of-focus tools still appear. Use "none" to disable.'),
  limit: z.number().optional().describe('Max results to return (default 20)'),
};

const ExecuteSchema = {
  tool: z.string().describe('Namespaced tool name from search results (e.g. "neon/list_projects")'),
  args: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the tool'),
};

const CodeSchema = {
  code: z.string().describe('Async function body. Return the final value. Call upstream namespaces (e.g. await neon.execute("run_sql", {...})).'),
};

const CastSchema = {
  intent: z.string().describe('Natural language description of what you want accomplished'),
  args: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the resolved tool (if known)'),
  confirm: z.boolean().optional().describe('If true, return the execution plan without running it (default false)'),
  focus: z.string().optional().describe('Focus profile to bias resolution toward. Use "none" to disable.'),
};

const ProvisionSchema = {
  intent: z.string().describe('What the provisioned agent should accomplish'),
  entityId: z.string().describe('ChittyID of the entity to attach the agent to'),
};

const MemoryRecallSchema = {
  profile: z.string().describe('Name of the memory profile (e.g. user ID, team name, case ID).'),
  query: z.string().describe('Natural language question or search query.'),
};

const MemoryIngestSchema = {
  profile: z.string().describe('Name of the memory profile to ingest into.'),
  sessionId: z.string().optional().describe('Optional session identifier to scope extraction.'),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']).describe('Message author role'),
    content: z.string().describe('Message text content'),
  })).describe('Conversation messages to process'),
};

const MemorySummarySchema = {
  profile: z.string().describe('Name of the memory profile to summarize.'),
  sessionId: z.string().optional().describe('Optional session identifier to scope the summary.'),
};

export class Ch1ttyMcpAgent extends McpAgent<Env> {
  server = new McpServer(
    { name: 'ch1tty', version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  private core!: Ch1ttyCore;

  /** Stable session id for coordinator/ledger attribution — one per agent DO. */
  private get sessionId(): string {
    return `mcp2-${this.ctx.id.toString().slice(0, 16)}`;
  }

  async init() {
    this.core = new Ch1ttyCore(this.ctx.storage.sql, this.env);
    this.core.startSession(this.sessionId);

    // Dispatch through the same normalize/dispatch path the JSON-RPC DO uses,
    // so both transports execute identical code.
    const call = async (tool: string, args: Record<string, unknown>) => {
      await this.ensureFlushSchedule();
      return toMcpResult(await this.core.callTool(`ch1tty/${tool}`, args, this.sessionId));
    };

    this.server.tool(
      'search',
      'Search the tool registry. Returns matching tool names, descriptions, and input schemas. Use before execute.',
      SearchSchema,
      async (args) => call('search', args),
    );

    this.server.tool(
      'execute',
      'Execute a tool by its namespaced name (serverId/toolName). Use search to discover available tools first.',
      ExecuteSchema,
      async (args) => call('execute', args),
    );

    this.server.tool(
      'code',
      'Run model-written TypeScript in an isolated sandbox where each remote upstream is a typed namespace. ' +
      'Compose multiple upstream calls in one pass instead of round-tripping execute.',
      CodeSchema,
      async (args) => call('code', args),
    );

    this.server.tool(
      'cast',
      'Describe what you want done in natural language. Ch1tty searches its full surface — tools, prompts, and resources — resolves intent, and executes the best tool match.',
      CastSchema,
      async (args) => call('cast', args),
    );

    this.server.tool(
      'provision',
      'Provision a persistent agent for an intent and bind it to an entity ("attach a system to a thing"). Forks an Agent DO via the orchestrator (provision_fork) and binds it (provision_bind).',
      ProvisionSchema,
      async (args) => call('provision', args),
    );

    this.server.tool(
      'status',
      'Get the status of all configured backend MCP servers',
      async () => call('status', {}),
    );

    this.server.tool(
      'memory_recall',
      'Search stored memories in a profile. Returns a synthesized answer grounded in the stored content.',
      MemoryRecallSchema,
      async (args) => call('memory_recall', args),
    );

    this.server.tool(
      'memory_ingest',
      'Extract structured memories from a conversation. Identifies facts, events, instructions, and tasks automatically.',
      MemoryIngestSchema,
      async (args) => call('memory_ingest', args),
    );

    this.server.tool(
      'memory_summary',
      'Generate a structured Markdown summary of everything stored in a memory profile.',
      MemorySummarySchema,
      async (args) => call('memory_summary', args),
    );

    // ── Resource / prompt passthrough (low-level handlers) ────
    const raw = this.server.server;

    raw.setRequestHandler(ListResourcesRequestSchema, async () => {
      const { resources } = await this.core.listAllResources();
      return { resources };
    });

    raw.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      const { resourceTemplates } = await this.core.listAllResourceTemplates();
      return { resourceTemplates };
    });

    raw.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      return await this.core.readResource(req.params.uri);
    });

    raw.setRequestHandler(ListPromptsRequestSchema, async () => {
      const { prompts } = await this.core.listAllPrompts();
      return { prompts };
    });

    raw.setRequestHandler(GetPromptRequestSchema, async (req) => {
      const result = await this.core.getPrompt(req.params.name, req.params.arguments);
      // Core ContentItem is structurally compatible with MCP PromptMessage content.
      return result as unknown as { description?: string; messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> };
    });
  }

  // ── Flush scheduling (preserves the DO alarm's ledger semantics) ──

  private async ensureFlushSchedule(): Promise<void> {
    const pending = this.getSchedules().some((s) => s.callback === 'flushTick');
    if (!pending) {
      await this.schedule(FLUSH_TICK_SECONDS, 'flushTick');
    }
  }

  async flushTick(): Promise<void> {
    // Guard the whole body: if closeIdleSessions()/flush() throws and we don't
    // reschedule, flushing halts PERMANENTLY for this DO (buffered ledger +
    // session_end for abandoned sessions lost forever). Reschedule in finally.
    try {
      await this.core.closeIdleSessions(SESSION_IDLE_MS);
      const { ledger, eval: evalN } = await this.core.flush();
      log.debug(`McpAgent flush: ledger=${ledger} eval=${evalN}`);
    } catch (err) {
      log.error(`McpAgent flushTick error (will reschedule): ${String(err)}`);
    } finally {
      // Reschedule while there's anything buffered OR any session is still
      // active (so it can be idle-closed later); otherwise let the tick lapse.
      // hasBufferedWork can't throw (pure stat reads); guard defensively anyway.
      let more = true;
      try { more = this.core.hasBufferedWork(); } catch { more = true; }
      if (more) {
        await this.schedule(FLUSH_TICK_SECONDS, 'flushTick');
      }
    }
  }
}
