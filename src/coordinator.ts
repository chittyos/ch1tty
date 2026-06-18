// Session Coordinator — ported from src/coordinator.ts. Executive-function layer
// behind the slim-MCP viewport: stages entity context, tracks tool patterns +
// server affinity, routes intent via the brain, delegates to the ledger.
//
// CHANGES from the stdio version:
//  - The brain is WorkersAiBrain (Workers AI embeddings) instead of
//    EmbeddingBrain (Ollama) + opt-in OllamaBrain (generative). The route()
//    contract — null means "fall back to literal search" — is preserved exactly.
//  - LedgerClient is SQLite-backed (constructed by the DO).
//  - No background warmup timer (Workers AI has no cold-model-load to pre-pay,
//    and a DO must not hold timers open; flushing is driven by alarm()).
//
// @canon chittycanon://gov/governance#sessions-are-viewports
import { log } from './logger.js';
import { LedgerClient } from './ledger.js';
import { WorkersAiBrain, type RoutedTool, type ToolCandidate } from './workers-ai-brain.js';
import type { Backend, ToolCallResult } from './types.js';

export interface EntityContext {
  chittyId?: string;
  identityClass?: string;
  trustLevel?: number;
  domainTrust?: Record<string, number>;
  recentMemories?: string[];
  activeWorkstreams?: string[];
  resolvedAt: number;
}

export interface ToolPattern {
  tool: string;
  count: number;
  lastUsed: number;
}

export interface SessionContext {
  sessionId: string;
  entity?: EntityContext;
  toolPatterns: Map<string, ToolPattern>;
  stagingComplete: boolean;
  serverAffinity: Map<string, number>;
  lastActivityAt: number;
  sessionFocus?: string;
}

export class SessionCoordinator {
  private contexts = new Map<string, SessionContext>();
  private ecosystemBackend?: Backend;
  private ecosystemServerId?: string;
  readonly ledger: LedgerClient;
  readonly brain: WorkersAiBrain;

  constructor(ledger: LedgerClient, brain: WorkersAiBrain) {
    this.ledger = ledger;
    this.brain = brain;
  }

  /**
   * Route a free-form intent to ranked tool candidates via the Workers AI brain.
   * Returns null when the brain is unavailable, errors, or finds no
   * high-confidence matches — callers MUST fall back to literal search on null.
   * Discovery-only: never on the execute path.
   */
  async routeIntent(query: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    const result = await this.brain.route(query, candidates);
    if (result && result.length > 0) {
      log.debug(`Brain routed "${query.slice(0, 40)}" → ${result.length} candidate(s)`);
      return result;
    }
    return null;
  }

  bindEcosystem(backend: Backend, serverId: string): void {
    this.ecosystemBackend = backend;
    this.ecosystemServerId = serverId;
    log.info(`Coordinator bound to ecosystem backend: ${serverId}`);
  }

  /** Whether a session context already exists (start-once guard in the DO). */
  hasSession(sessionId: string): boolean {
    return this.contexts.has(sessionId);
  }

  /** Session ids whose last activity is older than `idleMs`. */
  idleSessions(idleMs: number): string[] {
    const cutoff = Date.now() - idleMs;
    return [...this.contexts.values()].filter((c) => c.lastActivityAt < cutoff).map((c) => c.sessionId);
  }

  async onSessionStart(sessionId: string, transport: 'stdio' | 'http'): Promise<void> {
    // Idempotent: re-starting an existing session would wipe affinity/patterns
    // and re-stage. The DO calls this once (on initialize); guard defensively.
    if (this.contexts.has(sessionId)) return;
    const ctx: SessionContext = {
      sessionId,
      toolPatterns: new Map(),
      stagingComplete: false,
      serverAffinity: new Map(),
      lastActivityAt: Date.now(),
    };
    this.contexts.set(sessionId, ctx);
    this.recordToLedger(sessionId, 'session_start', { transport });
    // Staging is awaited by the DO caller (which wraps it in ctx.waitUntil-style
    // background work); kept as a separate method so it can be fired without
    // blocking the first request.
    this.stageSession(sessionId).catch((err) => {
      log.warn(`Background staging failed for session ${sessionId}: ${err}`);
    });
  }

