// Workers AI brain — vector-similarity intent router. Replaces both
// embedding-brain.ts (Ollama /api/embed + nomic-embed-text, 768-dim) and the
// opt-in generative ollama-brain.ts (llama3.2:3b). The route() contract,
// candidate-vector cache, circuit breaker, cosine math, top-k filtering, and
// the "null means fall back to literal search" guarantee are ALL preserved.
//
// CHANGE: embeddings come from Workers AI `@cf/baai/bge-base-en-v1.5` (768-dim,
// dimensionally compatible with nomic-embed-text) via env.AI.run(), instead of
// an HTTP POST to a local Ollama daemon (no localhost in a Worker).
//
// OPTIONAL: when a Vectorize binding is present, candidate vectors are upserted
// on registry refresh and queries route through Vectorize topK search instead
// of in-isolate cosine — same ranking semantics (cosine), durable across
// requests. Without Vectorize it falls back to the in-memory cosine path.
//
// @canon chittycanon://gov/governance#coordinator-knows-who-knows
import { log } from './logger.js';

/** Minimal tool shape the brain needs for ranking (ported from ollama-brain.ts). */
export interface ToolCandidate {
  namespacedName: string;
  description: string;
  category?: string;
  serverName?: string;
}

export interface RoutedTool {
  tool: ToolCandidate;
  confidence: number;
  reason: string;
}

export interface BrainStats {
  calls: number;
  successes: number;
  errors: number;
  emptyResults: number;
  avgLatencyMs: number;
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  circuitOpen: boolean;
  circuitCooldownRemainingMs: number;
  vectorize: boolean;
}

/** Workers AI text-embedding model. 768-dim, cosine. Replaces nomic-embed-text. */
export const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
export const EMBED_DIM = 768;

export interface WorkersAiBrainConfig {
  enabled: boolean;
  minSimilarity: number;
  maxCandidates: number;
  topK: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
}

const DEFAULT_CONFIG: WorkersAiBrainConfig = {
  enabled: true,
  minSimilarity: 0.5,
  maxCandidates: 200,
  topK: 5,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMs: 60_000,
};

interface CachedVector {
  contentHash: string;
  vector: Float32Array;
}

export class WorkersAiBrain {
  readonly config: WorkersAiBrainConfig;
  private ai: Ai;
  private vectorize?: VectorizeIndex;

  private cache = new Map<string, CachedVector>();
  private calls = 0;
  private successes = 0;
  private errors = 0;
  private emptyResults = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private totalLatencyMs = 0;

  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private probing = false;

  constructor(ai: Ai, vectorize?: VectorizeIndex, config: Partial<WorkersAiBrainConfig> = {}) {
    this.ai = ai;
    this.vectorize = vectorize;
    const merged = { ...DEFAULT_CONFIG, ...config };
    merged.minSimilarity = Math.max(0, Math.min(1, merged.minSimilarity));
    merged.maxCandidates = Math.max(1, merged.maxCandidates);
    merged.topK = Math.max(1, merged.topK);
    this.config = merged;
  }

