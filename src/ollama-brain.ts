/**
 * Ollama brain — local-LLM semantic router for the slim-MCP discovery path.
 *
 * A stateless intent-to-tool router. Given a natural-language query and a
 * pre-filtered set of candidate tools, asks a local Ollama model to rank
 * which tools best match the query's intent. Returns confidence-scored
 * suggestions above a configurable threshold.
 *
 * Architectural constraints (do not violate):
 *  - Discovery-only. Never sits on the execute path. Execution stays deterministic.
 *  - Stateless. No session memory, no caching of prior queries, no history.
 *  - Null-safe on every failure mode — timeout, unreachable host, malformed
 *    response, empty candidates, zero high-confidence matches. Callers must
 *    treat `null` as "brain had nothing, fall back to literal search".
 *  - Pre-filter-agnostic. The brain ranks whatever candidates it's handed;
 *    the pre-filter strategy (category-based, affinity-based, etc.) lives
 *    upstream in the aggregator. Keeps this module single-responsibility.
 *
 * Not an MCP server. Not a backend. Not a tool. It's a capability the
 * coordinator calls when the literal search path returns weak results.
 *
 * @canon chittycanon://gov/governance#coordinator-knows-who-knows
 */

import { log } from './logger.js';

// ── Types ─────────────────────────────────────────────────────

/** Minimal tool shape the brain needs for ranking. */
export interface ToolCandidate {
  namespacedName: string;
  description: string;
  category?: string;
  serverName?: string;
}

/** A tool the brain believes matches the query, with confidence. */
export interface RoutedTool {
  tool: ToolCandidate;
  confidence: number;
  reason: string;
}

export interface OllamaBrainConfig {
  /** Ollama HTTP endpoint. Defaults to local daemon. */
  url: string;
  /** Model tag to invoke. Must be pulled on the Ollama instance. */
  model: string;
  /** Hard timeout for the HTTP call. Aborts via AbortController. */
  timeoutMs: number;
  /** Feature flag. When false, `route()` always returns null. */
  enabled: boolean;
  /** Suggestions below this confidence are dropped before returning. */
  minConfidence: number;
  /** Hard cap on candidates sent to the model — protects prompt budget. */
  maxCandidates: number;
}

export interface OllamaBrainStats {
  calls: number;
  successes: number;
  timeouts: number;
  errors: number;
  emptyResults: number;
  avgLatencyMs: number;
}

// ── Defaults ──────────────────────────────────────────────────

const DEFAULT_CONFIG: OllamaBrainConfig = {
  url: process.env.CH1TTY_OLLAMA_URL ?? 'http://127.0.0.1:11434',
  model: process.env.CH1TTY_OLLAMA_MODEL ?? 'llama3.2:3b',
  timeoutMs: Number(process.env.CH1TTY_OLLAMA_TIMEOUT_MS ?? 5000),
  enabled: process.env.CH1TTY_OLLAMA_ENABLED !== 'false',
  minConfidence: Number(process.env.CH1TTY_OLLAMA_MIN_CONFIDENCE ?? 0.75),
  maxCandidates: Number(process.env.CH1TTY_OLLAMA_MAX_CANDIDATES ?? 30),
};

// ── Brain ─────────────────────────────────────────────────────

export class OllamaBrain {
  readonly config: OllamaBrainConfig;

  private calls = 0;
  private successes = 0;
  private timeouts = 0;
  private errors = 0;
  private emptyResults = 0;
  private totalLatencyMs = 0;

  constructor(config: Partial<OllamaBrainConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Rank candidates by semantic match to the query. Returns null on any
   * failure mode — callers MUST fall back to the literal search path.
   *
   * Null means "brain had nothing useful". An empty array would imply
   * "brain ran and confidently returned zero matches", which we also
   * collapse to null since the caller's downstream logic is identical.
   */
  async route(query: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    if (!this.config.enabled) return null;
    if (!query.trim()) return null;
    if (candidates.length === 0) return null;

    // Hard-cap candidate list — the prompt budget is finite and a 3B model
    // drowns in more than ~30 items regardless.
    const pruned = candidates.slice(0, this.config.maxCandidates);
    const byName = new Map(pruned.map((c) => [c.namespacedName, c]));

    const startedAt = Date.now();
    this.calls++;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: this.buildPrompt(query, pruned),
          stream: false,
          format: 'json',
          options: { temperature: 0.1 },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.errors++;
        log.debug(`Ollama returned HTTP ${response.status}`, undefined, { model: this.config.model });
        return null;
      }

      const payload = (await response.json()) as { response?: unknown };
      if (typeof payload.response !== 'string') {
        this.errors++;
        return null;
      }

      const parsed = this.safeParseJson(payload.response);
      if (!parsed) {
        this.errors++;
        return null;
      }

      const routed = this.extractRoutedTools(parsed, byName);
      this.totalLatencyMs += Date.now() - startedAt;

      if (routed.length === 0) {
        this.emptyResults++;
        return null;
      }

      this.successes++;
      return routed.sort((a, b) => b.confidence - a.confidence);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.timeouts++;
        log.debug(`Ollama route timed out after ${this.config.timeoutMs}ms`);
      } else {
        this.errors++;
        log.debug(`Ollama route error: ${String(err)}`);
      }
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  getStats(): OllamaBrainStats {
    return {
      calls: this.calls,
      successes: this.successes,
      timeouts: this.timeouts,
      errors: this.errors,
      emptyResults: this.emptyResults,
      avgLatencyMs: this.successes > 0 ? Math.round(this.totalLatencyMs / this.successes) : 0,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────

  private buildPrompt(query: string, candidates: ToolCandidate[]): string {
    const list = candidates
      .map((c) => {
        const meta = c.category ? ` [${c.category}]` : '';
        return `- ${c.namespacedName}${meta}: ${c.description || '(no description)'}`;
      })
      .join('\n');

    return `You are a tool router. Given a user query and a list of available tools, return only the tools whose purpose directly matches the query's intent.

Respond with a JSON object in this exact shape:
{"matches": [{"tool": "<namespacedName>", "confidence": <0.0-1.0>, "reason": "<one short phrase>"}]}

Rules:
- Use tool names exactly as listed. Never invent tools.
- confidence must be between 0.0 and 1.0.
- Return at most 5 matches. Return empty array if nothing fits.
- Do not include commentary outside the JSON object.

Tools:
${list}

Query: ${query}`;
  }

  private safeParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private extractRoutedTools(
    parsed: unknown,
    byName: Map<string, ToolCandidate>,
  ): RoutedTool[] {
    if (!parsed || typeof parsed !== 'object') return [];
    const matches = (parsed as { matches?: unknown }).matches;
    if (!Array.isArray(matches)) return [];

    const out: RoutedTool[] = [];
    for (const item of matches) {
      if (!item || typeof item !== 'object') continue;
      const m = item as { tool?: unknown; confidence?: unknown; reason?: unknown };

      if (typeof m.tool !== 'string') continue;
      if (typeof m.confidence !== 'number' || !Number.isFinite(m.confidence)) continue;
      if (m.confidence < this.config.minConfidence) continue;

      const candidate = byName.get(m.tool);
      if (!candidate) continue; // reject hallucinated tool names

      out.push({
        tool: candidate,
        confidence: Math.min(1, Math.max(0, m.confidence)),
        reason: typeof m.reason === 'string' && m.reason.length > 0 ? m.reason : 'semantic match',
      });
    }
    return out;
  }
}