  onToolCall(sessionId: string, namespacedTool: string): void {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return;
    ctx.lastActivityAt = Date.now();

    const sep = namespacedTool.indexOf('/');
    if (sep > 0) {
      const serverId = namespacedTool.slice(0, sep);
      ctx.serverAffinity.set(serverId, Date.now());
    }

    const existing = ctx.toolPatterns.get(namespacedTool);
    if (existing) {
      existing.count++;
      existing.lastUsed = Date.now();
    } else {
      ctx.toolPatterns.set(namespacedTool, { tool: namespacedTool, count: 1, lastUsed: Date.now() });
    }

    this.recordToLedger(sessionId, 'tool_call', {
      tool: namespacedTool,
      session_id: sessionId,
      entity_id: ctx.entity?.chittyId,
    });
  }

  async onSessionEnd(sessionId: string): Promise<void> {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return;

    const patterns = [...ctx.toolPatterns.values()].sort((a, b) => b.count - a.count).slice(0, 20);
    const patternSummary = patterns.map((p) => `${p.tool} (${p.count}x)`);
    const totalCalls = patterns.reduce((sum, p) => sum + p.count, 0);
    const duration = Math.round((Date.now() - (ctx.entity?.resolvedAt ?? Date.now())) / 1000);

    if (ctx.toolPatterns.size > 0 && this.ecosystemBackend) {
      await this.callEcosystem('context_checkpoint', {
        session_id: sessionId,
        summary: `Session ended. ${totalCalls} tool calls. Top: ${patternSummary.join(', ')}`,
      }).catch(() => {});
    }

    this.recordToLedger(sessionId, 'session_end', {
      tool_calls: totalCalls,
      unique_tools: ctx.toolPatterns.size,
      duration_seconds: duration,
      top_tools: patternSummary.slice(0, 5),
      servers_used: [...ctx.serverAffinity.keys()],
    });

    await this.ledger.flush().catch(() => {});
    this.contexts.delete(sessionId);
  }

  getServerAffinity(sessionId: string): Map<string, number> {
    return this.contexts.get(sessionId)?.serverAffinity ?? new Map();
  }

  getEntityContext(sessionId: string): EntityContext | undefined {
    return this.contexts.get(sessionId)?.entity;
  }

