import type {
  ServerAccess,
  ServerCategory,
  ServerConfig,
  ServerStatus,
  ToolCallResult,
  ToolEntry,
  Backend,
  ContentItem,
} from './types.js';
import { ChildManager } from './child-manager.js';
import { RemoteProxy } from './remote-proxy.js';
import { loadConfigFromPath } from './config.js';
import { VERSION } from './utils.js';
import { log } from './logger.js';
import { SessionTracker } from './session.js';
import { SessionCoordinator } from './coordinator.js';
import type { ToolCandidate } from './ollama-brain.js';
import {
  applyFocusBias,
  isInFocus,
  loadFocusProfilesFromPath,
  resolveFocus,
  resolveFocusProfilesPath,
} from './focus.js';
import type { FocusProfile, FocusProfiles } from './focus.js';
import {
  loadSuggestionsCatalog,
  clearSuggestionsCache,
  getSuggestionsForFocus,
  findCatalogCombo,
  resolveSuggestionsCatalogPath,
} from './suggestions.js';
import type { FocusSuggestions, SuggestedCombo, SuggestedPrompt } from './suggestions.js';

const SEPARATOR = '/';
const META_SERVER_ID = 'ch1tty';
const META_TOOL_VERBS: ReadonlySet<string> = new Set(['search', 'execute', 'status', 'reload', 'cast']);

interface NamespacedTool {
  serverId: string;
  serverName: string;
  category: ServerCategory;
  access: ServerAccess;
  name: string;
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AggregatorOptions {
  accessFilter?: ServerAccess;
  categoryFilter?: ServerCategory;
  configPath?: string;
  /** Process-wide default focus profile name (from CH1TTY_FOCUS). */
  focus?: string;
  /** Override the focus-profiles file path (defaults to focus-profiles.json). */
  focusProfilesPath?: string;
  /** Pre-loaded focus profiles (mainly for tests); otherwise loaded from path. */
  focusProfiles?: FocusProfiles;
  /** Override the focus-suggestions catalog path (defaults to focus-suggestions.json). */
  suggestionsCatalogPath?: string;
  /** Pre-loaded suggestions catalog (mainly for tests). */
  suggestionsCatalog?: Record<string, FocusSuggestions>;
  /**
   * Override how backends are constructed. Returns a real {@link Backend} for a
   * given config. Defaults to ChildManager (local) / RemoteProxy (remote).
   *
   * This is the simulation seam: a harness can supply in-process fixture backends
   * that implement the real Backend interface (real listTools/callTool) so the
   * gateway can be driven through end-to-end scenarios without live credentials.
   * It is NOT a module mock — the returned object is a real implementation of the
   * interface, routed through the normal registerServer path.
   */
  backendFactory?: (config: ServerConfig) => Backend;
  /**
   * Set to false to disable the embedding brain warmup — useful in tests and
   * environments without a local Ollama instance. Defaults to env-driven behaviour.
   */
  embedEnabled?: boolean;
  /**
   * Override the coordinator instance. Primarily for tests: pass a subclass that
   * stubs routeIntent to simulate specific brain routing scenarios without a live
   * Ollama/embedding endpoint.
   */
  coordinator?: SessionCoordinator;
  /**
   * Override the ledger DLQ path for this aggregator instance. Useful in tests to
   * keep each test's dead-letter WAL isolated from the shared default path so that
   * one test's ledger entries don't cause dlqEntries > 0 in another test's status check.
   */
  ledgerDlqPath?: string;
}

export class Aggregator {
  private backends = new Map<string, Backend>();
  private configs: ServerConfig[];
  private accessFilter?: ServerAccess;
  private categoryFilter?: ServerCategory;
  private configPath?: string;
  private focusProfiles: FocusProfiles;
  private suggestionsCatalog: Record<string, FocusSuggestions>;
  private suggestionsCatalogPath?: string;
  private defaultFocus?: string;
  private backendFactory?: (config: ServerConfig) => Backend;
  private startedAt = Date.now();
  readonly sessions = new SessionTracker();
  readonly coordinator: SessionCoordinator;

  // Internal tool registry — never exposed directly to clients
  private registry: NamespacedTool[] = [];
  private registryExpiresAt = 0;
  private registryRefreshing: Promise<void> | null = null;
  private static readonly REGISTRY_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(configs: ServerConfig[], options?: AggregatorOptions) {
    this.accessFilter = options?.accessFilter;
    this.categoryFilter = options?.categoryFilter;
    this.configPath = options?.configPath;
    this.defaultFocus = options?.focus;
    this.backendFactory = options?.backendFactory;
    this.focusProfiles = options?.focusProfiles
      ?? loadFocusProfilesFromPath(options?.focusProfilesPath ?? resolveFocusProfilesPath());
    if (options?.suggestionsCatalog !== undefined) {
      this.suggestionsCatalog = options.suggestionsCatalog;
      // No disk path — reload will preserve the injected catalog.
    } else {
      this.suggestionsCatalogPath = options?.suggestionsCatalogPath ?? resolveSuggestionsCatalogPath();
      this.suggestionsCatalog = loadSuggestionsCatalog(this.suggestionsCatalogPath);
    }
    this.configs = configs;
    const embedConfig = options?.embedEnabled === false ? { enabled: false } : {};
    this.coordinator = options?.coordinator ?? new SessionCoordinator({}, embedConfig, options?.ledgerDlqPath);
    this.rebuildBackends();
  }

  /**
   * Resolve the active focus profile for a call.
   *
   * Priority: per-call `focus` arg > session-sticky focus > process default (CH1TTY_FOCUS).
   * "" / "none" explicitly suppress focus and also clear the session-sticky focus.
   * A valid per-call focus name is persisted as the new session-sticky focus.
   */
  private resolveActiveFocus(perCall: unknown, sessionId?: string): { name?: string; profile?: FocusProfile } {
    let name: string | undefined;
    if (typeof perCall === 'string') {
      const trimmed = perCall.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'none') {
        if (sessionId) this.coordinator.setSessionFocus(sessionId, undefined);
        name = undefined;
      } else {
        if (sessionId) this.coordinator.setSessionFocus(sessionId, trimmed);
        name = trimmed;
      }
    } else {
      const sessionFocus = sessionId ? this.coordinator.getSessionFocus(sessionId) : undefined;
      if (sessionFocus) {
        name = sessionFocus;
      } else {
        const def = typeof this.defaultFocus === 'string' ? this.defaultFocus.trim() : undefined;
        name = !def || def.toLowerCase() === 'none' ? undefined : def;
      }
    }
    return { name, profile: resolveFocus(this.focusProfiles, name) };
  }

  /** The process-wide default focus, if set and known — for status reporting. */
  private activeFocusSnapshot(): { active: string; categories: ServerCategory[]; servers: string[]; boost: number } | null {
    const profile = resolveFocus(this.focusProfiles, this.defaultFocus);
    if (!profile || !this.defaultFocus) return null;
    return {
      active: this.defaultFocus,
      categories: profile.categories,
      servers: profile.servers,
      boost: profile.boost,
    };
  }

  private rebuildBackends(): void {
    this.backends.clear();
    const stdio = new ChildManager();
    const http = new RemoteProxy();

    for (const config of this.activeConfigs()) {
      const backend = this.backendFactory
        ? this.backendFactory(config)
        : config.type === 'local' ? stdio : http;
      backend.registerServer(config);
      this.backends.set(config.id, backend);
    }

    // Invalidate registry on backend rebuild
    this.registry = [];
    this.registryExpiresAt = 0;

    // Bind ecosystem backend to coordinator (first 'ecosystem' category remote server)
    const ecosystemConfig = this.activeConfigs().find(
      (c) => c.type === 'remote' && c.category === 'ecosystem',
    );
    if (ecosystemConfig) {
      const backend = this.backends.get(ecosystemConfig.id);
      if (backend) {
        this.coordinator.bindEcosystem(backend, ecosystemConfig.id);
      }
    }
  }

