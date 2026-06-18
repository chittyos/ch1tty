/**
 * @chittyos/schema-client — canonical ontology client.
 * @canon chittycanon://core/services/chittyschema#ontology-client
 * @canon chittycanon://gov/governance#core-types
 *
 * Fetches the canonical entity-type ontology with the same
 * live / cache / local-fallback discipline ChittySchema's server-side
 * canon-client uses. The five core types are P / L / T / E / A
 * (Person / Location / Thing / Event / Authority) — Authority (A) is NEVER
 * omitted. The local fallback is a documented last resort (not a stub): a
 * loud signal that canon is unreachable, returning the five canonical types.
 */

const DEFAULT_CANON_BASE = 'https://canon.chitty.cc';
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1-hour fresh window
const DEFAULT_TIMEOUT_MS = 8_000;

/** The five core canonical entity types per chittycanon://gov/governance#core-types. */
export type CoreTypeCode = 'P' | 'L' | 'T' | 'E' | 'A';

export interface OntologyType {
  code: CoreTypeCode | string;
  name: string;
  description?: string;
  subtypes?: string[];
}

export type OntologySource = 'live' | 'cache' | 'local-fallback';

export interface Ontology {
  version: string;
  source: OntologySource | string;
  generatedAt: string;
  types: OntologyType[];
}

/**
 * Local fallback — the five core types. NOT a stub: a documented last resort,
 * surfaced with a clear `source: 'local-fallback'` so callers know canon was
 * unreachable. All five P/L/T/E/A are present; Authority (A) is mandatory.
 */
const FALLBACK_ONTOLOGY: Ontology = {
  version: 'fallback-0.0.0',
  source: 'local-fallback',
  generatedAt: new Date(0).toISOString(),
  types: [
    { code: 'P', name: 'Person', description: 'Actor with agency' },
    { code: 'L', name: 'Location', description: 'Context in space' },
    { code: 'T', name: 'Thing', description: 'Object without agency' },
    { code: 'E', name: 'Event', description: 'Occurrence in time' },
    { code: 'A', name: 'Authority', description: 'Source of weight' },
  ],
};

export interface OntologyClientOptions {
  canonBase?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * In-memory-cached client for the canonical entity-type ontology. Mirrors the
 * server-side canon-client: try cache, then live fetch (populate cache), then
 * stale cache, then the hardcoded P/L/T/E/A fallback. Never throws on network
 * failure — entity typing must degrade, not break.
 */
export class OntologyClient {
  private readonly canonBase: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private cached: { value: Ontology; expiresAt: number } | null = null;

  constructor(opts: OntologyClientOptions = {}) {
    this.canonBase = (opts.canonBase ?? DEFAULT_CANON_BASE).replace(/\/+$/, '');
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (!f) throw new Error('OntologyClient: no fetch implementation available');
    this.fetchImpl = f.bind(globalThis);
  }

  private async withTimeout<T>(p: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await p(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resolve the ontology — live, cached, or local fallback (always succeeds). */
  async getOntology(): Promise<Ontology> {
    const now = Date.now();
    if (this.cached && now < this.cached.expiresAt) {
      return { ...this.cached.value, source: 'cache' };
    }

    try {
      const res = await this.withTimeout((signal) =>
        this.fetchImpl(`${this.canonBase}/api/ontology`, {
          headers: { Accept: 'application/json' },
          signal,
        }),
      );
      if (res.ok) {
        const live = (await res.json()) as Ontology;
        if (Array.isArray(live.types) && live.types.length > 0) {
          this.cached = {
            value: { ...live, source: 'live' },
            expiresAt: now + this.cacheTtlMs,
          };
          return { ...live, source: 'live' };
        }
      }
    } catch {
      // fall through to stale cache / fallback
    }

    if (this.cached) return { ...this.cached.value, source: 'cache' };
    return FALLBACK_ONTOLOGY;
  }

  /** Is `code` a recognized canonical entity-type code? */
  async isValidType(code: string): Promise<boolean> {
    const ontology = await this.getOntology();
    return ontology.types.some((t) => t.code === code);
  }
}