  getToolPatterns(sessionId: string, limit = 10): ToolPattern[] {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return [];
    return [...ctx.toolPatterns.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }

  logDecision(sessionId: string, decision: string, reasoning?: string, topic?: string): void {
    this.recordToLedger(sessionId, 'decision', {
      decision,
      ...(reasoning ? { reasoning } : {}),
      ...(topic ? { topic } : {}),
    });
  }

  logEvent(sessionId: string, action: string, eventType?: string, metadata?: Record<string, unknown>): void {
    this.recordToLedger(sessionId, eventType ?? 'event', { action, ...metadata });
  }

  isStagingComplete(sessionId: string): boolean {
    return this.contexts.get(sessionId)?.stagingComplete ?? false;
  }

  getSnapshot(): {
    activeSessions: number;
    boundEntity: boolean;
    topTools: string[];
    toolsByServer: Record<string, number>;
    ledger: ReturnType<LedgerClient['getStats']>;
    brain: ReturnType<WorkersAiBrain['getStats']>;
    sessions: Array<{ sessionId: string; entity?: string; toolPatterns: number; stagingComplete: boolean }>;
  } {
    const allPatterns = [...this.contexts.values()].flatMap((ctx) => [...ctx.toolPatterns.values()]);
    const topTools = allPatterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((p) => p.tool);
    const toolsByServer: Record<string, number> = {};
    for (const p of allPatterns) {
      const server = p.tool.includes('/') ? (p.tool.split('/')[0] ?? 'unknown') : 'unknown';
      toolsByServer[server] = (toolsByServer[server] ?? 0) + p.count;
    }

    const sessions = [...this.contexts.entries()].map(([id, ctx]) => ({
      sessionId: id,
      entity: ctx.entity?.chittyId,
      toolPatterns: ctx.toolPatterns.size,
      stagingComplete: ctx.stagingComplete,
      ...(ctx.sessionFocus ? { sessionFocus: ctx.sessionFocus } : {}),
    }));
    return {
      activeSessions: sessions.length,
      boundEntity: sessions.some((s) => s.entity !== undefined),
      topTools,
      toolsByServer,
      ledger: this.ledger.getStats(),
      brain: this.brain.getStats(),
      sessions,
    };
  }

  // ── Background staging (ported verbatim, modulo the brain) ──

  private async stageSession(sessionId: string): Promise<void> {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return;

    if (!this.ecosystemBackend) {
      log.debug(`No ecosystem backend — skipping staging`, undefined, { sessionId });
      ctx.stagingComplete = true;
      return;
    }

    try {
      const resolveResult = await this.callEcosystem('viewport_resolve_context', { session_id: sessionId });
      const resolved = this.parseResult(resolveResult);
      if (resolved?.chitty_id) {
        ctx.entity = {
          chittyId: resolved.chitty_id as string,
          identityClass: resolved.identity_class as string | undefined,
          trustLevel: resolved.trust_level as number | undefined,
          domainTrust: resolved.domain_trust as Record<string, number> | undefined,
          resolvedAt: Date.now(),
        };
        log.info(`Entity resolved: ${resolved.chitty_id}`, undefined, { sessionId });
      }
    } catch (err) {
      log.debug(`Entity resolution unavailable: ${err}`, undefined, { sessionId });
    }

    if (ctx.entity?.chittyId) {
      try {
        const memResult = await this.callEcosystem('viewport_memory_recall', { query: 'recent session context', limit: 5 });
        const memories = this.parseResult(memResult);
        if (Array.isArray(memories?.results)) {
          ctx.entity.recentMemories = (memories.results as Array<{ content?: string; key?: string }>).map(
            (m) => m.content || m.key || String(m),
          );
          log.debug(`Loaded ${ctx.entity.recentMemories.length} memories`, undefined, { sessionId });
        }
      } catch (err) {
        log.debug(`Memory recall unavailable: ${err}`, undefined, { sessionId });
      }
    }

    if (ctx.entity?.chittyId) {
      try {
        const wsResult = await this.callEcosystem('viewport_memory_recall', { query: 'active workstreams', limit: 10 });
        const workstreams = this.parseResult(wsResult);
        if (Array.isArray(workstreams?.results)) {
          ctx.entity.activeWorkstreams = (workstreams.results as Array<{ content?: string; key?: string }>).map(
            (w) => w.content || w.key || String(w),
          );
        }
      } catch {
        // optional enrichment
      }
    }

    ctx.stagingComplete = true;
    log.info(`Session staging complete`, undefined, {
      sessionId,
      entity: ctx.entity?.chittyId ?? 'unresolved',
      memories: ctx.entity?.recentMemories?.length ?? 0,
    });
  }

  private recordToLedger(sessionId: string, eventType: string, metadata: Record<string, unknown>): void {
    const ctx = this.contexts.get(sessionId);
    this.ledger.record(sessionId, eventType, metadata, ctx?.entity?.chittyId);
  }

  private async callEcosystem(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    if (!this.ecosystemBackend || !this.ecosystemServerId) {
      throw new Error('No ecosystem backend bound');
    }
    return this.ecosystemBackend.callTool(this.ecosystemServerId, toolName, args);
  }

  private parseResult(result: ToolCallResult): Record<string, unknown> | null {
    if (result.isError) return null;
    const text = result.content?.[0];
    if (!text || text.type !== 'text') return null;
    try {
      return JSON.parse(text.text);
    } catch {
      return null;
    }
  }
}
