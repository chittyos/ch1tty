/**
 * Embedding brain — vector-similarity intent router for the slim-MCP discovery path.
 *
 * Same contract as OllamaBrain but uses Ollama's `/api/embed` endpoint and
 * cosine similarity instead of generative JSON routing. The generative path
 * (OllamaBrain) is too slow on commodity hardware — a 3B model takes 30–60s
 * per route on this VM, vs ~300ms warm for an embedding call.
 *
 * Strategy:
 *  - Embed candidate descriptions once and cache (descriptions are stable).
 *  - Embed the query on every route() call.
 *  - Cosine-rank candidates against the query, return top-k above minSimilarity.
 *
 * Architectural constraints (same as OllamaBrain — do not violate):
 *  - Discovery-only. Never sits on the execute path.
 *  - Stateless wrt query history. The embedding cache is keyed by candidate
 *    identity + content hash; it's a performance optimization, not session memory.
 *  - Null-safe on every failure mode — caller MUST treat null as "fall back".
 *
 * @canon chittycanon://gov/governance#coordinator-knows-who-knows
 */

import { createHash } from 'node:crypto';
import { log } from './logger.js';
import type { RoutedTool, ToolCandidate } from './ollama-brain.js';

export interface EmbeddingBrainConfig {
  url: string;
  model: string;
  /** Hard timeout per Ollama call (query or candidate batch). */
  timeoutMs: number;
  enabled: boolean;
  /** Cosine similarities below this are dropped. Range [0,1]. */
  minSimilarity: number;
  /** Hard cap on candidates considered per route call. */
  maxCandidates: number;
  /** Top-k results returned. */
  topK: number;
  /**
   * After this many consecutive failures (timeouts or errors) the breaker
   * opens and route() returns null immediately until the cooldown expires.
   * Prevents every cast from paying the full timeoutMs when Ollama is down.
   */
  circuitBreakerThreshold: number;
  /** How long (ms) the breaker stays open before allowing a probe attempt. */
  circuitBreakerCooldownMs: number;
}

export interface EmbeddingBrainStats {
  calls: number;
  successes: number;
  timeouts: number;
  errors: number;
  emptyResults: number;
  avgLatencyMs: number;
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  circuitOpen: boolean;
  circuitCooldownRemainingMs: number;
}

const DEFAULT_CONFIG: EmbeddingBrainConfig = {
  url: process.env.CH1TTY_EMBED_URL ?? process.env.CH1TTY_OLLAMA_URL ?? 'http://127.0.0.1:11434',
  model: process.env.CH1TTY_EMBED_MODEL ?? 'nomic-embed-text',
  // 5s default: warm embed calls complete in ~300ms; 5s gives generous headroom while
  // preventing the 30s hang-per-cast landmine when Ollama is unreachable but TCP connects.
  timeoutMs: Number(process.env.CH1TTY_EMBED_TIMEOUT_MS ?? 5000),
  enabled: process.env.CH1TTY_EMBED_ENABLED !== 'false',
  minSimilarity: Number(process.env.CH1TTY_EMBED_MIN_SIMILARITY ?? 0.5),
  maxCandidates: Number(process.env.CH1TTY_EMBED_MAX_CANDIDATES ?? 200),
  topK: Number(process.env.CH1TTY_EMBED_TOP_K ?? 5),
  circuitBreakerThreshold: Number(process.env.CH1TTY_EMBED_CIRCUIT_THRESHOLD ?? 3),
  circuitBreakerCooldownMs: Number(process.env.CH1TTY_EMBED_CIRCUIT_COOLDOWN_MS ?? 60_000),
};

interface CachedVector {
  /** Hash of the embedded text — invalidates when description changes. */
  contentHash: string;
  /** L2-normalized vector. */
  vector: Float32Array;
}

export class EmbeddingBrain {
  readonly config: EmbeddingBrainConfig;

  private cache = new Map<string, CachedVector>();
  private calls = 0;
  private successes = 0;
  private timeouts = 0;
  private errors = 0;
  private emptyResults = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private totalLatencyMs = 0;

  // Circuit breaker state
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(config: Partial<EmbeddingBrainConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    merged.minSimilarity = Math.max(0, Math.min(1, merged.minSimilarity));
    merged.maxCandidates = Math.max(1, merged.maxCandidates);
    merged.topK = Math.max(1, merged.topK);
    merged.timeoutMs = Math.max(500, merged.timeoutMs);
    this.config = merged;
  }