  /**
   * Rank candidates by cosine similarity to the query. Returns null on any
   * failure mode — callers MUST fall back to the literal search path.
   */
  async route(query: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    if (!this.config.enabled) return null;
    if (!query.trim()) return null;
    if (candidates.length === 0) return null;

    // Circuit breaker: open → null immediately (no embed call).
    if (this.circuitOpenUntil > 0) {
      if (Date.now() < this.circuitOpenUntil) return null;
      if (this.probing) return null;
      this.probing = true;
      log.debug(`WorkersAiBrain circuit half-open, probing`, 'brain');
    }

    const pruned = candidates.slice(0, this.config.maxCandidates);
    const startedAt = Date.now();
    this.calls++;

    try {
      // Vectorize path: query the durable index when bound.
      if (this.vectorize) {
        const result = await this.routeVectorize(query, pruned);
        if (result === null) {
          this.recordCircuitFailure();
          this.probing = false;
          return null;
        }
        if (result.length === 0) {
          this.emptyResults++;
          this.consecutiveFailures = 0;
          this.probing = false;
          return null;
        }
        this.successes++;
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = 0;
        this.probing = false;
        return result.slice(0, this.config.topK);
      }

      // In-isolate cosine path.
      const [queryVec, candidateVecs] = await Promise.all([
        this.embedSingle(query),
        this.ensureCandidateVectors(pruned),
      ]);
      if (!queryVec || !candidateVecs) {
        this.recordCircuitFailure();
        this.probing = false;
        return null;
      }

      const scored: RoutedTool[] = [];
      for (let i = 0; i < pruned.length; i++) {
        const vec = candidateVecs[i];
        if (!vec) continue;
        const sim = dot(queryVec, vec);
        if (sim < this.config.minSimilarity) continue;
        scored.push({ tool: pruned[i]!, confidence: Math.min(1, Math.max(0, sim)), reason: 'embedding similarity' });
      }

      if (scored.length === 0) {
        this.emptyResults++;
        this.consecutiveFailures = 0;
        this.probing = false;
        return null;
      }

      scored.sort((a, b) => b.confidence - a.confidence);
      this.successes++;
      this.consecutiveFailures = 0;
      this.circuitOpenUntil = 0;
      this.probing = false;
      return scored.slice(0, this.config.topK);
    } catch (err) {
      this.errors++;
      this.recordCircuitFailure();
      this.probing = false;
      log.warn(`WorkersAiBrain route error: ${String(err)}`, 'brain');
      return null;
    } finally {
      this.totalLatencyMs += Date.now() - startedAt;
    }
  }

  /**
   * Upsert candidate vectors into Vectorize. Called on registry refresh so the
   * index reflects the live tool surface. No-op without a Vectorize binding.
   * Returns the number of vectors upserted.
   */
  async indexCandidates(candidates: ToolCandidate[]): Promise<number> {
    if (!this.vectorize || candidates.length === 0) return 0;
    const texts = candidates.map(describeForEmbed);
    const vectors = await this.embed(texts);
    if (!vectors) return 0;
    const items: VectorizeVector[] = candidates.map((c, i) => ({
      id: c.namespacedName,
      values: Array.from(vectors[i]!),
      metadata: {
        namespacedName: c.namespacedName,
        description: c.description.slice(0, 500),
        category: c.category ?? '',
        serverName: c.serverName ?? '',
      },
    }));
    await this.vectorize.upsert(items);
    return items.length;
  }

  getStats(): BrainStats {
    const now = Date.now();
    const circuitOpen = this.circuitOpenUntil > 0 && now < this.circuitOpenUntil;
    return {
      calls: this.calls,
      successes: this.successes,
      errors: this.errors,
      emptyResults: this.emptyResults,
      avgLatencyMs: this.calls > 0 ? Math.round(this.totalLatencyMs / this.calls) : 0,
      cacheSize: this.cache.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      circuitOpen,
      circuitCooldownRemainingMs: circuitOpen ? this.circuitOpenUntil - now : 0,
      vectorize: Boolean(this.vectorize),
    };
  }

