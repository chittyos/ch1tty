/**
 * @chittyos/schema-client — canonical tool-schema client.
 * @canon chittycanon://core/services/chittyschema#tool-schema-client
 *
 * Fetches the FLAT canonical tool schema(s) that ChittySchema holds as the
 * source of truth, with the same live / in-memory-cache / local-fallback
 * discipline the canon-client uses for the ontology. When ChittySchema has no
 * canonical entry for a tool, callers fall back to the upstream self-report run
 * through `normalizeToolSchema` locally — so the de-nester is applied either
 * way, and the two code paths share one normalizer implementation.
 */

import { normalizeToolSchema, type JsonSchema } from './normalize.js';

const DEFAULT_REGISTRY = 'https://schema.chitty.cc';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5-minute fresh window, matches ch1tty tool cache
const DEFAULT_TIMEOUT_MS = 8_000;

/** A canonical tool schema entry as served by GET /api/tools/:server/:name. */
export interface CanonicalTool {
  server: string;
  name: string;
  description?: string;
  /** The flattened, de-nested schema — what code-mode type-gen should read. */
  canonicalSchema: JsonSchema;
  /** The raw upstream self-report ChittySchema normalized, kept for provenance. */
  originalSchema?: JsonSchema;
  updated_at?: string;
}

/** Provenance of a resolved tool schema, mirroring CanonOntology.source. */
export type ToolSchemaSource = 'live' | 'cache' | 'local-normalized';

export interface ResolvedToolSchema {
  server: string;
  name: string;
  schema: JsonSchema;
  source: ToolSchemaSource;
}

export interface ToolsClientOptions {
  /** Base URL of the ChittySchema deployment. Defaults to schema.chitty.cc. */
  registry?: string;
  /** Fresh window for the in-memory cache, in ms. */
  cacheTtlMs?: number;
  /** Per-request timeout, in ms. */
  timeoutMs?: number;
  /** Optional bearer for authenticated reads. */
  serviceToken?: string;
  /**
   * Injectable fetch (Workers/Node both provide global fetch; tests inject a
   * stub). Defaults to globalThis.fetch.
   */
  fetchImpl?: typeof fetch;
}

interface CacheEntry {
  tools: Map<string, CanonicalTool>;
  expiresAt: number;
}

/**
 * Client for the ChittySchema canonical tool-schema surface. Caches per-server
 * listings in memory (keyed by server id) and resolves individual tools against
 * that cache, refreshing on expiry. On any network failure it does NOT throw —
 * it returns the locally-normalized upstream schema instead, so the federation
 * layer never breaks because ChittySchema is unreachable.
 */
export class ToolsClient {
  private readonly registry: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly serviceToken?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: ToolsClientOptions = {}) {
    this.registry = (opts.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, '');
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.serviceToken = opts.serviceToken;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (!f) throw new Error('ToolsClient: no fetch implementation available');
    this.fetchImpl = f.bind(globalThis);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (this.serviceToken) h.Authorization = `Bearer ${this.serviceToken}`;
    return h;
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

  /**
   * Fetch (and cache) the canonical tool listing for a server. Returns an empty
   * map on any failure — callers treat "no canonical entry" identically whether
   * ChittySchema is empty or unreachable, and fall back to local normalization.
   */
  async fetchCanonicalTools(server: string): Promise<Map<string, CanonicalTool>> {
    const cached = this.cache.get(server);
    if (cached && Date.now() < cached.expiresAt) return cached.tools;

    const url = `${this.registry}/api/tools/${encodeURIComponent(server)}`;
    try {
      const res = await this.withTimeout((signal) =>
        this.fetchImpl(url, { headers: this.headers(), signal }),
      );
      if (!res.ok) {
        // 404 / 5xx: cache an empty map briefly so we don't hammer the registry.
        const empty = new Map<string, CanonicalTool>();
        this.cache.set(server, { tools: empty, expiresAt: Date.now() + this.cacheTtlMs });
        return empty;
      }
      const body = (await res.json()) as { tools?: CanonicalTool[] };
      const map = new Map<string, CanonicalTool>();
      for (const t of body.tools ?? []) {
        if (t && typeof t.name === 'string' && t.canonicalSchema) map.set(t.name, t);
      }
      this.cache.set(server, { tools: map, expiresAt: Date.now() + this.cacheTtlMs });
      return map;
    } catch {
      // Network/abort: serve stale cache if present, else empty.
      if (cached) return cached.tools;
      return new Map<string, CanonicalTool>();
    }
  }

  /**
   * Fetch a single canonical tool schema. Returns null when ChittySchema holds
   * no canonical entry for it (the signal for callers to normalize locally).
   */
  async fetchCanonicalTool(server: string, name: string): Promise<CanonicalTool | null> {
    const map = await this.fetchCanonicalTools(server);
    return map.get(name) ?? null;
  }

  /**
   * Resolve the schema code-mode type-gen should use for a tool:
   *  - canonical from ChittySchema when present (`source: live | cache`);
   *  - otherwise the upstream self-report normalized locally
   *    (`source: local-normalized`) — never the raw jacked schema.
   */
  async resolveToolSchema(
    server: string,
    name: string,
    upstreamSchema: JsonSchema | undefined | null,
  ): Promise<ResolvedToolSchema> {
    const cachedBefore = this.cache.get(server);
    const fromCache = Boolean(cachedBefore && Date.now() < cachedBefore.expiresAt);
    const canonical = await this.fetchCanonicalTool(server, name);
    if (canonical) {
      return {
        server,
        name,
        schema: canonical.canonicalSchema,
        source: fromCache ? 'cache' : 'live',
      };
    }
    return {
      server,
      name,
      schema: (normalizeToolSchema(upstreamSchema ?? {}) ?? {}) as JsonSchema,
      source: 'local-normalized',
    };
  }
}
