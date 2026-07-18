// Ch1ttyDO — per-session Durable Object, legacy JSON-RPC transport (/mcp).
// All session logic lives in Ch1ttyCore (src/core.ts), shared with the
// McpAgent transport (/mcp2). This class owns only: request forwarding,
// session-id bookkeeping, and the alarm()-driven ledger/eval flush + idle
// session close (a per-session DO has no transport-close event).
//
// One DO instance per MCP session (addressed by idFromName(sessionId) in
// index.ts) — never one mega-DO.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types.js';
import { Ch1ttyCore, SESSION_IDLE_MS } from './core.js';
import { LEDGER_FLUSH_INTERVAL_MS } from './ledger.js';
import { log } from './logger.js';

export class Ch1ttyDO extends DurableObject<Env> {
  private core: Ch1ttyCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new Ch1ttyCore(ctx.storage.sql, env);
  }

  // ── DO entrypoint (index.ts forwards MCP JSON-RPC here) ─────

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.endsWith('/status')) {
      return Response.json(this.core.getStatusSnapshot());
    }
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
    }

    const sessionId = req.headers.get('mcp-session-id') ?? `do-${crypto.randomUUID().slice(0, 8)}`;
    // Session start is idempotent (core.startSession) so per-request calls do
    // not wipe affinity/patterns or re-stage the entity.
    this.core.startSession(sessionId);
    // Ensure the alarm is scheduled so buffered events flush + idle sessions close.
    await this.ensureAlarm();

    let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      body = await req.json();
    } catch {
      return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    const response = await this.core.handleJsonRpc(body, sessionId);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'mcp-session-id': sessionId };
    return new Response(JSON.stringify(response), { headers });
  }

  getStatusSnapshot() {
    return this.core.getStatusSnapshot();
  }

  // ── Alarm (flush ledger + evaluator to chittytrack) ─────────

  private async ensureAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null) {
      await this.ctx.storage.setAlarm(Date.now() + LEDGER_FLUSH_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    // A per-session DO (idFromName) has no transport-close event, so onSessionEnd
    // (context_checkpoint to ContextConsciousness + session_end ledger summary)
    // is driven here: close sessions idle longer than SESSION_IDLE_MS. This is
    // the real lifecycle-end path the stdio gateway ran on transport.onclose.
    await this.core.closeIdleSessions(SESSION_IDLE_MS);

    const { ledger, eval: evalN } = await this.core.flush();
    log.debug(`Alarm flush: ledger=${ledger} eval=${evalN}`);

    // Reschedule while there's anything still buffered OR any session is still
    // active (so it can be idle-closed later); otherwise let the alarm lapse.
    if (this.core.hasBufferedWork()) {
      await this.ctx.storage.setAlarm(Date.now() + LEDGER_FLUSH_INTERVAL_MS);
    }
  }
}
