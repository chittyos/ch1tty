// Ch1ttyApiAgent — Cloudflare McpAgent that exposes the ch1tty tool registry as
// an openApiMcpServer surface. Served at /mcp-api alongside the raw /mcp2 surface.
//
// Clients get two tools:
//   search  — query the dynamically-built OpenAPI spec for ch1tty tools
//   execute — call any tool with schema-validated args (runs through Ch1ttyCore)
//
// The spec is built from the live registry in init(), giving clients a typed,
// discoverable surface instead of raw code strings. Auth: fail-closed (same as
// /mcp2 — requires CH1TTY_MCP_TOKEN; exposes structured tool execution).
import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { openApiMcpServer } from '@cloudflare/codemode/mcp';
import { DynamicWorkerExecutor, type DynamicWorkerExecutorOptions } from '@cloudflare/codemode';
import { Ch1ttyCore, SESSION_IDLE_MS } from './core.js';
import { LEDGER_FLUSH_INTERVAL_MS } from './ledger.js';
import { buildOpenApiSpec, parseToolPath } from './openapi-spec.js';
import type { Env } from './types.js';
import { VERSION } from './utils.js';
import { log } from './logger.js';

const FLUSH_TICK_SECONDS = Math.max(1, Math.ceil(LEDGER_FLUSH_INTERVAL_MS / 1000));

export class Ch1ttyApiAgent extends McpAgent<Env> {
  // Placeholder server — replaced in init() once the registry is available.
  // McpAgent reads this.server after init() resolves (it modifies this.server in
  // init() too, e.g. to register tools), so reassigning is safe.
  server = new McpServer(
    { name: 'ch1tty-api', version: VERSION },
    { capabilities: { tools: {} } },
  );

  private core!: Ch1ttyCore;

  private get sessionId(): string {
    return `api-${this.ctx.id.toString().slice(0, 16)}`;
  }

  async init() {
    this.core = new Ch1ttyCore(this.ctx.storage.sql, this.env);
    await this.core.startSession(this.sessionId);

    const registry = await this.core.registrySnapshot();
    const spec = buildOpenApiSpec(registry, VERSION);

    const executorOpts: DynamicWorkerExecutorOptions = {
      loader: this.env.LOADER as DynamicWorkerExecutorOptions['loader'],
      timeout: 60_000,
      globalOutbound: null,
    };
    const executor = new DynamicWorkerExecutor(executorOpts);

    const core = this.core;
    const sessionId = this.sessionId;

    // Replace the placeholder server with the openApiMcpServer-generated one.
    // The request callback routes OpenAPI operations back through Ch1ttyCore,
    // so auth and circuit-breaker logic are shared with /mcp2.
    this.server = openApiMcpServer({
      spec,
      executor,
      name: 'ch1tty-api',
      version: VERSION,
      request: async (opts) => {
        const namespacedTool = parseToolPath(opts.path);
        if (!namespacedTool) {
          throw new Error(`Unknown API path: ${opts.path}`);
        }
        const args =
          opts.body && typeof opts.body === 'object' && !Array.isArray(opts.body)
            ? (opts.body as Record<string, unknown>)
            : {};
        // Route through ch1tty/execute so handleExecute can dispatch to the
        // correct backend via RemoteProxy. Direct callTool rejects non-meta serverIds.
        const result = await core.callTool('ch1tty/execute', { tool: namespacedTool, args }, sessionId);
        if (result.isError) throw new Error(JSON.stringify(result.content));
        // Return the first text content item parsed as JSON, or the raw content.
        if (result.content.length === 1 && result.content[0]?.type === 'text') {
          const text = (result.content[0] as { text: string }).text;
          try { return JSON.parse(text); } catch { return text; }
        }
        return result.content;
      },
    });

    await this.ensureFlushSchedule();
  }

  // ── Flush scheduling (mirrors Ch1ttyMcpAgent) ────────────────

  private async ensureFlushSchedule(): Promise<void> {
    const pending = this.getSchedules().some((s) => s.callback === 'flushTick');
    if (!pending) await this.schedule(FLUSH_TICK_SECONDS, 'flushTick');
  }

  async flushTick(): Promise<void> {
    try {
      await this.core.closeIdleSessions(SESSION_IDLE_MS);
      const { ledger, eval: evalN } = await this.core.flush();
      log.debug(`ApiAgent flush: ledger=${ledger} eval=${evalN}`);
    } catch (err) {
      log.error(`ApiAgent flushTick error (will reschedule): ${String(err)}`);
    } finally {
      let more = true;
      try { more = this.core.hasBufferedWork(); } catch { more = true; }
      if (more) await this.schedule(FLUSH_TICK_SECONDS, 'flushTick');
    }
  }
}