  private activeConfigs(): ServerConfig[] {
    return this.configs.filter((c) => {
      if (c.enabled === false) return false;
      if (this.accessFilter && c.access !== this.accessFilter) return false;
      if (this.categoryFilter && c.category !== this.categoryFilter) return false;
      return true;
    });
  }

  private backendFor(serverId: string): Backend | undefined {
    return this.backends.get(serverId);
  }

  /**
   * Pre-warm non-lazy backends. For every active server with `lazy === false`, fires a
   * background `listTools()` so the connection and tool cache are ready before the first
   * real request arrives. Errors are logged and swallowed — a failed warmup does not
   * crash the gateway; the backend reconnects lazily on the next real call.
   */
  preWarmNonLazy(): void {
    for (const config of this.activeConfigs()) {
      if (config.lazy === false) {
        const backend = this.backends.get(config.id);
        if (backend) {
          log.debug(`Pre-warming non-lazy backend`, config.id);
          void backend.listTools(config.id).catch((err) => {
            log.warn(`Pre-warm failed for ${config.id}: ${err}`);
          });
        }
      }
    }
  }

  // ── Internal tool registry ───────────────────────────────────

  private async refreshRegistry(): Promise<void> {
    // Coalesce concurrent refreshes
    if (this.registryRefreshing) return this.registryRefreshing;

    this.registryRefreshing = (async () => {
      const toolPromises = this.activeConfigs().map(async (config) => {
        try {
          const backend = this.backendFor(config.id);
          if (!backend) return [];

          const tools = await backend.listTools(config.id);
          return tools.map((t): NamespacedTool => ({
            serverId: config.id,
            serverName: config.name,
            category: config.category,
            access: config.access,
            name: t.name,
            namespacedName: `${config.id}${SEPARATOR}${t.name}`,
            description: t.description ?? t.name,
            inputSchema: t.inputSchema,
          }));
        } catch (err) {
          log.error(`Failed to list tools: ${err}`, config.id);
          return [];
        }
      });

      const results = await Promise.allSettled(toolPromises);
      this.registry = results.flatMap((r) =>
        /* c8 ignore next -- each toolPromise has its own try/catch, so rejected never occurs */
        r.status === 'fulfilled' ? r.value : [],
      );
      this.registryExpiresAt = Date.now() + Aggregator.REGISTRY_TTL;
    })();

    try {
      await this.registryRefreshing;
    } finally {
      this.registryRefreshing = null;
    }
  }

  private async getRegistry(): Promise<NamespacedTool[]> {
    if (Date.now() >= this.registryExpiresAt) {
      await this.refreshRegistry();
    }
    return this.registry;
  }

  // ── Meta-tools (the only tools exposed to clients) ──────────

