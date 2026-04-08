/**
 * Session Coordinator — executive function layer behind the slim-MCP viewport.
 *
 * Stages memories, resolves entity context, tracks patterns, and enriches
 * search results — all without touching the entity's context window.
 *
 * The coordinator is a consumer of ch1tty's own tool surface: it calls
 * backend tools (memory_recall, context_resolve, etc.) through the same
 * Backend interface the aggregator uses.
 *
 * @canon chittycanon://gov/governance#sessions-are-viewports
 * @canon chittycanon://gov/governance#drl-reckoning-at-provisioning
 */

import { log } from './logger.js';
import type { Backend, ToolCallResult } from './types.js';

// ── Types ─────────────────────────────────────────────────────

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
  serverAffinity: Map<string, number>; // serverId → recency score
}

// ── Coordinator ───────────────────────────────────────────────

export class SessionCoordinator {
  private contexts = new Map<string, SessionContext>();
  private ecosystemBackend?: Backend;
  private ecosystemServerId?: string;

  /** Register the ecosystem backend for coordinator's own tool calls. */
  bindEcosystem(backend: Backend, serverId: string): void {
    this.ecosystemBackend = backend;
    this.ecosystemServerId = serverId;
    log.info(`Coordinator bound to ecosystem backend: ${serverId}`);
  }

  /** Called when a session starts. Begins background staging. */
  async onSessionStart(sessionId: string, transport: 'stdio' | 'http'): Promise<void> {
    const ctx: SessionContext = {
      sessionId,
      toolPatterns: new Map(),
      stagingComplete: false,
      serverAffinity: new Map(),
    };
    this.contexts.set(sessionId, ctx);

    // Background staging — don't block session start
    this.stageSession(sessionId).catch((err) => {
      log.warn(`Background staging failed for session ${sessionId}: ${err}`);
    });

    // Record session start to ledger
    this.recordToLedger(sessionId, 'session_start', { transport });
  }

  /** Called when a tool is executed. Records patterns, updates affinity, delegates to ledger. */
  onToolCall(sessionId: string, namespacedTool: string): void {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return;

    // Extract server from namespaced tool name
    const sep = namespacedTool.indexOf('/');
    if (sep > 0) {
      const serverId = namespacedTool.slice(0, sep);
      ctx.serverAffinity.set(serverId, Date.now());
    }

    // Track tool usage patterns
    const existing = ctx.toolPatterns.get(namespacedTool);
    if (existing) {
      existing.count++;
      existing.lastUsed = Date.now();
    } else {
      ctx.toolPatterns.set(namespacedTool, {
        tool: namespacedTool,
        count: 1,
        lastUsed: Date.now(),
      });
    }

    // Delegate to ledger (fire-and-forget)
    this.recordToLedger(sessionId, 'tool_call', {
      tool: namespacedTool,
      session_id: sessionId,
      entity_id: ctx.entity?.chittyId,
    });
  }