  /**
   * Rank candidates by cosine similarity to the query. Returns null on any
   * failure mode — callers MUST fall back to the literal search path.
   *
   * Returns null immediately (no network call) when the circuit breaker is
   * open. The breaker trips after `circuitBreakerThreshold` consecutive
   * failures and stays open for `circuitBreakerCooldownMs`, then allows a
   * single probe attempt. This prevents every cast from blocking for
   * `timeoutMs` when Ollama is unreachable.
   */
  async route(query: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    if (!this.config.enabled) return null;
    if (!query.trim()) return null;
    if (candidates.length === 0) return null;

    // Circuit breaker: open → return null immediately without attempting embed
    if (this.circuitOpenUntil > 0) {
      if (Date.now() < this.circuitOpenUntil) {
        return null;
      }
      // Cooldown expired — allow one probe attempt (half-open)
      log.debug(`EmbeddingBrain circuit half-open, probing`, 'embedding-brain');
    }

    const pruned = candidates.slice(0, this.config.maxCandidates);
    const startedAt = Date.now();
    this.calls++;

    try {
      const [queryVec, candidateVecs] = await Promise.all([
        this.embedSingle(query),
        this.ensureCandidateVectors(pruned),
      ]);

      if (!queryVec || !candidateVecs) {
        // embedSingle / ensureCandidateVectors already incremented error/timeout counters
        this.recordCircuitFailure();
        return null;
      }

      const scored: RoutedTool[] = [];
      for (let i = 0; i < pruned.length; i++) {
        const vec = candidateVecs[i];
        if (!vec) continue;
        const sim = dot(queryVec, vec);
        if (sim < this.config.minSimilarity) continue;
        scored.push({
          tool: pruned[i]!,
          confidence: Math.min(1, Math.max(0, sim)),
          reason: 'embedding similarity',
        });
      }

      if (scored.length === 0) {
        this.emptyResults++;
        // Empty results are not a connectivity failure — don't trip the breaker
        this.consecutiveFailures = 0;
        return null;
      }

      scored.sort((a, b) => b.confidence - a.confidence);
      this.successes++;
      this.consecutiveFailures = 0;
      this.circuitOpenUntil = 0;
      return scored.slice(0, this.config.topK);
    } catch (err) {
      // Defensive — embedSingle/ensure* already trap their own errors. This
      // is for cosine math or shape mismatches we don't expect.
      this.errors++;
      this.recordCircuitFailure();
      log.warn(`Embedding route unexpected error: ${String(err)}`, 'embedding-brain');
      return null;
    } finally {
      this.totalLatencyMs += Date.now() - startedAt;
    }
  }

  /** Whether the circuit breaker is currently open (no embed calls will be attempted). */
  isCircuitOpen(): boolean {
    return this.circuitOpenUntil > 0 && Date.now() < this.circuitOpenUntil;
  }

  /**
   * Pre-fire a tiny embedding call so Ollama loads the model into memory
   * before the first real route(). Cold-load on `nomic-embed-text` is ~7s
   * on this VM. Fail-quiet.
   */
  async warmup(timeoutMs = 30000): Promise<boolean> {
    if (!this.config.enabled) return false;
    const result = await this.embed(['ok'], timeoutMs);
    if (result) log.info(`Embedding brain warm: model="${this.config.model}"`, 'embedding-brain');
    return Boolean(result);
  }

  getStats(): EmbeddingBrainStats {
    const now = Date.now();
    const circuitOpen = this.circuitOpenUntil > 0 && now < this.circuitOpenUntil;
    return {
      calls: this.calls,
      successes: this.successes,
      timeouts: this.timeouts,
      errors: this.errors,
      emptyResults: this.emptyResults,
      avgLatencyMs: this.calls > 0 ? Math.round(this.totalLatencyMs / this.calls) : 0,
      cacheSize: this.cache.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      circuitOpen,
      circuitCooldownRemainingMs: circuitOpen ? this.circuitOpenUntil - now : 0,
    };
  }