  private metaTools(): Array<{
    name: string;
    description?: string;
    inputSchema: { type: 'object'; properties?: Record<string, object>; required?: string[] };
  }> {
    return [
      {
        name: `${META_SERVER_ID}${SEPARATOR}search`,
        description: 'Search the tool registry. Returns matching tool names, descriptions, and input schemas. Use before execute.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keywords matched against tool names and descriptions' },
            server: { type: 'string', description: 'Filter by server id (e.g. "neon", "chittyos")' },
            category: { type: 'string', description: 'Filter by category (ecosystem, code, search, reasoning, desktop, documents, communication)' },
            focus: { type: 'string', description: 'Focus profile to bias results toward (e.g. "finance", "governance", "design"). A soft lens — out-of-focus tools still appear. Use "none" to override the env default. Overrides CH1TTY_FOCUS for this call.' },
            limit: { type: 'number', description: 'Max results to return (default 20)' },
            offset: { type: 'number', description: 'Number of results to skip before returning the first result (default 0). Pair with limit to page through large result sets: offset:20, limit:20 returns the second page of 20.' },
            explain: { type: 'boolean', description: 'If true, include an explanation field in the response showing how results were ranked: match mode (and/partial), focus boost contributions, per-result relevance scores, recency signals, and a human-readable rationale. Useful for debugging ranking decisions (default: false).' },
            inFocusOnly: { type: 'boolean', description: 'If true and a focus profile is active, return only tools that are within the active focus (hard filter). Out-of-focus tools are excluded. No-op when no focus is active. Overrides the default lens behavior for this call (default: false).' },
            sessionId: { type: 'string', description: 'Explicit session ID. When provided, always takes priority over the transport-derived session ID — enabling stateless HTTP server-to-server callers to participate in session tracking (sticky focus, affinity, topTools). A session context is created lazily on first use.' },
          },
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}execute`,
        description: 'Execute a tool by its namespaced name (serverId/toolName). Use search to discover available tools first.',
        inputSchema: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'Namespaced tool name from search results (e.g. "neon/list_projects")' },
            args: { type: 'object', description: 'Arguments to pass to the tool' },
            dryRun: { type: 'boolean', description: 'If true, resolve the tool and return what would be called (server, tool, args) without executing. Makes zero backend calls. Useful for previewing or sandboxing (default: false).' },
            timeout: { type: 'number', description: 'Per-call timeout in milliseconds. Overrides CH1TTY_REMOTE_TIMEOUT_MS for this call only. Ignored for local (stdio) backends. Minimum 1ms; non-positive values are ignored (default: use CH1TTY_REMOTE_TIMEOUT_MS or 120000ms).' },
            sessionId: { type: 'string', description: 'Explicit session ID. When provided, always takes priority over the transport-derived session ID — enabling stateless HTTP server-to-server callers to participate in session tracking (sticky focus, affinity, topTools). A session context is created lazily on first use.' },
          },
          required: ['tool'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}status`,
        description: 'Gateway status — connected servers, tool counts, cache ages',
        inputSchema: {
          type: 'object',
          properties: {
            short: {
              type: 'boolean',
              description: 'If true, return a condensed snapshot: omit the servers list and coordinator session details. Health fields, counts, focus, and catalog stats are preserved. Use for lightweight health checks (default: false).',
            },
          },
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}reload`,
        description: 'Hot-reload servers.json without restarting the gateway',
        inputSchema: { type: 'object' },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}cast`,
        description:
          'Describe what you want done in natural language. Ch1tty searches its full surface — tools, prompts, and resources — ' +
          'resolves intent, and executes the best tool match. Related prompts and resources are surfaced alongside. ' +
          'Sub-meta to master-meta — the gateway calling itself.',
        inputSchema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: 'Natural language description of what you want accomplished',
            },
            args: {
              type: 'object',
              description: 'Arguments to pass to the resolved tool (if known)',
            },
            confirm: {
              type: 'boolean',
              description: 'If true, return the execution plan without running it (default: false)',
            },
            dryRun: {
              type: 'boolean',
              description: 'If true, resolve the intent and return only the matched tool name, score, and catalog combo — without executing or returning the full plan. Lighter than confirm: true. Takes precedence over confirm when both are set (default: false).',
            },
            focus: {
              type: 'string',
              description: 'Focus profile to bias resolution toward (e.g. "finance", "governance", "design"). A soft lens — out-of-focus tools stay candidates. Use "none" to override the env default. Overrides CH1TTY_FOCUS for this call.',
            },
            chain: {
              type: 'boolean',
              description: 'If true and the resolved tool is the first step of a catalog combo, auto-execute all remaining chain steps sequentially (default: false). Requires an active focus. Each step receives the previous step\'s text output as previousResult in its args, enabling data chaining between steps. Returns cast: chain_executed with per-step results.',
            },
            explain: {
              type: 'boolean',
              description: 'If true, include an explanation field in the response showing how the tool was selected: resolution method (brain or keyword), whether focus boosted the winner, top-scored candidates with scores, and a human-readable rationale. Works with all modes — executed, plan, dryRun, chain_executed, discovered, no_match (default: false).',
            },
            scope: {
              type: 'object',
              description: 'Hard-filter the registry before intent resolution — only tools matching ALL specified constraints are considered. Applied before focus boosting. Use to restrict cast to a specific server or category without changing the active focus.',
              properties: {
                servers: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Restrict resolution to tools from these server ids (e.g. ["neon", "cloudflare"]).',
                },
                categories: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Restrict resolution to tools in these categories (e.g. ["code", "ecosystem"]).',
                },
              },
            },
            timeout: { type: 'number', description: 'Per-call timeout in milliseconds applied to each backend execution within cast. Overrides CH1TTY_REMOTE_TIMEOUT_MS for this call only. Applied to each step in chain execution and to normal single-tool execution. Non-positive values are ignored (default: use CH1TTY_REMOTE_TIMEOUT_MS or 120000ms).' },
            sessionId: { type: 'string', description: 'Explicit session ID. When provided, always takes priority over the transport-derived session ID — enabling stateless HTTP server-to-server callers to participate in session tracking (sticky focus, affinity, topTools). A session context is created lazily on first use.' },
          },
          required: ['intent'],
        },
      },
    ];
  }

  private async handleMetaTool(toolName: string, args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    // Lazily create a coordinator session context when an explicit args.sessionId is
    // provided but no transport session exists for that ID. This enables stateless
    // HTTP callers to participate in session tracking without a prior onSessionStart.
    if (typeof args.sessionId === 'string' && args.sessionId) {
      const explicitSid = args.sessionId;
      if (!this.coordinator.hasSession(explicitSid)) {
        await this.coordinator.onSessionStart(explicitSid, 'http');
      }
    }
    switch (toolName) {
      case 'search':
        return this.handleSearch(args, sessionId);
      case 'execute':
        return this.handleExecute(args, sessionId);
      case 'status':
        return this.handleStatus(args);
      case 'reload':
        return this.handleReload();
      case 'cast':
        return this.handleCast(args, sessionId);
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ch1tty/${toolName}` }],
          isError: true,
        };
    }
  }

  // ── Search ──────────────────────────────────────────────────

  private async handleSearch(args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
    const serverFilter = typeof args.server === 'string' ? args.server : undefined;
    const categoryFilter = typeof args.category === 'string' ? args.category : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 0;
    const explain = args.explain === true;
    const inFocusOnly = args.inFocusOnly === true;
    const effectiveSessionId = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : sessionId;
    const { name: focusName, profile: focus } = this.resolveActiveFocus(args.focus, effectiveSessionId);

    const registry = await this.getRegistry();

    // Build session context for relevance boosting (coordinator + session tracker)
    const recentServerIds = new Set<string>();
    if (effectiveSessionId) {
      // Coordinator affinity (richer — tracks all tool calls with timestamps)
      const affinity = this.coordinator.getServerAffinity(effectiveSessionId);
      for (const serverId of affinity.keys()) {
        recentServerIds.add(serverId);
      }
      // Fallback to session tracker if coordinator hasn't seen this session
      if (recentServerIds.size === 0) {
        for (const tool of this.sessions.getRecentTools(effectiveSessionId)) {
          const sep = tool.indexOf(SEPARATOR);
          if (sep > 0) recentServerIds.add(tool.slice(0, sep));
        }
      }
    }

    let matches = registry;

    if (serverFilter) {
      matches = matches.filter((t) => t.serverId === serverFilter);
    }
    if (categoryFilter) {
      matches = matches.filter((t) => t.category === categoryFilter);
    }
    let partialFallback = false;
    if (query) {
      const queryTerms = query.split(/\s+/).filter((t) => t.length > 0);
      const andMatches = matches.filter((t) => {
        const haystack = `${t.namespacedName} ${t.description} ${t.serverName} ${t.category}`.toLowerCase();
        return queryTerms.every((term) => haystack.includes(term));
      });
      // OR fallback: when AND produces nothing and there are multiple terms, return
      // tools matching any term so callers get something useful rather than empty hands.
      if (andMatches.length === 0 && queryTerms.length > 1) {
        matches = matches.filter((t) => {
          const haystack = `${t.namespacedName} ${t.description} ${t.serverName} ${t.category}`.toLowerCase();
          return queryTerms.some((term) => haystack.includes(term));
        });
        partialFallback = true;
      } else {
        matches = andMatches;
      }
    }

    // Hard filter: when inFocusOnly is requested and a focus is active, drop out-of-focus tools entirely.
    if (inFocusOnly && focus) {
      matches = matches.filter((t) => isInFocus(focus, t));
    }

    // If no filters at all, return a summary of available servers instead of all tools
    if (!query && !serverFilter && !categoryFilter) {
      let serverSummary = this.activeConfigs().map((c) => {
        const count = registry.filter((t) => t.serverId === c.id).length;
        const inFocus = focus ? isInFocus(focus, { serverId: c.id, category: c.category }) : false;
        return { server: c.id, name: c.name, category: c.category, tools: count, ...(focus ? { inFocus } : {}) };
      });
      // Hard filter for server summary: when inFocusOnly is set, drop out-of-focus servers.
      if (inFocusOnly && focus) {
        serverSummary = serverSummary.filter((s) => s.inFocus);
      }
      // Soft lens: surface in-focus servers first; out-of-focus stay listed.
      if (focus && !inFocusOnly) {
        serverSummary = [...serverSummary].sort((a, b) => Number(b.inFocus) - Number(a.inFocus));
      }

      const entity = effectiveSessionId ? this.coordinator.getEntityContext(effectiveSessionId) : undefined;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            hint: 'Use query, server, or category to search for specific tools',
            ...(entity?.chittyId ? { entity: entity.chittyId, identityClass: entity.identityClass } : {}),
            ...(focusName ? { focus: focusName } : {}),
            ...(inFocusOnly && focus ? { inFocusOnly: true } : {}),
            servers: serverSummary,
            totalTools: registry.length,
          }, null, 2),
        }],
      };
    }

    // Relevance scoring: fraction of query terms matched + exact name/server-id bonus.
    // When query is present, results are ranked by relevance first; focus and recency
    // are secondary tiebreakers so the most matching tool surfaces regardless of session state.
    const relevanceMap = new Map<string, number>();
    if (query) {
      const queryTerms = query.split(/\s+/).filter((t) => t.length > 0);
      for (const t of matches) {
        const haystack = `${t.namespacedName} ${t.description} ${t.serverName} ${t.category}`.toLowerCase();
        const matchCount = queryTerms.filter((term) => haystack.includes(term)).length;
        const kwScore = queryTerms.length > 0 ? matchCount / queryTerms.length : 0;
        const nameBonus = queryTerms.some((term) =>
          t.name.toLowerCase() === term || t.serverId.toLowerCase() === term
        ) ? 0.3 : 0;
        relevanceMap.set(t.namespacedName, Math.round((kwScore + nameBonus) * 100) / 100);
      }
    }

    // Sort: relevance first (when query), then focus lens, then recently-used servers.
    // Stable on equal keys so within-bucket order is preserved. Out-of-focus and
    // non-recent tools remain in the result set, just ranked lower.
    const focused = (t: NamespacedTool): boolean => (focus ? isInFocus(focus, t) : false);
    if (relevanceMap.size > 0 || focus || recentServerIds.size > 0) {
      matches = [...matches].sort((a, b) => {
        const aRel = relevanceMap.get(a.namespacedName) ?? 0;
        const bRel = relevanceMap.get(b.namespacedName) ?? 0;
        if (aRel !== bRel) return bRel - aRel;
        const aFocus = focused(a) ? 1 : 0;
        const bFocus = focused(b) ? 1 : 0;
        if (aFocus !== bFocus) return bFocus - aFocus;
        const aRecent = recentServerIds.has(a.serverId) ? 1 : 0;
        const bRecent = recentServerIds.has(b.serverId) ? 1 : 0;
        return bRecent - aRecent;
      });
    }

    const results = matches.slice(offset, offset + limit).map((t) => {
      // Per-tool usage enrichment: prefer exact-tool pattern (callCount + lastUsedMs) over
      // server-level boolean. Falls back to `true` when the server was used but not this tool.
      const recentPattern = effectiveSessionId
        ? this.coordinator.getToolPattern(effectiveSessionId, t.namespacedName)
        : undefined;
      const recentlyUsedVal: { callCount: number; lastUsedMs: number } | true | undefined = recentPattern
        ? { callCount: recentPattern.count, lastUsedMs: recentPattern.lastUsed }
        : (recentServerIds.has(t.serverId) ? true : undefined);
      return {
        tool: t.namespacedName,
        server: t.serverId,
        category: t.category,
        description: t.description,
        inputSchema: t.inputSchema,
        /* c8 ignore next -- every tool in matches was scored into relevanceMap; ?? 0 never fires when size > 0 */
        ...(relevanceMap.size > 0 ? { score: relevanceMap.get(t.namespacedName) ?? 0 } : {}),
        ...(recentlyUsedVal !== undefined ? { recentlyUsed: recentlyUsedVal } : {}),
        ...(focus && focused(t) ? { inFocus: true } : {}),
      };
    });

    // Catalog suggestions: when focus is active and a query provides intent,
    // surface ranked combos+prompts from the suggestions catalog alongside tools.
    const focusSuggestions = (focusName && query)
      ? getSuggestionsForFocus(focusName, this.suggestionsCatalog, { intent: query })
      : null;

    const explanation = explain
      ? buildSearchExplanation(matches, results, relevanceMap, partialFallback, focusName, focus, recentServerIds)
      : null;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          matches: results.length,
          total: matches.length,
          ...(offset > 0 ? { offset } : {}),
          ...(partialFallback ? { mode: 'partial' } : {}),
          ...(focusName ? { focus: focusName } : {}),
          ...(inFocusOnly && focus ? { inFocusOnly: true } : {}),
          ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
          ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
          ...(explanation ? { explanation } : {}),
          tools: results,
        }, null, 2),
      }],
    };
  }

  // ── Execute ─────────────────────────────────────────────────

  private async handleExecute(args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const toolName = typeof args.tool === 'string' ? args.tool : '';
    const toolArgs = (typeof args.args === 'object' && args.args !== null && !Array.isArray(args.args))
      ? args.args as Record<string, unknown>
      : {};
    const dryRun = args.dryRun === true;
    const timeoutMs = typeof args.timeout === 'number' && args.timeout > 0 ? Math.floor(args.timeout) : undefined;
    const effectiveSessionId = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : sessionId;

    if (!toolName) {
      return {
        content: [{ type: 'text', text: 'Missing required "tool" argument. Use ch1tty/search to find tools first.' }],
        isError: true,
      };
    }

    const sepIndex = toolName.indexOf(SEPARATOR);
    if (sepIndex === -1) {
      return {
        content: [{
          type: 'text',
          text: `Invalid tool name "${toolName}". Expected format: serverId/toolName. Use ch1tty/search to discover tools.`,
        }],
        isError: true,
      };
    }

    const serverId = toolName.slice(0, sepIndex);
    const name = toolName.slice(sepIndex + 1);

    const backend = this.backendFor(serverId);
    if (!backend) {
      const knownServers = this.activeConfigs().map((c) => c.id).join(', ') || '(none)';
      return {
        content: [{
          type: 'text',
          text: `Unknown server "${serverId}". Known servers: ${knownServers}`,
        }],
        isError: true,
      };
    }

    if (dryRun) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'dry_run', server: serverId, tool: name, args: toolArgs }) }],
        isError: false,
      };
    }

    try {
      const result = await backend.callTool(serverId, name, toolArgs, timeoutMs !== undefined ? { timeoutMs } : undefined);
      if (effectiveSessionId) {
        this.sessions.recordToolCall(effectiveSessionId, toolName);
        this.coordinator.onToolCall(effectiveSessionId, toolName);
      }
      return result;
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Execute failed for ${toolName}: ${String(err)}` }],
        isError: true,
      };
    }
  }

  // ── Status / Reload ─────────────────────────────────────────

  getStatusSnapshot(): {
    gateway: string;
    version: string;
    uptime: number;
    totalServers: number;
    connectedServers: number;
    totalTools: number;
    registryCached: boolean;
    activeSessions: number;
    focus: { active: string; categories: ServerCategory[]; servers: string[]; boost: number } | null;
    availableFocusProfiles: string[];
    catalog: {
      loaded: boolean;
      totalCombos: number;
      byFocus: Record<string, number>;
      activeFocusSuggestions: { combos: SuggestedCombo[]; prompts: SuggestedPrompt[] } | null;
    };
    systemHealth: { status: 'ok' | 'warn' | 'degraded'; brainDegraded: boolean; ledgerStatus: 'ok' | 'warn' | 'degraded' };
    brainHealth: { status: 'ok' | 'degraded'; embeddingCircuitOpen: boolean; ollamaCircuitOpen: boolean };
    ledgerHealth: { status: 'ok' | 'warn' | 'degraded'; dropped: number; buffered: number; flushErrors: number; dlqEntries: number; dlqPath: string };
    coordinator: ReturnType<SessionCoordinator['getSnapshot']>;
    servers: ServerStatus[];
  } {
    const statuses: ServerStatus[] = this.activeConfigs().map((config) => {
      const backend = this.backendFor(config.id);
      const status = backend?.getStatus(config.id) ?? { connected: false, toolCount: 0, toolCacheAge: null };

      return {
        id: config.id,
        name: config.name,
        type: config.type,
        enabled: config.enabled !== false,
        ...status,
      };
    });

    const coordinatorSnap = this.coordinator.getSnapshot();
    const embeddingCircuitOpen = coordinatorSnap.embeddingBrain.circuitOpen;
    const ollamaCircuitOpen = coordinatorSnap.brain.circuitOpen;
    const ledgerStats = coordinatorSnap.ledger;
    // P2: use DLQ backlog (current) not cumulative drops — an operator can clear the DLQ and
    // the gateway recovers without restart; cumulative drops are observability-only.
    const ledgerDegraded = ledgerStats.dlqEntries > 0;
    const ledgerWarn = ledgerStats.dropped > 0 || ledgerStats.buffered > 0 || ledgerStats.flushErrors > 0;

    const brainDegraded = embeddingCircuitOpen || ollamaCircuitOpen;
    const ledgerStatus: 'ok' | 'warn' | 'degraded' = ledgerDegraded ? 'degraded' : ledgerWarn ? 'warn' : 'ok';

    const catalogByFocus: Record<string, number> = {};
    let catalogTotalCombos = 0;
    for (const [focusName, entry] of Object.entries(this.suggestionsCatalog)) {
      catalogByFocus[focusName] = entry.combos.length;
      catalogTotalCombos += entry.combos.length;
    }
    const catalogLoaded = catalogTotalCombos > 0 || Object.keys(this.suggestionsCatalog).length > 0;
    // P1: brain circuit open → warn, not degraded. Brain is optional (keyword fallback always
    // available); opening a brain circuit must not drain load-balanced instances that can still serve.
    const systemStatus: 'ok' | 'warn' | 'degraded' = ledgerStatus === 'degraded'
      ? 'degraded'
      : brainDegraded || ledgerStatus === 'warn'
        ? 'warn'
        : 'ok';

    const focusSnap = this.activeFocusSnapshot();
    const activeFocusSuggestions = focusSnap
      ? getSuggestionsForFocus(focusSnap.active, this.suggestionsCatalog, { maxCombos: 3, maxPrompts: 3 })
      : null;

    return {
      gateway: 'ch1tty',
      version: VERSION,
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      totalServers: statuses.length,
      connectedServers: statuses.filter((s) => s.connected).length,
      totalTools: statuses.reduce((sum, s) => sum + s.toolCount, 0),
      registryCached: Date.now() < this.registryExpiresAt,
      activeSessions: this.sessions.count,
      focus: focusSnap,
      availableFocusProfiles: Object.keys(this.focusProfiles.profiles),
      catalog: {
        loaded: catalogLoaded,
        totalCombos: catalogTotalCombos,
        byFocus: catalogByFocus,
        activeFocusSuggestions,
      },
      systemHealth: { status: systemStatus, brainDegraded, ledgerStatus },
      brainHealth: {
        status: brainDegraded ? 'degraded' : 'ok',
        embeddingCircuitOpen,
        ollamaCircuitOpen,
      },
      ledgerHealth: {
        status: ledgerStatus,
        dropped: ledgerStats.dropped,
        buffered: ledgerStats.buffered,
        flushErrors: ledgerStats.flushErrors,
        dlqEntries: ledgerStats.dlqEntries,
        dlqPath: ledgerStats.dlqPath,
      },
      coordinator: coordinatorSnap,
      servers: statuses,
    };
  }

  private async handleStatus(args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const snapshot = this.getStatusSnapshot();
    const short = args.short === true;
    if (short) {
      const { servers: _servers, coordinator, ...rest } = snapshot;
      const { sessions: _sessions, ...coordinatorShort } = coordinator;
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...rest, coordinator: coordinatorShort }, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
    };
  }

  private async handleReload(): Promise<ToolCallResult> {
    if (!this.configPath) {
      return {
        content: [{ type: 'text', text: 'No config path available for reload' }],
        isError: true,
      };
    }

    try {
      const newConfig = loadConfigFromPath(this.configPath);
      if (this.suggestionsCatalogPath) {
        clearSuggestionsCache();
        this.suggestionsCatalog = loadSuggestionsCatalog(this.suggestionsCatalogPath);
      }
      const oldIds = new Set(this.configs.map((c) => c.id));
      const newIds = new Set(newConfig.servers.map((c) => c.id));

      const added = newConfig.servers.filter((c) => !oldIds.has(c.id));
      const removed = this.configs.filter((c) => !newIds.has(c.id));

      // Snapshot old backends before rebuilding — rebuildBackends() mutates this.backends in place
      const oldBackends = new Map(this.backends);
      this.configs = newConfig.servers;
      this.rebuildBackends();
      this.preWarmNonLazy();

      // Now shut down the old backends — log any rejected shutdowns (C5).
      const seen = new Set<Backend>();
      const shutdowns: Promise<void>[] = [];
      for (const backend of oldBackends.values()) {
        if (seen.has(backend)) continue;
        seen.add(backend);
        shutdowns.push(backend.shutdown());
      }
      const results = await Promise.allSettled(shutdowns);
      for (const r of results) {
        if (r.status === 'rejected') {
          log.warn(`Reload: backend shutdown failed: ${r.reason}`);
        }
      }

      const freshness = this.catalogFreshnessCheck();
      const result = {
        reloaded: true,
        added: added.map((c) => c.id),
        removed: removed.map((c) => c.id),
        totalServers: this.activeConfigs().length,
        catalog: freshness,
      };

      log.info(`Config reloaded: +${added.length} -${removed.length} servers`);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Reload failed: ${String(err)}` }],
        isError: true,
      };
    }
  }

  /** Scan the loaded catalog for combo chain tools whose server ID isn't in the active config. */
  private catalogFreshnessCheck(): { totalCombos: number; phantomServerIds: string[] } {
    const configuredIds = new Set(this.configs.map((c) => c.id));
    const phantomSet = new Set<string>();
    let totalCombos = 0;

    for (const profile of Object.values(this.suggestionsCatalog)) {
      totalCombos += profile.combos.length;
      for (const combo of profile.combos) {
        for (const toolName of combo.chain) {
          const slashIdx = toolName.indexOf('/');
          if (slashIdx > 0) {
            const serverId = toolName.slice(0, slashIdx);
            if (!configuredIds.has(serverId)) {
              phantomSet.add(serverId);
            }
          }
        }
      }
    }

    return { totalCombos, phantomServerIds: [...phantomSet].sort() };
  }

  // ── Cast (sub-meta → master-meta) ───────────────────────────

  private async handleCast(args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const intent = typeof args.intent === 'string' ? args.intent.trim() : '';
    const toolArgs = (typeof args.args === 'object' && args.args !== null && !Array.isArray(args.args))
      ? args.args as Record<string, unknown>
      : {};
    const dryRun = args.dryRun === true;
    const confirm = !dryRun && args.confirm === true;
    const autoChain = args.chain === true;
    const explain = args.explain === true;
    const castTimeoutMs = typeof args.timeout === 'number' && args.timeout > 0 ? Math.floor(args.timeout) : undefined;
    const effectiveSessionId = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : sessionId;
    const { name: focusName, profile: focus } = this.resolveActiveFocus(args.focus, effectiveSessionId);

    if (!intent) {
      return {
        content: [{ type: 'text', text: 'Missing required "intent". Describe what you want done.' }],
        isError: true,
      };
    }

    const terms = intent.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    // Parse scope — hard filter applied to the registry before intent scoring.
    const scopeArg = (typeof args.scope === 'object' && args.scope !== null && !Array.isArray(args.scope))
      ? args.scope as Record<string, unknown>
      : null;
    const scopeServers = Array.isArray(scopeArg?.servers)
      ? (scopeArg.servers as unknown[]).filter((s): s is string => typeof s === 'string')
      : null;
    const scopeCategories = Array.isArray(scopeArg?.categories)
      ? (scopeArg.categories as unknown[]).filter((s): s is string => typeof s === 'string')
      : null;

    // Step 1: Score tools, prompts, and resources in parallel (Ch1tty searching itself)
    const [registryResult, promptsResult, resourcesResult] = await Promise.allSettled([
      this.getRegistry(),
      this.listAllPrompts(),
      this.listAllResources(),
    ]);

    if (registryResult.status !== 'fulfilled') {
      throw registryResult.reason;
    }

    // Apply scope hard-filter before scoring so intent resolution only sees allowed tools.
    let registry = registryResult.value;
    if (scopeServers && scopeServers.length > 0) {
      registry = registry.filter((t) => scopeServers.includes(t.serverId));
    }
    if (scopeCategories && scopeCategories.length > 0) {
      registry = registry.filter((t) => scopeCategories.includes(t.category));
    }

    const allPrompts = promptsResult.status === 'fulfilled'
      ? promptsResult.value.prompts
      : (() => {
          log.warn('handleCast(): failed to list prompts; continuing with empty prompt set', promptsResult.reason);
          return [] as Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>;
        })();
    const allResources = resourcesResult.status === 'fulfilled'
      ? resourcesResult.value.resources
      : (() => {
          log.warn('handleCast(): failed to list resources; continuing with empty resource set', resourcesResult.reason);
          return [] as Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
        })();
    // v2: Brain-first routing (Ollama/Alchemist via coordinator). Discovery-only —
    // the brain ranks; execution still flows deterministically through handleExecute.
    // Falls back to v1 keyword scoreIntent on null (brain disabled, timed out,
    // unreachable, or returned no high-confidence matches). Per the canonical
    // contract, callers MUST treat null as "fall back to literal search".
    const candidates: ToolCandidate[] = registry.map((t) => ({
      namespacedName: t.namespacedName,
      description: t.description,
      category: t.category,
      serverName: t.serverName,
    }));
    const routed = await this.coordinator.routeIntent(intent, candidates);

    let scoredTools: Array<NamespacedTool & { score: number }>;
    let castRoute: 'brain' | 'fallback';
    const keywordAugmented = new Set<string>();
    if (routed && routed.length > 0) {
      const byName = new Map(registry.map((t) => [t.namespacedName, t]));
      scoredTools = routed
        .map((r) => {
          const t = byName.get(r.tool.namespacedName);
          return t ? { ...t, score: r.confidence } : null;
        })
        .filter((t): t is NamespacedTool & { score: number } => t !== null);
      // When focus is active, the brain may have truncated in-focus candidates
      // to topK before the bias step can act. Augment with top keyword-scored
      // in-focus tools from the full registry so none are invisible to the lens.
      if (focus) {
        const seen = new Set(scoredTools.map((t) => t.namespacedName));
        let added = 0;
        for (const t of this.scoreIntent(intent, registry, effectiveSessionId)) {
          if (added >= 5) break;
          if (!seen.has(t.namespacedName) && isInFocus(focus, t)) {
            scoredTools.push(t);
            seen.add(t.namespacedName);
            keywordAugmented.add(t.namespacedName);
            added++;
          }
        }
      }
      castRoute = 'brain';
    } else {
      scoredTools = this.scoreIntent(intent, registry, effectiveSessionId);
      castRoute = 'fallback';
    }

    // Soft focus lens: additively boost in-focus candidates, then re-sort.
    // Applies to both routes — brain confidences and keyword scores are both
    // 0–1ish, so the profile boost (~0.5) lifts in-focus matches without erasing
    // strong out-of-focus ones. Never filters — out-of-focus stays a candidate.
    if (focus) {
      scoredTools = applyFocusBias(focus, scoredTools);
    }

    if (effectiveSessionId) {
      this.coordinator.ledger.record(effectiveSessionId, 'cast_route', {
        intent: intent.slice(0, 200),
        route: castRoute,
        confirm,
        candidate_count: scoredTools.length,
        ...(focusName ? { focus: focusName } : {}),
        ...(scopeServers ? { scope_servers: scopeServers } : {}),
        ...(scopeCategories ? { scope_categories: scopeCategories } : {}),
      });
    }

    // Score prompts against intent
    const scoredPrompts = allPrompts
      .map((p) => {
        const haystack = `${p.name} ${p.description || ''}`.toLowerCase();
        const matchCount = terms.filter((t) => haystack.includes(t)).length;
        const score = terms.length > 0 ? Math.round((matchCount / terms.length) * 100) / 100 : 0;
        return { ...p, score };
      })
      .filter((p) => p.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Score resources against intent
    const scoredResources = allResources
      .map((r) => {
        const haystack = `${r.uri} ${r.name} ${r.description || ''}`.toLowerCase();
        const matchCount = terms.filter((t) => haystack.includes(t)).length;
        const score = terms.length > 0 ? Math.round((matchCount / terms.length) * 100) / 100 : 0;
        return { ...r, score };
      })
      .filter((r) => r.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // No matches across any surface
    let resolvedBy: 'brain' | 'keyword' = castRoute === 'brain' ? 'brain' : 'keyword';

    // Compute catalog suggestions early — needed on all three paths (no_match,
    // discovered, executed/plan) so miss responses can still surface relevant chains.
    const focusSuggestions = focusName
      ? getSuggestionsForFocus(focusName, this.suggestionsCatalog, { intent })
      : null;

    // Build optional scope annotation (computed here so it's available on all code paths below).
    const scopeAnnotation = (scopeServers || scopeCategories)
      ? { ...(scopeServers ? { servers: scopeServers } : {}), ...(scopeCategories ? { categories: scopeCategories } : {}) }
      : null;

    if (scoredTools.length === 0 && scoredPrompts.length === 0 && scoredResources.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'no_match',
            resolvedBy,
            intent,
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explain ? { explanation: buildCastExplanation(resolvedBy, undefined, [], focusName, focus) } : {}),
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
            hint: 'No tools, prompts, or resources matched your intent. Try ch1tty/search with different keywords.',
          }, null, 2),
        }],
      };
    }

    const best = scoredTools[0];
    // Winner-aware refinement: brain path + focus augmentation can elevate a
    // keyword-added tool to first place after focus bias. Report 'keyword' when
    // the winning tool came from keyword augmentation, not brain ranking.
    if (best && castRoute === 'brain' && keywordAugmented.has(best.namespacedName)) {
      resolvedBy = 'keyword';
    }
    const alternatives = scoredTools.slice(1, 4).map((t) => ({
      tool: t.namespacedName,
      score: t.score,
      description: t.description,
    }));
    const explanation = explain ? buildCastExplanation(resolvedBy, best, scoredTools, focusName, focus) : null;

    // Build related prompts/resources context
    const related: Record<string, unknown> = {};
    if (scoredPrompts.length > 0) {
      related.prompts = scoredPrompts.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
        score: p.score,
      }));
    }
    if (scoredResources.length > 0) {
      related.resources = scoredResources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        score: r.score,
      }));
    }

    // If no tools matched but prompts/resources did, surface those
    if (!best) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'discovered',
            resolvedBy,
            intent,
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explanation ? { explanation } : {}),
            hint: 'No executable tools matched, but related prompts/resources found.',
            ...related,
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
          }, null, 2),
        }],
      };
    }

    // Check if the resolved tool is the entry-point of a curated catalog combo.
    const catalogCombo = focusName
      ? findCatalogCombo(best.namespacedName, focusName, this.suggestionsCatalog)
      : null;

    // When the combo has more than one step, surface the remaining chain so
    // clients know what to invoke next to complete the workflow.
    const chainContinuation = (catalogCombo && catalogCombo.chain.length > 1)
      ? {
          nextTool: catalogCombo.chain[1],
          remainingChain: catalogCombo.chain.slice(1),
          hint: `Continue the '${catalogCombo.name}' workflow: ${catalogCombo.chain.slice(1).join(' → ')}.`,
        }
      : null;

    // Step 2a: Auto-chain execution — run all combo steps sequentially when chain: true
    if (!confirm && autoChain && catalogCombo && catalogCombo.chain.length > 1) {
      const steps: Array<{ step: number; tool: string; ok: boolean; content?: unknown[]; error?: string }> = [];
      let previousStepOutput: string | null = null;
      const allTexts: string[] = [];

      for (let i = 0; i < catalogCombo.chain.length; i++) {
        const stepTool = catalogCombo.chain[i];
        let stepArgs: Record<string, unknown>;
        if (i === 0) {
          stepArgs = toolArgs;
        } else if (previousStepOutput !== null) {
          stepArgs = { previousResult: previousStepOutput };
        } else {
          stepArgs = {};
        }
        const r = await this.handleExecute({ tool: stepTool, args: stepArgs, ...(castTimeoutMs !== undefined ? { timeout: castTimeoutMs } : {}) }, effectiveSessionId);
        if (r.isError) {
          const firstContent = r.content[0] as { type?: string; text?: unknown } | undefined;
          const errText = typeof firstContent?.text === 'string' ? firstContent.text : JSON.stringify(r.content);
          steps.push({ step: i, tool: stepTool, ok: false, error: errText });
          previousStepOutput = null;
        } else {
          const textParts = (r.content as Array<{ type?: string; text?: unknown }>)
            .filter((c) => c.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text as string);
          previousStepOutput = textParts.length > 0 ? textParts.join('\n') : null;
          if (previousStepOutput !== null) allTexts.push(previousStepOutput);
          steps.push({ step: i, tool: stepTool, ok: true, content: r.content });
        }
      }

      const chainSummary = allTexts.length > 0 ? allTexts.join('\n\n') : undefined;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'chain_executed',
            resolvedBy,
            intent,
            ...(focusName ? { focus: focusName } : {}),
            ...(explanation ? { explanation } : {}),
            catalog: { name: catalogCombo.name, chain: catalogCombo.chain, accomplishes: catalogCombo.accomplishes },
            steps,
            ...(chainSummary !== undefined ? { summary: chainSummary } : {}),
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
          }, null, 2),
        }],
      };
    }

    // Step 2b: Dry-run mode — return only resolved tool + score + catalog match, no execution, no schema
    if (dryRun) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'resolved',
            resolvedBy,
            intent,
            ...(focusName ? { focus: focusName } : {}),
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explanation ? { explanation } : {}),
            resolved: { tool: best.namespacedName, score: best.score },
            ...(catalogCombo ? { catalogCombo: { name: catalogCombo.name, chain: catalogCombo.chain, accomplishes: catalogCombo.accomplishes } } : {}),
          }, null, 2),
        }],
      };
    }

    // Step 2c: Confirm mode — return the plan without executing
    if (confirm) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'plan',
            resolvedBy,
            intent,
            ...(focusName ? { focus: focusName } : {}),
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explanation ? { explanation } : {}),
            resolved: {
              tool: best.namespacedName,
              server: best.serverId,
              category: best.category,
              description: best.description,
              score: best.score,
              inputSchema: best.inputSchema,
            },
            ...(catalogCombo ? { resolvedFromCatalog: { name: catalogCombo.name, chain: catalogCombo.chain, accomplishes: catalogCombo.accomplishes } } : {}),
            ...(chainContinuation ? { chainContinuation } : {}),
            alternatives,
            ...related,
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
            args: toolArgs,
            hint: 'Call cast again without confirm to execute, or use ch1tty/execute directly.',
          }, null, 2),
        }],
      };
    }

    // Step 3: Execute (Ch1tty executing through itself)
    const result = await this.handleExecute(
      { tool: best.namespacedName, args: toolArgs, ...(castTimeoutMs !== undefined ? { timeout: castTimeoutMs } : {}) },
      effectiveSessionId,
    );

    // Return cast metadata + related context + raw tool output
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            cast: 'executed',
            resolvedBy,
            intent,
            ...(focusName ? { focus: focusName } : {}),
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explanation ? { explanation } : {}),
            resolved: best.namespacedName,
            score: best.score,
            ...(catalogCombo ? { resolvedFromCatalog: { name: catalogCombo.name, chain: catalogCombo.chain, accomplishes: catalogCombo.accomplishes } } : {}),
            ...(chainContinuation ? { chainContinuation } : {}),
            ...(alternatives.length > 0 ? { alternatives } : {}),
            ...related,
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
          }),
        },
        ...result.content,
      ],
      isError: result.isError,
    };
  }

  /**
   * Score registry tools against a natural language intent.
   *
   * v1: keyword matching + session affinity boost from coordinator.
   * v2 hook: a "brain" backend (Alchemist/Ollama) can replace this with
   * semantic scoring, arg extraction, and multi-step plan generation.
   */
  private scoreIntent(
    intent: string,
    registry: NamespacedTool[],
    sessionId?: string,
  ): Array<NamespacedTool & { score: number }> {
    // 3+ char terms drive the keyword fraction score; 2-char terms (e.g. "fs", "db")
    // are excluded from the fraction denominator to avoid noise from prepositions like
    // "of", "in", "to" — but they are still checked for exact name/serverId match bonus.
    const terms = intent.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const shortTerms = intent.toLowerCase().split(/\s+/).filter((t) => t.length === 2);
    if (terms.length === 0 && shortTerms.length === 0) return [];

    const affinityMap = sessionId
      ? this.coordinator.getServerAffinity(sessionId)
      : new Map<string, number>();

    const scored = registry.map((tool) => {
      const haystack = `${tool.namespacedName} ${tool.description} ${tool.serverName} ${tool.category}`.toLowerCase();

      // Keyword match (0–1): fraction of intent terms found in tool metadata
      const matchCount = terms.filter((term) => haystack.includes(term)).length;
      const keywordScore = terms.length > 0 ? matchCount / terms.length : 0;

      // Affinity boost (0–0.2): exponential decay from last use, 10-min half-life
      const affinityTs = affinityMap.get(tool.serverId);
      const affinityScore = affinityTs
        ? 0.2 * Math.exp(-(Date.now() - affinityTs) / (10 * 60 * 1000))
        : 0;

      // Exact name/serverId match bonus (0 or 0.3): checks both long and short terms
      // so that e.g. "fs" in the intent awards the bonus for the "fs" server.
      const nameBonus = [...terms, ...shortTerms].some((t) =>
        tool.name.toLowerCase() === t || tool.serverId.toLowerCase() === t,
      ) ? 0.3 : 0;

      const score = Math.round((keywordScore + affinityScore + nameBonus) * 100) / 100;
      return { ...tool, score };
    });

    return scored
      .filter((t) => t.score > 0.1)
      .sort((a, b) => b.score - a.score);
  }

  // ── Public MCP interface ────────────────────────────────────

  async listAllTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema: { type: 'object'; properties?: Record<string, object>; required?: string[] };
    }>;
  }> {
    // Slim-MCP: only expose meta-tools, never backend tools directly
    return { tools: this.metaTools() };
  }

  async callTool(namespacedName: string, args: Record<string, unknown> = {}, sessionId?: string): Promise<ToolCallResult> {
    const normalized = this.normalizeToolName(namespacedName);
    const sepIndex = normalized.indexOf(SEPARATOR);
    if (sepIndex === -1) {
      return {
        content: [{
          type: 'text',
          text:
            `Invalid tool name "${namespacedName}". ` +
            `Available tools: ch1tty/search, ch1tty/execute, ch1tty/status, ch1tty/reload, ch1tty/cast`,
        }],
        isError: true,
      };
    }

    const serverId = normalized.slice(0, sepIndex);
    const toolName = normalized.slice(sepIndex + 1);

    if (serverId !== META_SERVER_ID) {
      return {
        content: [{
          type: 'text',
          text: `Unknown tool "${namespacedName}". Use ch1tty/search to discover tools, then ch1tty/execute to invoke them.`,
        }],
        isError: true,
      };
    }

    return this.handleMetaTool(toolName, args, sessionId);
  }

  // Some MCP clients (notably OpenAI ASDK link wrappers) rewrite `/` to `.`
  // on the outbound path or strip the `ch1tty/` namespace. Older ASDK
  // manifests also exposed a stale `gateway_status` alias. Normalize all of
  // these to the canonical `ch1tty/<verb>` so a client-side packaging quirk
  // does not make the gateway look broken.
  private normalizeToolName(raw: string): string {
    if (!raw) return raw;
    let name = raw;
    const prefix = `${META_SERVER_ID}${SEPARATOR}`;
    // "Ch1tty/ch1tty/<verb>" or "ch1tty/ch1tty/<verb>" -> "ch1tty/<verb>"
    const doubled = name.toLowerCase();
    if (doubled.startsWith(`${prefix}${META_SERVER_ID}`)) {
      name = name.slice(prefix.length);
    }
    // Dot-notation: "ch1tty.<verb>" -> "ch1tty/<verb>"
    if (name.toLowerCase().startsWith(`${META_SERVER_ID}.`)) {
      name = `${prefix}${name.slice(META_SERVER_ID.length + 1)}`;
    }
    // Stale alias from older ASDK manifests.
    if (name === 'gateway_status') name = `${prefix}status`;
    // Bare verb (no namespace) -> namespace it.
    if (!name.includes(SEPARATOR) && !name.includes('.') && META_TOOL_VERBS.has(name)) {
      name = `${prefix}${name}`;
    }
    return name;
  }

  // ── Resources (passthrough — low cardinality, fine to expose) ─

  async listAllResources(): Promise<{
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  }> {
    const resourcePromises = this.activeConfigs().map(async (config) => {
      try {
        const backend = this.backendFor(config.id);
        if (!backend) return [];

        const { resources } = await backend.listResources(config.id);
        return resources.map((r) => ({
          uri: `${config.id}://${r.uri}`,
          name: `[${config.name}] ${r.name}`,
          description: r.description,
          mimeType: r.mimeType,
        }));
      } catch (err) {
        log.error(`Failed to list resources: ${err}`, config.id);
        return [];
      }
    });

    const results = await Promise.allSettled(resourcePromises);
    return {
      /* c8 ignore next -- each resourcePromise has its own try/catch, so rejected never occurs */
      resources: results.flatMap((r) => r.status === 'fulfilled' ? r.value : []),
    };
  }

  async listAllResourceTemplates(): Promise<{
    resourceTemplates: Array<{ uriTemplate: string; name: string; description?: string; mimeType?: string }>;
  }> {
    const templatePromises = this.activeConfigs().map(async (config) => {
      try {
        const backend = this.backendFor(config.id);
        if (!backend) return [];

        const { templates } = await backend.listResources(config.id);
        return templates.map((t) => ({
          uriTemplate: `${config.id}://${t.uriTemplate}`,
          name: `[${config.name}] ${t.name}`,
          description: t.description,
          mimeType: t.mimeType,
        }));
      } catch (err) {
        log.error(`Failed to list resource templates: ${err}`, config.id);
        return [];
      }
    });

    const results = await Promise.allSettled(templatePromises);
    return {
      /* c8 ignore next -- each templatePromise has its own try/catch, so rejected never occurs */
      resourceTemplates: results.flatMap((r) => r.status === 'fulfilled' ? r.value : []),
    };
  }

  async readResource(uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }> {
    const match = uri.match(/^([^:]+):\/\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid namespaced resource URI: ${uri}`);
    }

    const [, serverId, originalUri] = match;
    const backend = this.backendFor(serverId);
    if (!backend) {
      throw new Error(`Unknown server "${serverId}" in resource URI: ${uri}`);
    }

    return backend.readResource(serverId, originalUri);
  }

  // ── Prompts (passthrough — low cardinality) ─────────────────

  async listAllPrompts(): Promise<{
    prompts: Array<{
      name: string;
      description?: string;
      arguments?: Array<{ name: string; description?: string; required?: boolean }>;
    }>;
  }> {
    const promptPromises = this.activeConfigs().map(async (config) => {
      try {
        const backend = this.backendFor(config.id);
        if (!backend) return [];

        const prompts = await backend.listPrompts(config.id);
        return prompts.map((p) => ({
          name: `${config.id}${SEPARATOR}${p.name}`,
          description: `[${config.name}] ${p.description || p.name}`,
          arguments: p.arguments,
        }));
      } catch (err) {
        log.error(`Failed to list prompts: ${err}`, config.id);
        return [];
      }
    });

    const results = await Promise.allSettled(promptPromises);
    return {
      /* c8 ignore next -- each promptPromise has its own try/catch, so rejected never occurs */
      prompts: results.flatMap((r) => r.status === 'fulfilled' ? r.value : []),
    };
  }

  async getPrompt(namespacedName: string, args?: Record<string, string>): Promise<{
    description?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }>;
  }> {
    const sepIndex = namespacedName.indexOf(SEPARATOR);
    if (sepIndex === -1) {
      throw new Error(`Invalid prompt name "${namespacedName}". Expected format: serverId/promptName`);
    }

    const serverId = namespacedName.slice(0, sepIndex);
    const promptName = namespacedName.slice(sepIndex + 1);

    const backend = this.backendFor(serverId);
    if (!backend) {
      throw new Error(`Unknown server "${serverId}" for prompt: ${namespacedName}`);
    }

    return backend.getPrompt(serverId, promptName, args);
  }

  // ── Lifecycle ───────────────────────────────────────────────

  async shutdown(): Promise<void> {
    // Flush ledger before shutting down backends
    await this.coordinator.ledger.shutdown();

    const seen = new Set<Backend>();
    const shutdowns: Promise<void>[] = [];

    for (const backend of this.backends.values()) {
      if (seen.has(backend)) continue;
      seen.add(backend);
      shutdowns.push(backend.shutdown());
    }

    await Promise.allSettled(shutdowns);
    this.backends.clear();
  }
}

// ── Cast explanation helper ────────────────────────────────────────────────

type ScoredNamespacedTool = NamespacedTool & { score: number };

function buildCastExplanation(
  resolvedBy: 'brain' | 'keyword',
  best: ScoredNamespacedTool | undefined,
  scoredTools: ScoredNamespacedTool[],
  focusName: string | undefined,
  focus: FocusProfile | null | undefined,
): object {
  const topCandidates = scoredTools.slice(0, 5).map((t) => ({ tool: t.namespacedName, score: t.score }));
  const winnerInFocus = best && focus ? isInFocus(focus, best) : false;
  const focusBoost = focus?.boost ?? 0.5;

  let rationale: string;
  if (!best) {
    rationale = `No tool candidates found via ${resolvedBy} routing.`;
  } else {
    const parts: string[] = [`Resolved "${best.namespacedName}" via ${resolvedBy} (score: ${best.score.toFixed(3)})`];
    if (focusName && winnerInFocus) {
      parts.push(`boosted by "${focusName}" focus (+${focusBoost})`);
    } else if (focusName) {
      parts.push(`("${focusName}" focus active; winner is out-of-focus)`);
    }
    if (topCandidates.length > 1) {
      const runner = topCandidates[1];
      parts.push(`over runner-up "${runner.tool}" (${runner.score.toFixed(3)})`);
    }
    rationale = parts.join(' ');
  }

  return {
    method: resolvedBy,
    ...(focusName ? { focus: focusName, focusBoost, winnerInFocus } : {}),
    topCandidates,
    rationale,
  };
}

function buildSearchExplanation(
  allMatches: NamespacedTool[],
  topResults: Array<{ tool: string; score?: number; inFocus?: boolean; recentlyUsed?: { callCount: number; lastUsedMs: number } | true }>,
  relevanceMap: Map<string, number>,
  partialFallback: boolean,
  focusName: string | undefined,
  focus: FocusProfile | null | undefined,
  recentServerIds: Set<string>,
): object {
  const matchMode = partialFallback ? 'partial' : 'and';
  const focusBoost = focus?.boost ?? 0.5;

  const topCandidates = topResults.slice(0, 5).map((r) => ({
    tool: r.tool,
    relevanceScore: relevanceMap.get(r.tool) ?? 0,
    ...(r.inFocus ? { inFocus: true } : {}),
    ...(r.recentlyUsed !== undefined ? { recentlyUsed: r.recentlyUsed } : {}),
  }));

  const inFocusCount = topResults.filter((r) => r.inFocus).length;
  const parts: string[] = [];
  parts.push(`Keyword search (${matchMode === 'partial' ? 'OR/partial fallback — no tool matched all terms' : 'AND mode'})`);
  if (topCandidates.length > 0) {
    const top = topCandidates[0];
    parts.push(`top result: "${top.tool}" (relevance: ${top.relevanceScore.toFixed(2)})`);
  }
  if (focusName) {
    parts.push(`"${focusName}" focus active — ${inFocusCount} of ${Math.min(topResults.length, 5)} top results in focus (boost +${focusBoost})`);
  }
  if (allMatches.length > topResults.length) {
    parts.push(`showing ${topResults.length} of ${allMatches.length} matches`);
  }
  const rationale = parts.join('; ') + '.';

  return {
    method: 'keyword' as const,
    matchMode,
    ...(focusName ? { focus: focusName, focusBoost } : {}),
    topCandidates,
    rationale,
  };
}