  private recordCircuitFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.circuitOpenUntil = Date.now() + this.config.circuitBreakerCooldownMs;
      log.warn(`WorkersAiBrain circuit open — ${this.consecutiveFailures} consecutive failures`, 'brain');
    }
  }

  // ── Vectorize path ──────────────────────────────────────────

  private async routeVectorize(query: string, candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    const queryVec = await this.embedSingle(query);
    if (!queryVec) return null;
    const byName = new Map(candidates.map((c) => [c.namespacedName, c]));
    const res = await this.vectorize!.query(Array.from(queryVec), {
      topK: Math.min(this.config.topK * 4, 50),
      returnMetadata: true,
    });
    const out: RoutedTool[] = [];
    for (const match of res.matches) {
      if (match.score < this.config.minSimilarity) continue;
      // Only surface tools that are still in the live candidate set.
      const cand = byName.get(match.id) ?? this.candidateFromMetadata(match);
      if (!cand) continue;
      out.push({ tool: cand, confidence: Math.min(1, Math.max(0, match.score)), reason: 'vectorize similarity' });
    }
    out.sort((a, b) => b.confidence - a.confidence);
    return out;
  }

  private candidateFromMetadata(match: VectorizeMatch): ToolCandidate | null {
    const m = match.metadata;
    if (!m || typeof m.namespacedName !== 'string') return null;
    return {
      namespacedName: m.namespacedName,
      description: typeof m.description === 'string' ? m.description : '',
      category: typeof m.category === 'string' ? m.category : undefined,
      serverName: typeof m.serverName === 'string' ? m.serverName : undefined,
    };
  }

  // ── Embedding helpers ───────────────────────────────────────

  private async embedSingle(text: string): Promise<Float32Array | null> {
    const res = await this.embed([text]);
    if (!res || res.length !== 1) return null;
    return res[0] ?? null;
  }

  private async ensureCandidateVectors(candidates: ToolCandidate[]): Promise<(Float32Array | null)[] | null> {
    const out: (Float32Array | null)[] = new Array(candidates.length).fill(null);
    const missingIdx: number[] = [];
    const missingText: string[] = [];
    const missingHashes: string[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      const text = describeForEmbed(c);
      const hash = await hashText(text);
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

    const fresh = await this.embed(missingText);
    if (!fresh || fresh.length !== missingText.length) return null;

    for (let j = 0; j < missingIdx.length; j++) {
      const idx = missingIdx[j]!;
      const vec = fresh[j]!;
      out[idx] = vec;
      this.cache.set(candidates[idx]!.namespacedName, { contentHash: missingHashes[j]!, vector: vec });
    }
    return out;
  }

  /**
   * Embed inputs via Workers AI. Returns L2-normalized Float32Arrays in input
   * order, or null on any failure. bge-base supports batched string arrays.
   */
  private async embed(inputs: string[]): Promise<Float32Array[] | null> {
    if (inputs.length === 0) return [];
    try {
      const resp = (await this.ai.run(EMBED_MODEL, { text: inputs })) as { data?: number[][]; shape?: number[] };
      const data = resp?.data;
      if (!Array.isArray(data) || data.length !== inputs.length) {
        this.errors++;
        log.warn(`Workers AI embed returned unexpected shape`, 'brain', {
          expected: inputs.length,
          got: Array.isArray(data) ? data.length : 'not-array',
        });
        return null;
      }
      const out: Float32Array[] = [];
      for (const raw of data) {
        if (!Array.isArray(raw) || raw.length === 0) {
          this.errors++;
          log.warn(`Workers AI embed returned malformed vector`, 'brain');
          return null;
        }
        const vec = new Float32Array(raw.length);
        for (let k = 0; k < raw.length; k++) {
          const v = raw[k];
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            this.errors++;
            log.warn(`Workers AI embed vector contains non-finite value`, 'brain');
            return null;
          }
          vec[k] = v;
        }
        normalizeInPlace(vec);
        out.push(vec);
      }
      return out;
    } catch (err) {
      this.errors++;
      log.warn(`Workers AI embed error: ${String(err)}`, 'brain');
      return null;
    }
  }
}

// ── Pure helpers (ported from embedding-brain.ts) ─────────────

function describeForEmbed(c: ToolCandidate): string {
  const desc = (c.description || '').slice(0, 500);
  const cat = c.category ? ` [${c.category}]` : '';
  return `${c.namespacedName}${cat}: ${desc}`;
}

async function hashText(text: string): Promise<string> {
  // Web Crypto (no node:crypto in a Worker). SHA-256, first 16 hex chars —
  // matches the original embedding-brain cache-key truncation.
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(buf).slice(0, 8);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeInPlace(vec: Float32Array): void {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i]! * vec[i]!;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return;
  for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
}

function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