  private recordCircuitFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.circuitOpenUntil = Date.now() + this.config.circuitBreakerCooldownMs;
      log.warn(
        `EmbeddingBrain circuit open — ${this.consecutiveFailures} consecutive failures, cooldown ${this.config.circuitBreakerCooldownMs}ms`,
        'embedding-brain',
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private async embedSingle(text: string): Promise<Float32Array | null> {
    const res = await this.embed([text], this.config.timeoutMs);
    if (!res || res.length !== 1) return null;
    return res[0] ?? null;
  }

  /**
   * Return one normalized vector per candidate, embedding any uncached
   * descriptions in a single batched call. Returns null if the batch
   * call fails — partial failure is treated as total failure since the
   * caller can't safely score against incomplete vectors.
   */
  private async ensureCandidateVectors(
    candidates: ToolCandidate[],
  ): Promise<(Float32Array | null)[] | null> {
    const out: (Float32Array | null)[] = new Array(candidates.length).fill(null);
    const missingIdx: number[] = [];
    const missingText: string[] = [];
    const missingHashes: string[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      const text = describeForEmbed(c);
      const hash = hashText(text);
      const cached = this.cache.get(c.namespacedName);
      if (cached && cached.contentHash === hash) {
        out[i] = cached.vector;
        this.cacheHits++;
      } else {
        this.cacheMisses++;
        missingIdx.push(i);
        missingText.push(text);
        missingHashes.push(hash);
      }
    }

    if (missingIdx.length === 0) return out;

    const fresh = await this.embed(missingText, this.config.timeoutMs);
    if (!fresh || fresh.length !== missingText.length) return null;

    for (let j = 0; j < missingIdx.length; j++) {
      const idx = missingIdx[j]!;
      const vec = fresh[j]!;
      out[idx] = vec;
      this.cache.set(candidates[idx]!.namespacedName, {
        contentHash: missingHashes[j]!,
        vector: vec,
      });
    }
    return out;
  }

  /**
   * POST /api/embed. Returns L2-normalized Float32Arrays in input order, or
   * null on any failure mode. All caller-visible failure paths route through
   * the stat counters here.
   */
  private async embed(inputs: string[], timeoutMs: number): Promise<Float32Array[] | null> {
    if (inputs.length === 0) return [];
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.config.url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, input: inputs }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.errors++;
        const snippet = await response.text().catch(() => '').then((t) => t.slice(0, 200));
        log.warn(`Ollama embed HTTP ${response.status}`, 'embedding-brain', { model: this.config.model, body: snippet });
        return null;
      }

      const payload = (await response.json()) as { embeddings?: unknown };
      if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== inputs.length) {
        this.errors++;
        log.warn(`Ollama embed returned unexpected shape`, 'embedding-brain', {
          expected: inputs.length,
          got: Array.isArray(payload.embeddings) ? payload.embeddings.length : 'not-array',
        });
        return null;
      }

      const out: Float32Array[] = [];
      for (const raw of payload.embeddings) {
        if (!Array.isArray(raw) || raw.length === 0) {
          this.errors++;
          log.warn(`Ollama embed returned malformed vector`, 'embedding-brain');
          return null;
        }
        const vec = new Float32Array(raw.length);
        for (let k = 0; k < raw.length; k++) {
          const v = raw[k];
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            this.errors++;
            log.warn(`Ollama embed vector contains non-finite value`, 'embedding-brain');
            return null;
          }
          vec[k] = v;
        }
        normalizeInPlace(vec);
        out.push(vec);
      }
      return out;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.timeouts++;
        log.warn(`Ollama embed timed out after ${timeoutMs}ms`, 'embedding-brain');
      } else {
        this.errors++;
        log.warn(`Ollama embed error: ${String(err)}`, 'embedding-brain');
      }
      return null;
    } finally {
      clearTimeout(handle);
    }
  }
}

// ── Pure helpers ──────────────────────────────────────────────

function describeForEmbed(c: ToolCandidate): string {
  // Tool name carries semantic weight (e.g. "evidence/ingest_document").
  // Including it makes lookups by name-like queries rank well even when
  // descriptions are sparse.
  const desc = (c.description || '').slice(0, 500);
  const cat = c.category ? ` [${c.category}]` : '';
  return `${c.namespacedName}${cat}: ${desc}`;
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function normalizeInPlace(vec: Float32Array): void {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i]! * vec[i]!;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return; // pathological — leave as zero, dot products will be 0
  for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
}

/** Dot product of two L2-normalized vectors == cosine similarity. */
function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
