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
  /**
   * After this many consecutive failures (timeouts or errors) the breaker
   * opens and route() returns null immediately until the cooldown expires.
   * Prevents every cast from blocking for timeoutMs when Ollama is unreachable.
   */
  circuitBreakerThreshold: number;
  /** How long (ms) the breaker stays open before allowing a probe attempt. */
  circuitBreakerCooldownMs: number;
}

export interface OllamaBrainStats {
  calls: number;
  successes: number;
  timeouts: number;
  errors: number;
  emptyResults: number;
  avgLatencyMs: number;
  circuitOpen: boolean;
  circuitCooldownRemainingMs: number;
}

// ── Defaults ──────────────────────────────────────────────────

const DEFAULT_CONFIG: OllamaBrainConfig = {
  url: process.env.CH1TTY_OLLAMA_URL ?? 'http://127.0.0.1:11434',
  model: process.env.CH1TTY_OLLAMA_MODEL ?? 'llama3.2:3b',
  timeoutMs: Number(process.env.CH1TTY_OLLAMA_TIMEOUT_MS ?? 5000),
  enabled: process.env.CH1TTY_OLLAMA_ENABLED !== 'false',
  minConfidence: Number(process.env.CH1TTY_OLLAMA_MIN_CONFIDENCE ?? 0.75),
  maxCandidates: Number(process.env.CH1TTY_OLLAMA_MAX_CANDIDATES ?? 30),
  circuitBreakerThreshold: Number(process.env.CH1TTY_OLLAMA_CIRCUIT_THRESHOLD ?? 3),
  circuitBreakerCooldownMs: Number(process.env.CH1TTY_OLLAMA_CIRCUIT_COOLDOWN_MS ?? 60_000),
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

  // Circuit breaker state
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private probing = false;

  constructor(config: Partial<OllamaBrainConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    // Defensive clamp — prevent nonsense configs from silently breaking routing
    merged.minConfidence = Math.max(0, Math.min(1, merged.minConfidence));
    merged.maxCandidates = Math.max(1, merged.maxCandidates);
    merged.timeoutMs = Math.max(100, merged.timeoutMs);
    merged.circuitBreakerThreshold = Number.isFinite(merged.circuitBreakerThreshold)
      ? Math.max(1, merged.circuitBreakerThreshold)
      : 3;
    merged.circuitBreakerCooldownMs = Number.isFinite(merged.circuitBreakerCooldownMs)
      ? Math.max(100, merged.circuitBreakerCooldownMs)
      : 60_000;
    this.config = merged;
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

    // Circuit breaker: open → return null immediately without a network call.
    // Trips after circuitBreakerThreshold consecutive failures; stays open for
    // circuitBreakerCooldownMs before allowing a single half-open probe attempt.
    if (this.circuitOpenUntil > 0) {
      if (Date.now() < this.circuitOpenUntil) {
        return null;
      }
      // Cooldown expired: half-open. Only one concurrent probe is allowed;
      // all others get null immediately so only one Ollama call is in flight.
      if (this.probing) return null;
      this.probing = true;
      log.debug(`OllamaBrain circuit half-open, probing`, 'ollama-brain');
    }

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
        const snippet = await response.text().catch(() => '').then((t) => t.slice(0, 200));
        log.warn(`Ollama returned HTTP ${response.status}`, 'ollama-brain', { model: this.config.model, body: snippet });
        this.recordCircuitFailure();
        this.probing = false;
        return null;
      }

      const payload = (await response.json()) as { response?: unknown };
      if (typeof payload.response !== 'string') {
        this.errors++;
        log.warn(`Ollama response missing string "response" field`, 'ollama-brain', { keys: Object.keys(payload) });
        this.recordCircuitFailure();
        this.probing = false;
        return null;
      }

      const parsed = this.safeParseJson(payload.response);
      if (!parsed) {
        this.errors++;
        log.warn(`Ollama returned unparseable JSON`, 'ollama-brain', { snippet: String(payload.response).slice(0, 200) });
        this.recordCircuitFailure();
        this.probing = false;
        return null;
      }

      const routed = this.extractRoutedTools(parsed, byName);

      if (routed.length === 0) {
        this.emptyResults++;
        // Empty results mean Ollama is reachable — clear failures and close the circuit.
        // Without resetting circuitOpenUntil the breaker stays in perpetual half-open
        // limbo (circuitOpenUntil in the past but != 0) whenever a half-open probe
        // returns zero matches.
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = 0;
        this.probing = false;
        return null;
      }

      this.successes++;
      this.consecutiveFailures = 0;
      this.circuitOpenUntil = 0;
      this.probing = false;
      return routed.sort((a, b) => b.confidence - a.confidence);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.timeouts++;
        log.warn(`Ollama route timed out after ${this.config.timeoutMs}ms`, 'ollama-brain');
      } else {
        this.errors++;
        log.warn(`Ollama route error: ${String(err)}`, 'ollama-brain');
      }
      this.recordCircuitFailure();
      this.probing = false;
      return null;
    } finally {
      clearTimeout(timeoutHandle);
      this.totalLatencyMs += Date.now() - startedAt;
    }
  }

  /** Whether the circuit breaker is currently open (no Ollama calls will be attempted). */
  isCircuitOpen(): boolean {
    return this.circuitOpenUntil > 0 && Date.now() < this.circuitOpenUntil;
  }

  /**
   * Best-effort warm-start: issues a tiny generate call so Ollama loads the
   * model into memory before the first real `route()`. Cold-loading a 3B
   * model can take 11+ seconds, which exceeds the default route timeout
   * and silently routes the first cast to the keyword fallback. Warming
   * here makes the first user-facing cast hit the brain.
   *
   * Fail-quiet: a failure here does not change cast behavior — `route()`
   * already falls back on every error mode. We do not increment any of
   * the route counters; warmup is observability-neutral.
   */
  async warmup(timeoutMs = 60000): Promise<boolean> {
    if (!this.config.enabled) return false;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.config.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: 'ok',
          stream: false,
          options: { num_predict: 1, temperature: 0 },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        log.warn(`Ollama warmup HTTP ${response.status}`, 'ollama-brain', { model: this.config.model });
        return false;
      }
      // Drain body to free the connection
      await response.json().catch(() => null);
      log.info(`Ollama brain warm: model="${this.config.model}"`, 'ollama-brain');
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        log.warn(`Ollama warmup timed out after ${timeoutMs}ms`, 'ollama-brain');
      } else {
        log.warn(`Ollama warmup error: ${String(err)}`, 'ollama-brain');
      }
      return false;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  getStats(): OllamaBrainStats {
    const now = Date.now();
    const circuitOpen = this.circuitOpenUntil > 0 && now < this.circuitOpenUntil;
    return {
      calls: this.calls,
      successes: this.successes,
      timeouts: this.timeouts,
      errors: this.errors,
      emptyResults: this.emptyResults,
      avgLatencyMs: this.calls > 0 ? Math.round(this.totalLatencyMs / this.calls) : 0,
      circuitOpen,
      circuitCooldownRemainingMs: circuitOpen ? this.circuitOpenUntil - now : 0,
    };
  }

  private recordCircuitFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.circuitOpenUntil = Date.now() + this.config.circuitBreakerCooldownMs;
      log.warn(
        `OllamaBrain circuit open — ${this.consecutiveFailures} consecutive failures, cooldown ${this.config.circuitBreakerCooldownMs}ms`,
        'ollama-brain',
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private buildPrompt(query: string, candidates: ToolCandidate[]): string {
    const list = candidates
      .map((c) => {
        const meta = c.category ? ` [${c.category}]` : '';
        // Truncate descriptions to cap prompt size and limit injection surface from remote backends
        const desc = (c.description || '(no description)').slice(0, 200).replace(/\n/g, ' ');
        return `- ${c.namespacedName}${meta}: ${desc}`;
      })
      .join('\n');

    // JSON.stringify the query to prevent prompt injection via newlines/control chars
    const safeQuery = JSON.stringify(query);

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

Query: ${safeQuery}`;
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