  /** Called when a session ends. Persists observations if possible. */
  async onSessionEnd(sessionId: string): Promise<void> {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return;

    const patterns = [...ctx.toolPatterns.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    const patternSummary = patterns.map((p) => `${p.tool} (${p.count}x)`);
    const totalCalls = patterns.reduce((sum, p) => sum + p.count, 0);
    const duration = Math.round((Date.now() - (ctx.entity?.resolvedAt ?? Date.now())) / 1000);

    // Checkpoint to ContextConsciousness (best-effort)
    if (ctx.toolPatterns.size > 0 && this.ecosystemBackend) {
      await this.callEcosystem('context_checkpoint', {
        session_id: sessionId,
        summary: `Session ended. ${totalCalls} tool calls. Top: ${patternSummary.join(', ')}`,
      }).catch(() => {});
    }

    // Record session end to ledger with summary
    this.recordToLedger(sessionId, 'session_end', {
      tool_calls: totalCalls,
      unique_tools: ctx.toolPatterns.size,
      duration_seconds: duration,
      top_tools: patternSummary.slice(0, 5),
      servers_used: [...ctx.serverAffinity.keys()],
    });

    this.contexts.delete(sessionId);
  }

  /** Get server affinity scores for a session (for search boosting). */
  getServerAffinity(sessionId: string): Map<string, number> {
    return this.contexts.get(sessionId)?.serverAffinity ?? new Map();
  }

  /** Get entity context for a session (for search enrichment). */
  getEntityContext(sessionId: string): EntityContext | undefined {
    return this.contexts.get(sessionId)?.entity;
  }

  /** Get top tool patterns for a session. */
  getToolPatterns(sessionId: string, limit = 10): ToolPattern[] {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return [];
    return [...ctx.toolPatterns.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /** Log a decision to the ledger on behalf of the entity. */
  logDecision(sessionId: string, decision: string, reasoning?: string, topic?: string): void {
    this.recordToLedger(sessionId, 'decision', {
      decision,
      ...(reasoning ? { reasoning } : {}),
      ...(topic ? { topic } : {}),
    });
  }

  /** Log a milestone or observation to the ledger. */
  logEvent(sessionId: string, action: string, eventType?: string, metadata?: Record<string, unknown>): void {
    this.recordToLedger(sessionId, eventType ?? 'event', {
      action,
      ...metadata,
    });
  }

  /** Is staging complete for this session? */
  isStagingComplete(sessionId: string): boolean {
    return this.contexts.get(sessionId)?.stagingComplete ?? false;
  }

  /** Snapshot for status endpoint. */
  getSnapshot(): {
    activeSessions: number;
    boundEntity: boolean;
    sessions: Array<{
      sessionId: string;
      entity?: string;
      toolPatterns: number;
      stagingComplete: boolean;
    }>;
  } {
    const sessions = [...this.contexts.entries()].map(([id, ctx]) => ({
      sessionId: id,
      entity: ctx.entity?.chittyId,
      toolPatterns: ctx.toolPatterns.size,
      stagingComplete: ctx.stagingComplete,
    }));

    return {
      activeSessions: sessions.length,
      boundEntity: sessions.some((s) => s.entity !== undefined),
      sessions,
    };
  }

  // ── Background staging ──────────────────────────────────────

  private async stageSession(sessionId: string): Promise<void> {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return;

    if (!this.ecosystemBackend) {
      log.debug(`No ecosystem backend — skipping staging`, undefined, { sessionId });
      ctx.stagingComplete = true;
      return;
    }

    // Step 1: Resolve entity via ContextConsciousness
    try {
      const resolveResult = await this.callEcosystem('context_resolve', {
        session_id: sessionId,
      });
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

    // Step 2: Load recent memories
    if (ctx.entity?.chittyId) {
      try {
        const memResult = await this.callEcosystem('chitty_memory_recall', {
          query: 'recent session context',
          limit: 5,
        });
        const memories = this.parseResult(memResult);
        if (Array.isArray(memories?.results)) {
          ctx.entity.recentMemories = memories.results.map(
            (m: { content?: string; key?: string }) => m.content || m.key || String(m),
          );
          log.debug(`Loaded ${ctx.entity.recentMemories.length} memories`, undefined, { sessionId });
        }
      } catch (err) {
        log.debug(`Memory recall unavailable: ${err}`, undefined, { sessionId });
      }
    }

    // Step 3: Load active workstreams
    if (ctx.entity?.chittyId) {
      try {
        const wsResult = await this.callEcosystem('chitty_memory_recall', {
          query: 'active workstreams',
          limit: 10,
        });
        const workstreams = this.parseResult(wsResult);
        if (Array.isArray(workstreams?.results)) {
          ctx.entity.activeWorkstreams = workstreams.results.map(
            (w: { content?: string; key?: string }) => w.content || w.key || String(w),
          );
        }
      } catch {
        // workstreams are optional enrichment
      }
    }

    ctx.stagingComplete = true;
    log.info(`Session staging complete`, undefined, {
      sessionId,
      entity: ctx.entity?.chittyId ?? 'unresolved',
      memories: ctx.entity?.recentMemories?.length ?? 0,
    });
  }

  // ── Helpers ─────────────────────────────────────────────────

  /** Fire-and-forget ledger write — delegates to chitty_ledger_record via ecosystem backend. */
  private recordToLedger(sessionId: string, eventType: string, metadata: Record<string, unknown>): void {
    if (!this.ecosystemBackend) return;

    const ctx = this.contexts.get(sessionId);
    this.callEcosystem('chitty_ledger_record', {
      event_type: eventType,
      entity_id: ctx?.entity?.chittyId,
      session_id: sessionId,
      metadata,
    }).catch((err) => {
      log.debug(`Ledger write skipped: ${err}`, undefined, { sessionId, eventType });
    });
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
