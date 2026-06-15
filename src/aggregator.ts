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
        description: 'Search the tool registry. Returns matching tool names, serverName, descriptions, and input schemas. All responses include latencyMs: wall-clock elapsed time in ms for the registry lookup + scoring. When a sessionId is active, also returns sessionContext: { recentTools, callCount, activeSessionFocus? } for one-shot session awareness. Use before execute.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keywords matched against tool names and descriptions' },
            server: { type: 'string', description: 'Filter by server id (e.g. "neon", "chittyos")' },
            category: { type: 'string', description: 'Filter by category (ecosystem, code, search, reasoning, desktop, documents, communication)' },
            focus: { type: 'string', description: 'Focus profile to bias results toward (e.g. "finance", "governance", "design"). A soft lens — out-of-focus tools still appear. Use "none" to override the env default. Overrides CH1TTY_FOCUS for this call.' },
            limit: { type: 'number', description: 'Max results to return (default 20)' },
            offset: { type: 'number', description: 'Number of results to skip before returning the first result (default 0). Pair with limit to page through large result sets: offset:20, limit:20 returns the second page of 20.' },
            explain: { type: 'boolean', description: 'If true, include an explanation field in the response showing how results were ranked: match mode (and/partial), filterContext (active server/category filter), focus boost contributions, per-result relevance scores, recency signals, and a human-readable rationale. Useful for debugging ranking decisions (default: false).' },
            inFocusOnly: { type: 'boolean', description: 'If true and a focus profile is active, return only tools that are within the active focus (hard filter). Out-of-focus tools are excluded. No-op when no focus is active. Overrides the default lens behavior for this call (default: false).' },
            minScore: { type: 'number', description: 'Minimum relevance score threshold (0–1.3). When set, only tools with a relevance score >= minScore are returned. Requires a query — no-op without one since scores are only computed for keyword searches. Use to cut noise from partial-match results (e.g. minScore: 0.5 for high-confidence matches only).' },
            sessionId: { type: 'string', description: 'Explicit session ID. When provided, always takes priority over the transport-derived session ID — enabling stateless HTTP server-to-server callers to participate in session tracking (sticky focus, affinity, topTools). A session context is created lazily on first use.' },
          },
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}execute`,
        description: 'Execute a tool by its namespaced name (serverId/toolName). Use search to discover available tools first. When a sessionId is active, a metadata JSON is appended as a second content item containing latencyMs (wall-clock backend call time in ms) + sessionContext: { recentTools, callCount, activeSessionFocus? } for one-shot session awareness. When dryRun: true, latencyMs and (if session active) sessionContext are embedded in the dry_run JSON instead.',
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
        description: 'Gateway status — connected servers, tool counts, cache ages, system health, and ledgerDlq shorthand (path + entryCount + entries[] at top level for quick DLQ inspection without filesystem access). All responses include latencyMs: wall-clock elapsed time in ms for the snapshot operation.',
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
        description: 'Hot-reload servers.json without restarting the gateway. Success responses include latencyMs: wall-clock elapsed time in ms for the full reload operation.',
        inputSchema: { type: 'object' },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}cast`,
        description:
          'Describe what you want done in natural language. Ch1tty searches its full surface — tools, prompts, and resources — ' +
          'resolves intent, and executes the best tool match. Related prompts and resources are surfaced alongside. ' +
          'When a sessionId is active, cast: executed and cast: chain_executed include sessionContext reflecting session state after execution; ' +
          'cast: plan, cast: resolved, cast: discovered, and cast: no_match include sessionContext reflecting pre-execution session state (recent tools, call count, sticky focus). ' +
          'All cast responses include latencyMs: the elapsed wall-clock time in milliseconds from intent submission to response (covers scoring + execution). ' +
          'cast: executed and cast: chain_executed also include latencyBreakdown: { scoringMs, executionMs, registryMs, brainMs? } — scoringMs is the time spent in registry fetch + intent routing/scoring before any backend call; executionMs is the time spent in the backend call(s); registryMs is the wall-clock time of the registry fetch only (getRegistry() call; a sub-component of scoringMs; near-zero if the registry was already cached; excludes prompts/resources fetch time); brainMs is present when the brain route was taken and shows the routeIntent() wall time. ' +
          'When explain: true is set and the brain route was taken, explanation includes brainMs: the wall-clock time of the brain routeIntent() call in milliseconds (alongside method: "brain"). Absent when the keyword-fallback route was used. ' +
          'explanation also includes candidateCount: the total number of tools in the scoring pool before the top-5 topCandidates slice. 0 on no_match. ' +
          'explanation also includes winnerScore: the numeric relevance score of the winning tool (topCandidates[0].score). Absent on no_match (no winner). Lets operators read the winner\'s score directly without indexing into topCandidates. ' +
          'explanation also includes runnerUpScore: the score of the second-place candidate (topCandidates[1].score), runnerUpTool: its namespaced tool name, runnerUpServer: the server ID of the runner-up tool (segment before "/" in the namespaced name, e.g. "neon" from "neon/query_database"), and runnerUpCategory: the category of the server that owns the runner-up tool (e.g. "ecosystem", "code", "search"). All four absent when there is 0 or 1 candidate (no_match, single-tool registries). runnerUpServer and runnerUpCategory parallel winnerServer and winnerCategory respectively, letting operators identify which backend and domain produced the closest competing tool without parsing runnerUpTool or consulting ch1tty/status. The margin winnerScore-runnerUpScore indicates how decisive the resolution was. ' +
          'explanation also includes candidateScoreSpread: number — the score range across all scored candidates (winnerScore - lowestCandidateScore), where lowestCandidateScore is the score of the lowest-scoring candidate in the full pool. Present when 2 or more candidates exist (same conditions as runnerUpScore). Absent when 0 or 1 candidate exists. A large spread means the winner\'s score is well above the weakest candidate (high discrimination); a spread near 0 means all candidates scored similarly (ambiguous pool). Differs from focusMargin (which is winner vs runner-up) — candidateScoreSpread covers the full candidate range. ' +
          'explanation also includes lowestCandidateScore: number — the relevance score of the weakest candidate in the full scored pool. Present when 2 or more candidates exist (same conditions as candidateScoreSpread). Absent when 0 or 1 candidate exists. The identity winnerScore - lowestCandidateScore === candidateScoreSpread always holds. A value near 0 means the weakest candidate had essentially no keyword overlap with the intent; a value near winnerScore means all candidates scored similarly (low discrimination). Makes the lower bound of the candidate distribution explicit without requiring the caller to compute winnerScore - candidateScoreSpread. ' +
          'explanation also includes winnerScoreRatio: number — the ratio of the winner\'s score to the runner-up\'s score (winnerScore / runnerUpScore). Present when a runner-up exists and runnerUpScore > 0 (same conditions as runnerUpScore, with a zero-score guard). Absent when there is 0 or 1 candidate, or when runnerUpScore is 0 (division guard). A value of 1.0 means the winner and runner-up scored equally; a value of 2.0 means the winner scored twice as high as the runner-up. Provides a multiplicative perspective on winner dominance that complements the additive focusMargin: focusMargin shows the raw gap, winnerScoreRatio shows relative strength. Not focus-dependent — computed from post-focus scores, so in-focus boosts are already incorporated. ' +
          'explanation also includes topCandidatesMeanScore: number — the arithmetic mean of the relevance scores across the topCandidates pool (up to 5 entries). Present when a winner exists (same conditions as winnerScore). Absent on no_match. A value near winnerScore means the top candidates are all similarly strong; a value well below winnerScore means the winner is a clear outlier above the rest of the pool. Combined with candidateScoreSpread, gives a statistical profile of the candidate score distribution without returning all raw scores. ' +
          'explanation also includes candidateScoreEntropy: number — the Shannon entropy (in bits) of the candidate score distribution, treating each tool\'s normalised relevance score as a probability mass (p_i = score_i / totalScore). H = -∑ p_i · log2(p_i) over all candidates with score > 0. Present when >= 2 candidates exist and the total score is > 0 (same conditions as candidateScoreSpread). Absent on no_match, single-candidate registries, or when all candidate scores are 0. Always >= 0. Maximum entropy is log2(candidateCount) — achieved when all tools score equally (uniform distribution); entropy of 0 means a single tool captured all score mass (a degenerate distribution where one tool scores > 0 and all others score 0). Unlike topCandidatesScoreVariance (which covers only the top-5 pool and measures absolute score spread), candidateScoreEntropy covers the entire candidate pool and measures relative concentration: a low entropy indicates that one or a few tools dominate the relevance distribution; a high entropy indicates many competitive tools with spread-out scores. ' +
          'When a focus profile is active, each entry in topCandidates also carries inFocus: boolean — true if that candidate is within the active focus profile (and therefore received a boost). Absent when no focus is active. ' +
          'explanation also includes winnerFocusBoost: the exact additive boost applied to the winning tool by the active focus profile. Equals focusBoost when winnerInFocus is true; 0 when winnerInFocus is false (winner was not in-focus). Absent when no focus is active or on no_match (no winner). ' +
          'explanation also includes focusDecisive: boolean — true when the winning tool would not have won without the focus boost (computed as winnerScore - winnerFocusBoost < runnerUpScore). Absent when no focus is active, on no_match, or when there is only one candidate (no runner-up to compare). ' +
          'explanation also includes focusMargin: number — the raw score gap between winner and runner-up in the focus-biased scoring space (winnerScore - runnerUpScore). Present when a focus profile is active and there is at least one runner-up. Lets operators see at a glance how large the winning margin was under the focus lens. ' +
          'explanation also includes focusMarginRatio: number — focusMargin normalised by winnerScore (focusMargin / winnerScore), expressing the post-focus gap between winner and runner-up as a fraction of the winner\'s total score. Present when a focus profile is active, a runner-up exists, and winnerScore > 0 (division guard). Absent when no focus is active, on no_match, fewer than 2 candidates, or winnerScore === 0. Always in (−∞, 1]: a value close to 1 means the runner-up scored near 0 relative to the winner; a value close to 0 means the runner-up nearly tied the winner; a negative value is impossible (focusMargin is always >= 0 when a runner-up exists in the sorted pool). Symmetric to rawFocusMarginRatio (rawFocusMargin / winnerScoreBase) but operating in the boosted score space rather than the pre-focus base space. Combining both ratios characterises how the focus boost affected the margin size: if focusMarginRatio > rawFocusMarginRatio, focus widened the gap proportionally; if focusMarginRatio < rawFocusMarginRatio, focus narrowed it. ' +
          'explanation also includes focusBias: number — fraction of the winner-runner-up margin attributable to the active focus boost (winnerFocusBoost / focusMargin). Present when a focus profile is active, there is at least one runner-up, and focusMargin is non-zero. Absent when focusMargin is 0 (tied candidates), when there is no runner-up, when focus is inactive, or on no_match. A value of 0 means the boost did not contribute to the margin (winner was out-of-focus); a value of 1 means the boost exactly equals the margin; values >1 mean the boost exceeded the raw unfocused margin. ' +
          'explanation also includes focusConfidence: number — focusBias clamped to [0,1]. Same presence conditions as focusBias (active focus, runner-up exists, focusMargin non-zero, best tool exists). A value of 0 means focus contributed nothing to the margin (winner was out-of-focus); a value of 1 means focus was at least fully decisive (focusBias ≥ 1). Unlike focusBias which can exceed 1 when the boost outweighs the margin, focusConfidence is always in [0,1] and can be read directly as a percentage confidence that focus drove the decision. ' +
          'explanation also includes winnerServer: string — the server ID of the winning tool (the segment before the "/" in its namespaced name, e.g. "neon" from "neon/query_database"). Absent on no_match (no winner). Lets operators identify which backend resolved the intent without parsing the tool name. ' +
          'explanation also includes winnerCategory: string — the server category of the winning tool (e.g. "ecosystem", "code", "communication", "documents", "search", "reasoning", "desktop"). Absent on no_match (no winner). Parallels winnerServer: while winnerServer identifies which specific backend resolved the intent, winnerCategory identifies the functional class of that backend. Useful for operators to reason about which domain of the registry (code, comms, docs, etc.) is satisfying a given intent stream without inspecting the tool name or server ID. ' + +
          'explanation also includes focusRank: number — the 1-based rank the winning tool would hold if the focus boost were removed (i.e. its position in pre-focus descending score order). Present when a focus profile is active and a winner exists. A value of 1 means the winner was already the top candidate without focus (focus did not change the outcome); a value of 2 means focus promoted the winner from 2nd to 1st; and so on. Consistent with focusDecisive: when focusDecisive is false and a runner-up exists, focusRank is always 1. ' +
          'explanation also includes unfocusedWinner: string — the namespaced tool name that would have won if the active focus boost were removed (the tool at rank 1 in pre-focus descending score order). Present only when a focus profile is active, a winner exists, and the pre-focus leader differs from the actual winner (i.e. focus changed the top spot). Absent when no focus is active, on no_match, or when the winner was already the top candidate without focus (focusRank === 1). Lets operators see exactly which tool was displaced by the focus boost. ' +
          'explanation also includes focusRankDelta: number — the number of positions the active focus boost promoted the winning tool in the pre-focus ranking (focusRank - 1). Present whenever focusRank is present (focus active and a winner exists). A value of 0 means the winner was already the top candidate before focus was applied (no promotion occurred); a value of 1 means focus moved the winner up one position (from 2nd to 1st); a value of 2 means two positions; and so on. Lets operators quantify how aggressively focus intervened in the selection without interpreting the raw rank. ' +
          'explanation also includes winnerScoreBase: number — the winning tool\'s relevance score before the active focus boost was applied (winnerScore - winnerFocusBoost). Present when a focus profile is active and a winner exists. Absent when no focus is active or on no_match (no winner). Equal to winnerScore when the winner is out-of-focus (winnerInFocus is false; no boost applied); strictly less than winnerScore when the winner is in-focus (winnerInFocus is true). The identity winnerScoreBase + winnerFocusBoost = winnerScore always holds, giving a complete decomposition of the winning score into its raw and focus-boosted components. ' +
          'explanation also includes candidatesInFocusCount: number — the number of scored candidates (out of candidateCount) whose server or category matches the active focus profile. Present when a focus profile is active and a winner exists (same conditions as winnerFocusBoost). Absent when no focus is active or on no_match (no winner). Value is 0 when no candidates are in-focus; equal to candidateCount when all candidates are in-focus. Combined with candidateCount, lets operators see the density of in-focus tools at query time (e.g. candidatesInFocusCount / candidateCount gives the in-focus fraction). ' +
          'explanation also includes inFocusFraction: number — the fraction of scored candidates that are in-focus (candidatesInFocusCount / candidateCount), as a value in [0,1]. Present under the same conditions as candidatesInFocusCount (focus active, winner exists, candidateCount > 0). Absent when no focus is active, on no_match, or when candidateCount === 0 (division guard). A value of 0 means no scored candidates match the active focus profile; a value of 1 means all scored candidates are in-focus. Provides a direct [0,1] density metric without requiring the caller to divide candidatesInFocusCount by candidateCount. ' +
          'explanation also includes outOfFocusCandidatesCount: number — the number of scored candidates (out of candidateCount) whose server and category do not match the active focus profile. Present under the same conditions as candidatesInFocusCount (focus active, winner exists). Absent when no focus is active or on no_match. The identity candidatesInFocusCount + outOfFocusCandidatesCount === candidateCount always holds. A value of 0 means all candidates are in-focus; a value equal to candidateCount means no candidates are in-focus. Complements candidatesInFocusCount: where candidatesInFocusCount counts how much of the registry aligns with the current focus, outOfFocusCandidatesCount counts how much does not. ' +
          'explanation also includes topOutOfFocusScore: number — the highest relevance score among all out-of-focus candidates (candidates whose server and category do not match the active focus profile). Present when a focus profile is active, a winner exists, and at least one out-of-focus candidate exists. Absent when no focus is active, on no_match, or when all candidates are in-focus (none are out-of-focus). Combined with winnerScore, shows the winner\'s advantage over the non-focus field; combined with winnerScoreBase, reveals whether the winner would have beaten the best out-of-focus candidate even without the boost (winnerScoreBase > topOutOfFocusScore means focus was not decisive for beating the out-of-focus field). ' +
          'explanation also includes outOfFocusWinnerGap: number — the score gap between the winning tool and the best out-of-focus candidate (winnerScore - topOutOfFocusScore). Present under the same conditions as topOutOfFocusScore (focus active, winner exists, at least one out-of-focus candidate). Always >= 0 since the winner holds the maximum post-boost score. A large gap means the winner is well clear of the non-focus field; a gap near 0 means an out-of-focus tool nearly matched the winner. Lets operators assess whether the winning tool dominated both the focus and non-focus fields without computing winnerScore - topOutOfFocusScore manually. ' +
          'explanation also includes focusRankPercentile: number — the winning tool\'s pre-focus rank expressed as a fraction of the total candidate pool (focusRank / candidateCount), giving a normalized [0,1] measure of how deeply buried the winner was before the active focus boost was applied. Present when a focus profile is active and a winner exists (same conditions as focusRank). Absent when no focus is active or on no_match (no winner). A low value (e.g. 1/candidateCount when focusRank === 1) means the winner was near the top of the pre-focus ranking; a high value (approaching 1 when focusRank equals candidateCount) means the winner was at the very bottom before focus promotion. The identity focusRankPercentile * candidateCount === focusRank always holds. ' +
          'explanation also includes inFocusTopScore: number — the highest relevance score among all in-focus candidates (candidates whose server or category matches the active focus profile). Present when a focus profile is active, a winner exists, and at least one in-focus candidate exists. Absent when no focus is active, on no_match, or when all candidates are out-of-focus (none are in-focus). When the winner is in-focus, inFocusTopScore equals winnerScore (the winner is the top in-focus candidate). When the winner is out-of-focus (the focus profile did not produce the winner), inFocusTopScore shows the best score the focus field achieved, enabling operators to see how close the focus candidates came to winning. ' +
          'explanation also includes inFocusWinnerGap: number — the score margin by which the winning tool beat the best in-focus candidate (winnerScore - inFocusTopScore). Present when a focus profile is active, a winner exists, winnerInFocus is false (the winner is out-of-focus), and at least one in-focus candidate exists (inFocusTopScore is defined). Absent when no focus is active, on no_match, when the winner is in-focus (the winner IS the top in-focus candidate so the gap is trivially 0 — use winnerScore directly), or when no in-focus candidates exist. Always >= 0; a large value means the out-of-focus winner dominated the focus field; a value near 0 means the best in-focus candidate nearly won. Complements outOfFocusWinnerGap: that field measures how far ahead the winner is of the out-of-focus field; this field measures how far ahead the winner is of the in-focus field. ' +
          'explanation also includes inFocusMeanScore: number — the arithmetic mean relevance score of all in-focus candidates (candidates whose server or category matches the active focus profile). Present when a focus profile is active, a winner exists, and at least one in-focus candidate exists (same conditions as inFocusTopScore). Absent when no focus is active, on no_match, or when no candidates are in-focus. When only one in-focus candidate exists, inFocusMeanScore equals inFocusTopScore. Combined with inFocusTopScore, characterizes the in-focus pool distribution: a mean close to the top score means the in-focus candidates are uniformly strong; a mean well below the top score means the in-focus field has one outlier above a weak tail. The identity (inFocusMeanScore <= inFocusTopScore) always holds. Complements topCandidatesMeanScore (which covers the top-5 pool regardless of focus alignment) by giving a mean specifically for the in-focus subset — useful when operators want to assess whether the active focus profile is selecting from a broadly competitive set or a single dominant tool. ' +
          'explanation also includes inFocusBottomScore: number — the lowest relevance score among all in-focus candidates (the minimum of the in-focus score pool). Present when a focus profile is active, a winner exists, and at least one in-focus candidate exists (same conditions as inFocusTopScore and inFocusMeanScore). Absent when no focus is active, on no_match, or when no candidates are in-focus (all are out-of-focus). When only one in-focus candidate exists, inFocusBottomScore equals inFocusTopScore (and inFocusMeanScore). The identity inFocusBottomScore <= inFocusMeanScore <= inFocusTopScore always holds. Together with inFocusTopScore and inFocusMeanScore, the triple (bottom/mean/top) fully characterises the in-focus score distribution: a wide gap between bottom and top signals a spread-out in-focus field; a small gap means all in-focus tools scored similarly. Symmetric to outOfFocusBottomScore: where outOfFocusBottomScore gives the floor of the non-focus competition, inFocusBottomScore gives the floor of the focused set. ' +
          'explanation also includes outOfFocusMeanScore: number — the arithmetic mean relevance score of all out-of-focus candidates (candidates whose server and category do not match the active focus profile). Present when a focus profile is active, a winner exists, and at least one out-of-focus candidate exists (same conditions as topOutOfFocusScore). Absent when no focus is active, on no_match, or when all candidates are in-focus (no out-of-focus candidates exist). When only one out-of-focus candidate exists, outOfFocusMeanScore equals topOutOfFocusScore. Symmetric to inFocusMeanScore: where inFocusMeanScore characterizes the in-focus pool, outOfFocusMeanScore characterizes the out-of-focus pool. The identity outOfFocusMeanScore <= topOutOfFocusScore always holds. Combined with topOutOfFocusScore and outOfFocusWinnerGap, gives a fuller picture of the non-focus competition: outOfFocusWinnerGap measures how far the winner leads the best out-of-focus candidate, while outOfFocusMeanScore (compared with topOutOfFocusScore) reveals whether that out-of-focus top candidate is an outlier or representative of a uniformly strong non-focus field. ' +
          'explanation also includes outOfFocusBottomScore: number — the lowest relevance score among all out-of-focus candidates (the minimum of the out-of-focus score pool). Present when a focus profile is active, a winner exists, and at least one out-of-focus candidate exists (same conditions as topOutOfFocusScore and outOfFocusMeanScore). Absent when no focus is active, on no_match, or when all candidates are in-focus. When only one out-of-focus candidate exists, outOfFocusBottomScore equals topOutOfFocusScore (and outOfFocusMeanScore). The identity outOfFocusBottomScore <= outOfFocusMeanScore <= topOutOfFocusScore always holds. Together with topOutOfFocusScore and outOfFocusMeanScore, the triple (bottom/mean/top) fully characterises the out-of-focus score distribution without listing individual tool scores: a wide gap between bottom and top signals a spread-out out-of-focus field; a small gap means all out-of-focus tools scored similarly regardless of how they compare to the winner. ' +
          'explanation also includes winnerFocusBoostRatio: number — the fraction of the winning tool\'s total score attributable to the active focus boost (winnerFocusBoost / winnerScore), as a value in [0,1]. Present when a focus profile is active, a winner exists, and winnerScore > 0 (division guard). Absent when no focus is active, on no_match (no winner), or when winnerScore === 0. A value of 0 means the winner was out-of-focus (no boost applied; winnerFocusBoost is 0); a value close to 1 means almost all of the winner\'s score came from the focus boost (the raw relevance was near zero but the boost lifted it to the top). Combined with winnerFocusBoost and winnerScoreBase, gives a complete proportional decomposition of the winner\'s score: winnerScoreBase / winnerScore + winnerFocusBoostRatio === 1 always holds when both are present. ' +
          'explanation also includes topCandidatesScoreVariance: number — the variance of relevance scores across the topCandidates pool (up to 5 candidates), computed as the mean squared deviation from the pool mean: sum of (score - mean)^2 / N. Present when >= 2 topCandidates exist (same conditions as runnerUpScore). Absent on cast:no_match or when there is only one candidate. Always >= 0; a value of 0 would mean all top candidates scored identically. A low variance indicates the top pool is tightly bunched (the winner barely separated from the rest); a high variance indicates the winner is a clear outlier relative to the pack. Complements topCandidatesMeanScore: together they characterize the center and spread of the top pool distribution. ' +
          'explanation also includes runnerUpInFocus: boolean — whether the runner-up tool\'s server or category matches the active focus profile (i.e. the runner-up received an additive boost). Present when a focus profile is active and a runner-up exists (same conditions as focusDecisive and focusMargin). Absent when no focus is active, on no_match, or when fewer than 2 candidates exist. Symmetric to winnerInFocus: while winnerInFocus reports whether the focus profile boosted the winning tool, runnerUpInFocus reports whether it also boosted the closest competing tool. When both winnerInFocus and runnerUpInFocus are true, focus promoted an in-focus winner over an in-focus runner-up (both were boosted, focus was not decisive between them on its own); when winnerInFocus is true and runnerUpInFocus is false, focus lifted an in-focus tool above a non-focus competitor; when both are false, neither of the top two tools was boosted by focus. Lets operators characterize the focus landscape at the top of the candidate pool without inspecting individual tool names or categories. ' +
          'explanation also includes runnerUpFocusBoost: number — the exact additive focus boost applied to the runner-up tool by the active focus profile. Equals focusBoost when runnerUpInFocus is true; 0 when runnerUpInFocus is false (runner-up was out-of-focus). Present when a focus profile is active and a runner-up exists (same conditions as runnerUpInFocus). Absent when no focus is active, on no_match, or when fewer than 2 candidates exist. Symmetric to winnerFocusBoost: together they give the focus-adjusted score decomposition of both the winner and runner-up. The runner-up\'s pre-focus score is runnerUpScore - runnerUpFocusBoost. Combined with focusMargin, lets operators determine whether the runner-up was also boosted: when runnerUpFocusBoost > 0, the runner-up received the same magnitude boost as an in-focus winner (focus promoted the winner over a similarly-boosted competitor); when runnerUpFocusBoost === 0, focus gave the winner an unmatched advantage over the out-of-focus runner-up. ' +
          'explanation also includes runnerUpScoreBase: number — the runner-up tool\'s relevance score before the active focus boost was applied (runnerUpScore - runnerUpFocusBoost). Present when a focus profile is active and a runner-up exists (same conditions as runnerUpFocusBoost). Absent when no focus is active, on no_match, or fewer than 2 candidates. Symmetric to winnerScoreBase: both give the pre-focus raw relevance score of their respective tools. Equal to runnerUpScore when the runner-up is out-of-focus (runnerUpInFocus is false; no boost applied); strictly less than runnerUpScore when the runner-up is in-focus (runnerUpInFocus is true). The identity runnerUpScoreBase + runnerUpFocusBoost = runnerUpScore always holds, giving a complete decomposition of the runner-up score into its raw and focus-boosted components — mirroring the analogous decomposition for the winner. ' +
          'explanation also includes topCandidatesScoreStdDev: number — the standard deviation of relevance scores across the topCandidates pool (sqrt of topCandidatesScoreVariance), expressed in the same units as the scores. Present when >= 2 topCandidates exist (same conditions as topCandidatesScoreVariance and runnerUpScore). Absent on cast:no_match or when there is only one candidate. Always >= 0. The identity topCandidatesScoreStdDev^2 === topCandidatesScoreVariance always holds. Preferred over topCandidatesScoreVariance when comparing spread directly with score values: a stddev of 0.1 means candidates are tightly clustered within 0.1 score units of the mean, matching the scale of winnerScore and runnerUpScore. A large stddev relative to topCandidatesMeanScore indicates a highly dispersed pool dominated by the winner; a small stddev indicates a tightly-packed pool where the winner barely led. ' +
          'explanation also includes topCandidatesScoreSkewness: number — the third standardised moment (skewness) of the relevance scores across the topCandidates pool (up to 5 candidates). Computed as (1/n) * sum((x_i - mean)^3) / stddev^3 where mean and stddev are the pool\'s mean and population standard deviation. Present when >= 2 topCandidates exist and topCandidatesScoreStdDev > 0 (same pool conditions as topCandidatesScoreVariance, plus the non-zero stddev guard — absent when all top candidates score identically). Absent on cast:no_match, single candidate, or all-equal scores. Positive skewness indicates a tail toward higher scores; negative skewness indicates a tail toward lower scores (the most common pattern when the winner clearly leads the rest of the pool). A skewness near 0 indicates a roughly symmetric top pool. For exactly 2 candidates, skewness is always 0 (symmetric by definition). Completes the three-moment statistical characterisation of the top pool alongside topCandidatesScoreVariance (2nd moment — spread) and topCandidatesScoreStdDev (same spread in score units): together they give center (topCandidatesMeanScore), spread (stddev/variance), and shape (skewness). ' +
          'explanation also includes topCandidatesGiniCoefficient: number — the Gini coefficient of relevance scores across the topCandidates pool (up to 5 candidates), measuring score inequality within the top pool. Computed from the scores sorted ascending: G = (2 * sum((i+1) * s[i]) / (n * totalScore)) - (n+1)/n where i is 0-indexed position in the ascending-sorted array, n is the pool size, and totalScore is the sum of all top-candidate scores. Present when >= 2 topCandidates exist and totalTopScore > 0 (same conditions as runnerUpScore). Absent on cast:no_match, single candidate, or when all top-candidate scores are 0. Always in [0, 1): a value of 0 means all top candidates scored identically (perfect equality); a value approaching 1 means score mass is concentrated in a single dominant tool (near-perfect inequality). Unlike topCandidatesScoreVariance (absolute spread in score units) and candidateScoreEntropy (relative concentration across the full pool in bits), topCandidatesGiniCoefficient is a unit-free inequality index bounded to [0,1): it directly quantifies how dominant the winner is relative to the rest of the top pool, independent of the absolute score scale. A high Gini coefficient alongside a low candidateScoreEntropy indicates one tool capturing most relevance mass both within the top pool and across all candidates. ' +
          'explanation also includes scoreDominanceIndex: number — the winning tool\'s share of total score mass across all candidates (winnerScore / totalCandidateScore), expressing how dominant the winner is relative to the entire pool. Present when a winner exists and totalCandidateScore > 0. Absent on cast:no_match or when all candidate scores are 0. Always in (0, 1]: a value close to 1 means the winner captured almost all of the relevance signal (near-monopoly); a value close to 0 means the winner\'s score was small relative to the aggregate (spread-out field). When there is only one candidate, scoreDominanceIndex is always 1. Together with candidateScoreEntropy (which measures spread over the full distribution) and topCandidatesGiniCoefficient (inequality within the top-5 pool), scoreDominanceIndex gives a third lens on concentration: entropy and Gini measure the shape of the distribution; scoreDominanceIndex directly answers "what fraction of relevance mass did the winner claim?" An entropy of 0 corresponds to a scoreDominanceIndex of 1 (one tool has all the mass); a uniform distribution minimises scoreDominanceIndex to 1/candidateCount. ' +
          'explanation also includes candidateGiniCoefficient: number — the Gini coefficient of relevance scores across the entire candidate pool (all scored tools, not just the top-5 topCandidates). Computed from the scores sorted ascending: G = (2 * sum((i+1) * s[i]) / (n * totalScore)) - (n+1)/n where i is 0-indexed position in the ascending-sorted array, n is the total number of candidates, and totalScore is the sum of all candidate scores. Present when >= 2 candidates exist and totalCandidateScore > 0 (same conditions as candidateScoreEntropy). Absent on cast:no_match, single-candidate registries, or when all candidate scores are 0. Always in [0, 1): 0 means all candidates scored equally; approaching 1 means one tool monopolises the relevance signal. Complements topCandidatesGiniCoefficient (which measures inequality only within the top-5 pool): candidateGiniCoefficient captures the full-pool inequality, including tail tools with very low scores that are excluded from the top-5. When all candidates are within the topCandidates pool (candidateCount <= 5), candidateGiniCoefficient equals topCandidatesGiniCoefficient. When the pool is larger, candidateGiniCoefficient >= topCandidatesGiniCoefficient (the long tail of weak candidates increases overall inequality). Together with candidateScoreEntropy (bits) and scoreDominanceIndex (winner\'s fraction), gives a complete multi-metric picture of the relevance distribution\'s concentration. ' +
          'explanation also includes candidateScoreSkewness: number — the third standardised moment (skewness) of relevance scores across the entire candidate pool. Computed as (1/n) * sum((x_i - mean)^3) / stddev^3 where mean and stddev are the population mean and standard deviation over all candidates. Present when >= 2 candidates exist and the full-pool stddev > 0 (same base conditions as candidateGiniCoefficient, plus the non-zero stddev guard). Absent on cast:no_match, single candidate, or when all candidate scores are identical. Positive skewness indicates a long tail toward higher scores (a few outlier tools score much higher than the bulk); negative skewness indicates a long tail toward lower scores (most tools score close to the winner while a few weak candidates pull the mean below the median — the most common pattern in a focused search where the winner clearly dominates). A skewness near 0 indicates a roughly symmetric full-pool distribution. Complements topCandidatesScoreSkewness (which covers only the top-5 pool): candidateScoreSkewness reflects the influence of tail candidates excluded from the topCandidates window. Together with candidateScoreEntropy (information-theoretic spread), candidateGiniCoefficient (inequality), and scoreDominanceIndex (winner\'s fraction), completes the full-pool distribution characterisation suite. ' +
          'explanation also includes candidateScoreVariance: number — the variance of relevance scores across the entire candidate pool, computed as the mean squared deviation from the pool mean: (1/n) * sum((x_i - mean)^2) over all scored candidates. Present when >= 2 candidates exist (same conditions as candidateScoreSpread). Absent on cast:no_match or when there is only one candidate. Always >= 0; a value of 0 means all candidates scored identically. Full-pool parallel to topCandidatesScoreVariance (which covers only the top-5 pool): candidateScoreVariance includes the contribution of low-scoring tail candidates that are excluded from the top-5 window. Measures absolute score spread in squared score units. When candidateCount <= 5, candidateScoreVariance equals topCandidatesScoreVariance (same pool). Use candidateScoreStdDev (sqrt of candidateScoreVariance) to compare spread directly in score units. Together with candidateScoreSkewness (distribution shape) and candidateGiniCoefficient (inequality index), forms the core statistical summary of the full candidate score distribution alongside the existing entropy and dominance metrics. ' +
          'explanation also includes candidateScoreStdDev: number — the standard deviation of relevance scores across the entire candidate pool (sqrt of candidateScoreVariance), expressed in the same units as the scores. Present when >= 2 candidates exist (same conditions as candidateScoreVariance). Absent on cast:no_match or when there is only one candidate. Always >= 0. The identity candidateScoreStdDev^2 === candidateScoreVariance always holds. Full-pool parallel to topCandidatesScoreStdDev (which covers only the top-5 pool): candidateScoreStdDev reflects the spread including tail candidates excluded from the top-5 window. Preferred over candidateScoreVariance when comparing spread directly with score values: a stddev of 0.1 means the full candidate pool is clustered within 0.1 score units of the mean, directly comparable to winnerScore and runnerUpScore. When candidateCount <= 5, candidateScoreStdDev equals topCandidatesScoreStdDev. A large candidateScoreStdDev relative to topCandidatesMeanScore indicates a highly dispersed full pool; a small value indicates tightly-packed scores across all candidates. ' +
          'explanation also includes candidateScoreMean: number — the arithmetic mean of relevance scores across the entire candidate pool (totalCandidateScore / candidateCount). Present when >= 2 candidates exist (same conditions as candidateScoreSpread). Absent on cast:no_match or when there is only one candidate. Full-pool parallel to topCandidatesMeanScore (which covers only the top-5 pool): candidateScoreMean includes the contribution of tail candidates excluded from the top-5 window. Always <= winnerScore (the winner is the maximum). When all candidates score identically, candidateScoreMean equals winnerScore. When candidateCount <= 5, candidateScoreMean equals topCandidatesMeanScore (same pool). The ratio candidateScoreMean / winnerScore is a quick measure of how far below the winner the average candidate sits — a ratio near 1 indicates a tightly-bunched pool; a ratio near 0 indicates the winner is a clear outlier above a weakly-scoring field. Together with candidateScoreStdDev (spread) and candidateScoreSkewness (shape), forms the complete first-three-moment summary of the full candidate distribution. ' +
          'explanation also includes medianCandidateScore: number — the median (50th percentile) of relevance scores across the entire candidate pool. For an odd number of candidates: the middle score in the sorted pool. For an even number: the average of the two middle scores. Present when >= 2 candidates exist (same conditions as candidateScoreMean). Absent on cast:no_match or when there is only one candidate. Always in [lowestCandidateScore, winnerScore]. When all candidates score identically, medianCandidateScore equals winnerScore. Compared to candidateScoreMean: the median is robust to extreme outliers — a single very low-scoring tail candidate pulls candidateScoreMean down but does not shift the median as far. When medianCandidateScore < candidateScoreMean, the distribution is right-skewed (a few high-scoring tools lift the mean above the typical candidate); when medianCandidateScore > candidateScoreMean, it is left-skewed (a few low-scoring outliers pull the mean below the typical candidate). Together with candidateScoreMean and candidateScoreStdDev, gives a complete classical summary of the full-pool score distribution. ' +
          'explanation also includes candidateScoreMeanRatio: number — the ratio of the full-pool mean score to the winner\'s score (candidateScoreMean / winnerScore), in (0, 1]. Present when >= 2 candidates exist and winnerScore > 0. Absent on cast:no_match, single candidate, or when winnerScore is 0. Always in (0, 1]: a value of 1 means all candidates scored identically (candidateScoreMean === winnerScore); a value approaching 0 means the winner scored far above the average candidate (one dominant outlier above a weak field). A ratio near 1 indicates a tightly-bunched pool where no single tool stands out clearly; a ratio near 0 indicates a high-confidence resolution where the winner dominates by a large margin over the typical candidate. Complements scoreDominanceIndex (winner\'s fraction of the total score mass) by expressing the same dominance in mean-normalised terms: scoreDominanceIndex = 1/candidateCount when all candidates score identically (regardless of winnerScore), while candidateScoreMeanRatio = 1 regardless of pool size. The two metrics together give a complete picture of per-tool versus aggregate dominance. ' +
          'explanation also includes candidateScoreCoefficientOfVariation: number — the coefficient of variation (CV) of the full candidate pool, defined as candidateScoreStdDev / candidateScoreMean. A scale-free, unit-free measure of relative dispersion: unlike candidateScoreStdDev (absolute spread in score units), the CV expresses spread as a multiple of the mean. Present when >= 2 candidates exist and candidateScoreMean > 0. Absent on cast:no_match, single candidate, or when all candidates score 0 (candidateScoreMean === 0, would require division by zero). Always >= 0: a value of 0 means all candidates scored identically (no dispersion); a value of 1 means the standard deviation equals the mean (high relative spread); values > 1 indicate very high relative dispersion. When candidateScoreMean is close to 0 (most candidates near zero), CV can be very large even with small absolute differences. Preferred over candidateScoreStdDev when comparing spread across searches with different absolute score levels: two pools with the same CV have the same relative clustering regardless of their absolute scores. Together with candidateScoreMean, candidateScoreStdDev, and candidateScoreSkewness, completes the classical normalised statistical summary of the full-pool score distribution. ' +
          'explanation also includes medianToMeanRatio: number — the ratio of the full-pool median score to the full-pool mean score (medianCandidateScore / candidateScoreMean), a quick indicator of distribution symmetry. Present when >= 2 candidates exist and candidateScoreMean > 0 (same conditions as candidateScoreCoefficientOfVariation). Absent on cast:no_match, single candidate, or when candidateScoreMean is 0. Always > 0. A value of 1 indicates a perfectly symmetric distribution (median equals mean). A value < 1 indicates right-skewed distribution (the mean is pulled above the median by a few high-scoring outliers — uncommon in tool scoring where the winner tends to be the outlier, but possible). A value > 1 indicates left-skewed distribution (the mean is pulled below the median by a few very low-scoring tail candidates, which is the most common pattern: the winner and a few tools score well, while many tail candidates score near zero, depressing the mean below the median). Provides the same information as candidateScoreSkewness sign but in a more interpretable ratio form. Identity: medianToMeanRatio * candidateScoreMean === medianCandidateScore always holds when both are present. ' +
          'explanation also includes winnerToMedianRatio: number — the ratio of the winner\'s score to the full-pool median candidate score (winnerScore / medianCandidateScore). Present when >= 2 candidates exist and medianCandidateScore > 0. Absent on cast:no_match, single candidate, or when medianCandidateScore is 0. Always >= 1: the winner is the maximum of the pool, so it is always >= the median. A value of 1 means the winner scored the same as the median candidate (all scores are identical, or the winner is exactly at the 50th percentile). Large values (e.g. 5–10) indicate the winner scored far above the typical candidate — strong resolution confidence. Complements candidateScoreMeanRatio (mean / winner) by measuring winner dominance relative to the median rather than the mean; the median is more robust to tail candidates, so winnerToMedianRatio is less sensitive to a large number of near-zero stragglers. Identity: winnerToMedianRatio * medianCandidateScore === winnerScore always holds when both are present. ' +
          'explanation also includes winnerScoreZScore: number — the z-score (standard score) of the winner within the full candidate pool: (winnerScore - candidateScoreMean) / candidateScoreStdDev. Measures how many standard deviations the winner sits above the pool mean. Present when >= 2 candidates exist and candidateScoreStdDev > 0. Absent on cast:no_match, single candidate, or when all candidate scores are identical (candidateScoreStdDev === 0, which would require division by zero). Always >= 0: the winner is the maximum of the pool and therefore always >= the mean; with nonzero spread the z-score is non-negative. A z-score of 1 means the winner is exactly 1 standard deviation above the mean; z-scores > 2 indicate the winner is a strong outlier. Useful for comparing winner prominence across searches with different absolute score levels: unlike winnerScore (absolute) or candidateScoreMeanRatio (mean-normalised), the z-score normalises by the spread of the pool. Identity: winnerScoreZScore * candidateScoreStdDev + candidateScoreMean === winnerScore always holds when both are present. ' +
          'explanation also includes runnerUpScoreZScore: number — the z-score (standard score) of the runner-up within the full candidate pool: (runnerUpScore - candidateScoreMean) / candidateScoreStdDev. Present when >= 2 candidates exist and candidateScoreStdDev > 0 (same conditions as winnerScoreZScore). Absent on cast:no_match, single candidate, or when all candidate scores are identical. Unlike winnerScoreZScore (always >= 0), runnerUpScoreZScore can be negative when the runner-up scores below the pool mean — common when the pool has many near-zero tail candidates that pull the mean below the runner-up\'s position, but can also occur when the runner-up is below-average. Always <= winnerScoreZScore (runner-up score <= winner score). The difference winnerScoreZScore - runnerUpScoreZScore = (winnerScore - runnerUpScore) / candidateScoreStdDev expresses the margin between the top two candidates in units of pool spread — a scale-free version of the candidateScoreSpread gap at the top. Identity: runnerUpScoreZScore * candidateScoreStdDev + candidateScoreMean === runnerUpScore always holds when both are present. ' +
          'explanation also includes runnerUpFocusBoostRatio: number — the fraction of the runner-up tool\'s total score attributable to the active focus boost (runnerUpFocusBoost / runnerUpScore), as a value in [0,1]. Present when a focus profile is active, a runner-up exists, and runnerUpScore > 0 (division guard). Absent when no focus is active, on no_match, fewer than 2 candidates, or runnerUpScore === 0. Symmetric to winnerFocusBoostRatio: while winnerFocusBoostRatio gives the focus fraction for the winner, runnerUpFocusBoostRatio gives the same fraction for the runner-up. A value of 0 means the runner-up was out-of-focus (no boost applied; runnerUpFocusBoost is 0); a value close to 1 means almost all of the runner-up\'s score came from the focus boost. Combined with runnerUpFocusBoost and runnerUpScoreBase, gives a complete proportional decomposition of the runner-up score: runnerUpScoreBase / runnerUpScore + runnerUpFocusBoostRatio === 1 always holds when both are present. ' +
          'explanation also includes rawFocusMargin: number — the score gap between the winner and the runner-up computed from their pre-focus base scores (winnerScoreBase - runnerUpScoreBase), stripping the focus boost from both sides. Present when a focus profile is active and a runner-up exists (same conditions as runnerUpScoreBase). Absent when no focus is active, on no_match, or fewer than 2 candidates. Can be negative when the runner-up\'s base score exceeded the winner\'s base score — meaning focus reversed the natural ranking (the winner would have lost without the boost). Compare to focusMargin (winnerScore - runnerUpScore, the gap after focus): if rawFocusMargin < focusMargin, the focus boost widened the gap; if rawFocusMargin > focusMargin, focus narrowed it; if rawFocusMargin < 0 and focusMargin > 0, focus reversed the outcome (focusDecisive is true in this case). The identity rawFocusMargin = focusMargin - (winnerFocusBoost - runnerUpFocusBoost) always holds. ' +
          'explanation also includes rawFocusMarginRatio: number — the rawFocusMargin normalised by the winner\'s pre-focus base score (rawFocusMargin / winnerScoreBase), expressing the unfocused gap as a fraction of the winner\'s organic relevance. Present when a focus profile is active, a runner-up exists, and winnerScoreBase > 0 (same conditions as rawFocusMargin, plus the division guard). Absent when no focus is active, on no_match, fewer than 2 candidates, or winnerScoreBase === 0. Can be negative (same sign as rawFocusMargin) when focus reversed the natural ranking. A value > 1 means the winner led by more than its full base score; a value of 0 means the two tools were tied pre-focus; a value near −1 means the runner-up nearly had twice the base score of the winner. Complements rawFocusMargin (the absolute gap) by normalising it to the winner\'s own scale, making the margin comparable across queries and score magnitudes. ' +
          'explanation also includes focusNetBoostDelta: number — the net differential focus boost the winner received compared to the runner-up (winnerFocusBoost - runnerUpFocusBoost). Present when a focus profile is active and a runner-up exists (same conditions as rawFocusMargin). Absent when no focus is active, on no_match, or fewer than 2 candidates. Possible values: +focusBoost when winner in-focus and runner-up out-of-focus (focus gave winner an unmatched advantage); 0 when both in-focus or both out-of-focus (focus shifted both equally, no net differential); -focusBoost when winner out-of-focus and runner-up in-focus (focus actually helped the runner-up more than the winner). The identity focusMargin = rawFocusMargin + focusNetBoostDelta always holds, triangulating the three margin views: post-focus gap, pre-focus gap, and the net boost differential. ' +
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
      case 'execute': {
        const executeStartMs = Date.now();
        const execResult = await this.handleExecute(args, sessionId);
        const latencyMs = Date.now() - executeStartMs;
        if (!execResult.isError) {
          if (args.dryRun === true) {
            const first = execResult.content[0] as { type?: string; text?: string } | undefined;
            if (first?.type === 'text' && typeof first.text === 'string') {
              try {
                const dr = JSON.parse(first.text) as Record<string, unknown>;
                dr.latencyMs = latencyMs;
                first.text = JSON.stringify(dr);
              } catch { /* ignore malformed JSON */ }
            }
          } else {
            const execSessionId = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : sessionId;
            if (execSessionId && this.coordinator.hasSession(execSessionId)) {
              const patterns = this.coordinator.getToolPatterns(execSessionId, 1000);
              const recentTools = patterns.slice(0, 5).map((p) => p.tool);
              const callCount = patterns.reduce((sum, p) => sum + p.count, 0);
              const activeSessionFocus = this.coordinator.getSessionFocus(execSessionId);
              const sessionContext = { recentTools, callCount, ...(activeSessionFocus ? { activeSessionFocus } : {}) };
              execResult.content.push({ type: 'text', text: JSON.stringify({ latencyMs, sessionContext }) });
            }
          }
        }
        return execResult;
      }
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
    const searchStartMs = Date.now();
    const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
    const serverFilter = typeof args.server === 'string' ? args.server : undefined;
    const categoryFilter = typeof args.category === 'string' ? args.category : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 0;
    const explain = args.explain === true;
    const inFocusOnly = args.inFocusOnly === true;
    const minScore = typeof args.minScore === 'number' && args.minScore > 0 ? args.minScore : 0;
    const effectiveSessionId = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : sessionId;
    const { name: focusName, profile: focus } = this.resolveActiveFocus(args.focus, effectiveSessionId);

    const registry = await this.getRegistry();

    // Session context summary — surfaces recent activity + sticky focus in a single response.
    let sessionContext: { recentTools: string[]; callCount: number; activeSessionFocus?: string } | undefined;
    if (effectiveSessionId) {
      const patterns = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
      const recentTools = patterns.slice(0, 5).map((p) => p.tool);
      const callCount = patterns.reduce((sum, p) => sum + p.count, 0);
      const activeSessionFocus = this.coordinator.getSessionFocus(effectiveSessionId);
      sessionContext = { recentTools, callCount, ...(activeSessionFocus ? { activeSessionFocus } : {}) };
    }

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

      let summaryExplanation: object | null = null;
      if (explain) {
        const inFocusCount = focus ? serverSummary.filter((s) => s.inFocus).length : 0;
        const focusBoost = focus?.boost ?? 0.5;
        const parts: string[] = ['No query provided — returning server summary'];
        parts.push(`${serverSummary.length} server${serverSummary.length === 1 ? '' : 's'}, ${registry.length} total tools`);
        if (focusName && focus) {
          if (inFocusOnly) {
            parts.push(`"${focusName}" focus active — inFocusOnly: showing only ${inFocusCount} in-focus server${inFocusCount === 1 ? '' : 's'}`);
          } else {
            parts.push(`"${focusName}" focus active — ${inFocusCount} of ${serverSummary.length} servers in focus (boost +${focusBoost})`);
          }
        }
        summaryExplanation = {
          method: 'server_summary' as const,
          totalServers: serverSummary.length,
          totalTools: registry.length,
          ...(focusName ? { focus: focusName, inFocusServers: inFocusCount } : {}),
          ...(inFocusOnly && focus ? { inFocusOnly: true } : {}),
          rationale: parts.join('; ') + '.',
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            hint: 'Use query, server, or category to search for specific tools',
            latencyMs: Date.now() - searchStartMs,
            ...(entity?.chittyId ? { entity: entity.chittyId, identityClass: entity.identityClass } : {}),
            ...(focusName ? { focus: focusName } : {}),
            ...(inFocusOnly && focus ? { inFocusOnly: true } : {}),
            ...(sessionContext ? { sessionContext } : {}),
            ...(summaryExplanation ? { explanation: summaryExplanation } : {}),
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

    // minScore hard filter: drop tools with relevance below the threshold.
    // Only meaningful when a query is present (scores are only computed then).
    if (minScore > 0 && relevanceMap.size > 0) {
      // ?? 0 right side is structurally unreachable: relevanceMap is built from `matches`
      // in the same scope — every tool in matches is scored when relevanceMap.size > 0.
      /* c8 ignore next */
      matches = matches.filter((t) => (relevanceMap.get(t.namespacedName) ?? 0) >= minScore);
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
        serverName: t.serverName,
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
      ? buildSearchExplanation(matches, results, relevanceMap, partialFallback, focusName, focus, recentServerIds, minScore, serverFilter, categoryFilter)
      : null;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          matches: results.length,
          total: matches.length,
          latencyMs: Date.now() - searchStartMs,
          ...(offset > 0 ? { offset } : {}),
          ...(partialFallback ? { mode: 'partial' } : {}),
          ...(focusName ? { focus: focusName } : {}),
          ...(inFocusOnly && focus ? { inFocusOnly: true } : {}),
          ...(minScore > 0 ? { minScore } : {}),
          ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
          ...(sessionContext ? { sessionContext } : {}),
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
      let dryRunSessionContext: { recentTools: string[]; callCount: number; activeSessionFocus?: string } | undefined;
      if (effectiveSessionId && this.coordinator.hasSession(effectiveSessionId)) {
        const patterns = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
        const recentTools = patterns.slice(0, 5).map((p) => p.tool);
        const callCount = patterns.reduce((sum, p) => sum + p.count, 0);
        const activeSessionFocus = this.coordinator.getSessionFocus(effectiveSessionId);
        dryRunSessionContext = { recentTools, callCount, ...(activeSessionFocus ? { activeSessionFocus } : {}) };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({
          status: 'dry_run',
          server: serverId,
          tool: name,
          args: toolArgs,
          ...(dryRunSessionContext ? { sessionContext: dryRunSessionContext } : {}),
        }) }],
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
    ledgerDlq: { path: string; entryCount: number; entries: object[] };
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
      ledgerDlq: { path: ledgerStats.dlqPath, entryCount: ledgerStats.dlqEntries, entries: this.coordinator.ledger.dlqReadEntries(50) },
      coordinator: coordinatorSnap,
      servers: statuses,
    };
  }

  private async handleStatus(args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const statusStartMs = Date.now();
    const snapshot = this.getStatusSnapshot();
    const latencyMs = Date.now() - statusStartMs;
    const short = args.short === true;
    if (short) {
      const { servers: _servers, coordinator, ...rest } = snapshot;
      const { sessions: _sessions, ...coordinatorShort } = coordinator;
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...rest, coordinator: coordinatorShort, latencyMs }, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ ...snapshot, latencyMs }, null, 2) }],
    };
  }

  private async handleReload(): Promise<ToolCallResult> {
    if (!this.configPath) {
      return {
        content: [{ type: 'text', text: 'No config path available for reload' }],
        isError: true,
      };
    }

    const reloadStartMs = Date.now();
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
        latencyMs: Date.now() - reloadStartMs,
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

    const castStartMs = Date.now();
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
    let registryMs = 0;
    const [registryResult, promptsResult, resourcesResult] = await Promise.allSettled([
      (async () => { const t = Date.now(); const r = await this.getRegistry(); registryMs = Date.now() - t; return r; })(),
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
    const brainRouteStartMs = Date.now();
    const routed = await this.coordinator.routeIntent(intent, candidates);
    const brainRouteMs = Date.now() - brainRouteStartMs;

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
      let noMatchSessionContext: { recentTools: string[]; callCount: number; activeSessionFocus?: string } | null = null;
      if (effectiveSessionId && this.coordinator.hasSession(effectiveSessionId)) {
        const ctxPat = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
        const sfocus = this.coordinator.getSessionFocus(effectiveSessionId);
        noMatchSessionContext = {
          recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
          callCount: ctxPat.reduce((s, p) => s + p.count, 0),
          ...(sfocus ? { activeSessionFocus: sfocus } : {}),
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'no_match',
            resolvedBy,
            intent,
            latencyMs: Date.now() - castStartMs,
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explain ? { explanation: buildCastExplanation(resolvedBy, undefined, [], focusName, focus, castRoute === 'brain' ? brainRouteMs : undefined) } : {}),
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
            ...(noMatchSessionContext ? { sessionContext: noMatchSessionContext } : {}),
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
    const explanation = explain ? buildCastExplanation(resolvedBy, best, scoredTools, focusName, focus, castRoute === 'brain' ? brainRouteMs : undefined) : null;

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
      let discoveredSessionContext: { recentTools: string[]; callCount: number; activeSessionFocus?: string } | null = null;
      if (effectiveSessionId && this.coordinator.hasSession(effectiveSessionId)) {
        const ctxPat = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
        const sfocus = this.coordinator.getSessionFocus(effectiveSessionId);
        discoveredSessionContext = {
          recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
          callCount: ctxPat.reduce((s, p) => s + p.count, 0),
          ...(sfocus ? { activeSessionFocus: sfocus } : {}),
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'discovered',
            resolvedBy,
            intent,
            latencyMs: Date.now() - castStartMs,
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explanation ? { explanation } : {}),
            hint: 'No executable tools matched, but related prompts/resources found.',
            ...related,
            ...(discoveredSessionContext ? { sessionContext: discoveredSessionContext } : {}),
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
      const chainScoringMs = Date.now() - castStartMs;
      const steps: Array<{ step: number; tool: string; ok: boolean; content?: unknown[]; error?: string }> = [];
      let previousStepOutput: string | null = null;
      const allTexts: string[] = [];
      const chainExecStartMs = Date.now();

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

      const chainExecutionMs = Date.now() - chainExecStartMs;
      const chainSummary = allTexts.length > 0 ? allTexts.join('\n\n') : undefined;

      let chainSessionContext: { recentTools: string[]; callCount: number; activeSessionFocus?: string } | null = null;
      if (effectiveSessionId && this.coordinator.hasSession(effectiveSessionId)) {
        const ctxPat = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
        const sfocus = this.coordinator.getSessionFocus(effectiveSessionId);
        chainSessionContext = {
          recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
          callCount: ctxPat.reduce((s, p) => s + p.count, 0),
          ...(sfocus ? { activeSessionFocus: sfocus } : {}),
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'chain_executed',
            resolvedBy,
            intent,
            latencyMs: Date.now() - castStartMs,
            latencyBreakdown: { scoringMs: chainScoringMs, executionMs: chainExecutionMs, registryMs, ...(castRoute === 'brain' ? { brainMs: brainRouteMs } : {}) },
            // focusName is always truthy here (catalogCombo requires it — see line ~1238)
            /* c8 ignore next */
            ...(focusName ? { focus: focusName } : {}),
            ...(explanation ? { explanation } : {}),
            catalog: { name: catalogCombo.name, chain: catalogCombo.chain, accomplishes: catalogCombo.accomplishes },
            steps,
            ...(chainSummary !== undefined ? { summary: chainSummary } : {}),
            ...(chainSessionContext ? { sessionContext: chainSessionContext } : {}),
            // focusSuggestions is always truthy when catalogCombo is non-null (same catalog lookup)
            /* c8 ignore next */
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
          }, null, 2),
        }],
      };
    }

    // Step 2b: Dry-run mode — return only resolved tool + score + catalog match, no execution, no schema
    if (dryRun) {
      let resolvedSessionContext: { recentTools: string[]; callCount: number; activeSessionFocus?: string } | null = null;
      if (effectiveSessionId && this.coordinator.hasSession(effectiveSessionId)) {
        const ctxPat = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
        const sfocus = this.coordinator.getSessionFocus(effectiveSessionId);
        resolvedSessionContext = {
          recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
          callCount: ctxPat.reduce((s, p) => s + p.count, 0),
          ...(sfocus ? { activeSessionFocus: sfocus } : {}),
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'resolved',
            resolvedBy,
            intent,
            latencyMs: Date.now() - castStartMs,
            ...(focusName ? { focus: focusName } : {}),
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explanation ? { explanation } : {}),
            resolved: { tool: best.namespacedName, score: best.score },
            ...(catalogCombo ? { catalogCombo: { name: catalogCombo.name, chain: catalogCombo.chain, accomplishes: catalogCombo.accomplishes } } : {}),
            ...(resolvedSessionContext ? { sessionContext: resolvedSessionContext } : {}),
          }, null, 2),
        }],
      };
    }

    // Step 2c: Confirm mode — return the plan without executing
    if (confirm) {
      let planSessionContext: { recentTools: string[]; callCount: number; activeSessionFocus?: string } | null = null;
      if (effectiveSessionId && this.coordinator.hasSession(effectiveSessionId)) {
        const ctxPat = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
        const sfocus = this.coordinator.getSessionFocus(effectiveSessionId);
        planSessionContext = {
          recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
          callCount: ctxPat.reduce((s, p) => s + p.count, 0),
          ...(sfocus ? { activeSessionFocus: sfocus } : {}),
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'plan',
            resolvedBy,
            intent,
            latencyMs: Date.now() - castStartMs,
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
            ...(planSessionContext ? { sessionContext: planSessionContext } : {}),
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
            args: toolArgs,
            hint: 'Call cast again without confirm to execute, or use ch1tty/execute directly.',
          }, null, 2),
        }],
      };
    }

    // Step 3: Execute (Ch1tty executing through itself)
    const execScoringMs = Date.now() - castStartMs;
    const execStartMs = Date.now();
    const result = await this.handleExecute(
      { tool: best.namespacedName, args: toolArgs, ...(castTimeoutMs !== undefined ? { timeout: castTimeoutMs } : {}) },
      effectiveSessionId,
    );
    const executionMs = Date.now() - execStartMs;

    let castSessionContext: { recentTools: string[]; callCount: number; activeSessionFocus?: string } | null = null;
    if (!result.isError && effectiveSessionId && this.coordinator.hasSession(effectiveSessionId)) {
      const ctxPat = this.coordinator.getToolPatterns(effectiveSessionId, 1000);
      const sfocus = this.coordinator.getSessionFocus(effectiveSessionId);
      castSessionContext = {
        recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
        callCount: ctxPat.reduce((s, p) => s + p.count, 0),
        ...(sfocus ? { activeSessionFocus: sfocus } : {}),
      };
    }

    // Return cast metadata + related context + raw tool output
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            cast: 'executed',
            resolvedBy,
            intent,
            latencyMs: Date.now() - castStartMs,
            latencyBreakdown: { scoringMs: execScoringMs, executionMs, registryMs, ...(castRoute === 'brain' ? { brainMs: brainRouteMs } : {}) },
            ...(focusName ? { focus: focusName } : {}),
            ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
            ...(explanation ? { explanation } : {}),
            resolved: best.namespacedName,
            score: best.score,
            ...(catalogCombo ? { resolvedFromCatalog: { name: catalogCombo.name, chain: catalogCombo.chain, accomplishes: catalogCombo.accomplishes } } : {}),
            ...(chainContinuation ? { chainContinuation } : {}),
            ...(alternatives.length > 0 ? { alternatives } : {}),
            ...related,
            ...(castSessionContext ? { sessionContext: castSessionContext } : {}),
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
    this.coordinator.close();
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
  brainMs?: number,
): object {
  const topCandidates = scoredTools.slice(0, 5).map((t) => ({
    tool: t.namespacedName,
    score: t.score,
    ...(focus ? { inFocus: isInFocus(focus, t) } : {}),
  }));
  const winnerInFocus = best && focus ? isInFocus(focus, best) : false;
  const focusBoost = focus?.boost ?? 0.5;

  // Pre-focus sorted list: scores with focus boost stripped, descending. Shared by focusRank + unfocusedWinner.
  const preFocusSorted: { n: string; s: number }[] | undefined =
    focusName && best !== undefined
      ? scoredTools
          .map((t) => ({ n: t.namespacedName, s: t.score - (focus && isInFocus(focus, t) ? focusBoost : 0) }))
          .sort((a, b) => b.s - a.s)
      : undefined;

  // 1-based rank of the winner in the pre-focus scoring order.
  const focusRank: number | undefined =
    preFocusSorted !== undefined ? preFocusSorted.findIndex((t) => t.n === best!.namespacedName) + 1 : undefined;

  // Tool that would have won without the focus boost; absent when same as winner (focus didn't change top spot).
  const unfocusedWinner: string | undefined =
    preFocusSorted !== undefined && preFocusSorted.length > 0 && preFocusSorted[0].n !== best!.namespacedName
      ? preFocusSorted[0].n
      : undefined;

  // Highest score among out-of-focus candidates; absent when no focus, no winner, or all candidates are in-focus.
  const topOutOfFocusScore: number | undefined =
    focusName && focus && best !== undefined
      ? (() => {
          const scores = scoredTools.filter((t) => !isInFocus(focus, t)).map((t) => t.score);
          return scores.length > 0 ? Math.max(...scores) : undefined;
        })()
      : undefined;

  // Scores of in-focus candidates; shared by inFocusTopScore, inFocusMeanScore, and inFocusBottomScore.
  const inFocusScores: number[] | undefined =
    focusName && focus && best !== undefined
      ? scoredTools.filter((t) => isInFocus(focus, t)).map((t) => t.score)
      : undefined;

  // Highest score among in-focus candidates; absent when no focus, no winner, or all candidates are out-of-focus.
  const inFocusTopScore: number | undefined =
    inFocusScores !== undefined && inFocusScores.length > 0
      ? Math.max(...inFocusScores)
      : undefined;

  // Mean score of in-focus candidates; absent when no focus, no winner, or all candidates are out-of-focus.
  const inFocusMeanScore: number | undefined =
    inFocusScores !== undefined && inFocusScores.length > 0
      ? inFocusScores.reduce((s, v) => s + v, 0) / inFocusScores.length
      : undefined;

  // Lowest score among in-focus candidates; absent when no focus, no winner, or all candidates are out-of-focus.
  const inFocusBottomScore: number | undefined =
    inFocusScores !== undefined && inFocusScores.length > 0
      ? Math.min(...inFocusScores)
      : undefined;

  // Scores of out-of-focus candidates; shared by topOutOfFocusScore, outOfFocusMeanScore, and outOfFocusBottomScore.
  const outOfFocusScores: number[] | undefined =
    focusName && focus && best !== undefined
      ? scoredTools.filter((t) => !isInFocus(focus, t)).map((t) => t.score)
      : undefined;

  // Mean score of out-of-focus candidates; absent when no focus, no winner, or all candidates are in-focus.
  const outOfFocusMeanScore: number | undefined =
    outOfFocusScores !== undefined && outOfFocusScores.length > 0
      ? outOfFocusScores.reduce((s, v) => s + v, 0) / outOfFocusScores.length
      : undefined;

  // Lowest score among out-of-focus candidates; absent when no focus, no winner, or all candidates are in-focus.
  const outOfFocusBottomScore: number | undefined =
    outOfFocusScores !== undefined && outOfFocusScores.length > 0
      ? Math.min(...outOfFocusScores)
      : undefined;

  // Shannon entropy of the normalised candidate score distribution; absent when < 2 candidates or all scores are 0.
  const candidateScoreEntropyTotal = scoredTools.reduce((s, t) => s + t.score, 0);
  const candidateScoreEntropy: number | undefined =
    scoredTools.length > 1 && candidateScoreEntropyTotal > 0
      ? -scoredTools.reduce((s, t) => {
          const p = t.score / candidateScoreEntropyTotal;
          return s + (p > 0 ? p * Math.log2(p) : 0);
        }, 0)
      : undefined;

  // Gini coefficient of topCandidates score distribution; absent when < 2 topCandidates or all scores are 0.
  const topCandidatesGiniCoefficient: number | undefined = (() => {
    if (topCandidates.length < 2) return undefined;
    const sorted = [...topCandidates].sort((a, b) => a.score - b.score).map((c) => c.score);
    const total = sorted.reduce((s, v) => s + v, 0);
    if (total === 0) return undefined;
    const n = sorted.length;
    return (2 * sorted.reduce((s, v, i) => s + (i + 1) * v, 0) / (n * total)) - (n + 1) / n;
  })();

  // Gini coefficient of the full candidate pool; absent when < 2 candidates or all scores are 0.
  const candidateGiniCoefficient: number | undefined = (() => {
    if (scoredTools.length < 2) return undefined;
    if (candidateScoreEntropyTotal === 0) return undefined;
    const sorted = [...scoredTools].sort((a, b) => a.score - b.score).map((t) => t.score);
    const n = sorted.length;
    return (2 * sorted.reduce((s, v, i) => s + (i + 1) * v, 0) / (n * candidateScoreEntropyTotal)) - (n + 1) / n;
  })();

  // Third standardised moment (skewness) of topCandidates scores; absent when < 2 candidates or stddev === 0.
  const topCandidatesScoreSkewness: number | undefined = (() => {
    if (topCandidates.length < 2) return undefined;
    const n = topCandidates.length;
    const mean = topCandidates.reduce((s, c) => s + c.score, 0) / n;
    const variance = topCandidates.reduce((s, c) => s + (c.score - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return undefined;
    return topCandidates.reduce((s, c) => s + ((c.score - mean) / stddev) ** 3, 0) / n;
  })();

  // Third standardised moment (skewness) of the full candidate pool; absent when < 2 candidates or stddev === 0.
  const candidateScoreSkewness: number | undefined = (() => {
    if (scoredTools.length < 2) return undefined;
    const n = scoredTools.length;
    const mean = candidateScoreEntropyTotal / n;
    const variance = scoredTools.reduce((s, t) => s + (t.score - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return undefined;
    return scoredTools.reduce((s, t) => s + ((t.score - mean) / stddev) ** 3, 0) / n;
  })();

  // Variance of the full candidate pool; absent when < 2 candidates.
  const candidateScoreVariance: number | undefined = (() => {
    if (scoredTools.length < 2) return undefined;
    const n = scoredTools.length;
    const mean = candidateScoreEntropyTotal / n;
    return scoredTools.reduce((s, t) => s + (t.score - mean) ** 2, 0) / n;
  })();

  // Standard deviation of the full candidate pool; absent when < 2 candidates.
  const candidateScoreStdDev: number | undefined =
    candidateScoreVariance !== undefined ? Math.sqrt(candidateScoreVariance) : undefined;

  // Median of the full candidate pool (scoredTools is already sorted descending); absent when < 2 candidates.
  const medianCandidateScore: number | undefined = (() => {
    if (scoredTools.length < 2) return undefined;
    const n = scoredTools.length;
    const mid = Math.floor(n / 2);
    return n % 2 === 1
      ? scoredTools[mid].score
      : (scoredTools[mid - 1].score + scoredTools[mid].score) / 2;
  })();

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
    ...(brainMs !== undefined ? { brainMs } : {}),
    candidateCount: scoredTools.length,
    ...(best !== undefined ? { winnerScore: best.score, winnerServer: best.namespacedName.split('/')[0], winnerCategory: best.category, topCandidatesMeanScore: topCandidates.reduce((s, c) => s + c.score, 0) / topCandidates.length, ...(candidateScoreEntropyTotal > 0 ? { scoreDominanceIndex: best.score / candidateScoreEntropyTotal } : {}) } : {}),
    ...(topCandidates.length > 1 ? { runnerUpScore: topCandidates[1].score, runnerUpTool: topCandidates[1].tool, runnerUpServer: topCandidates[1].tool.split('/')[0], runnerUpCategory: scoredTools[1].category, candidateScoreSpread: scoredTools[0].score - scoredTools[scoredTools.length - 1].score, lowestCandidateScore: scoredTools[scoredTools.length - 1].score, ...(candidateScoreEntropy !== undefined ? { candidateScoreEntropy } : {}), ...(candidateGiniCoefficient !== undefined ? { candidateGiniCoefficient } : {}), ...(candidateScoreSkewness !== undefined ? { candidateScoreSkewness } : {}), ...(candidateScoreVariance !== undefined ? { candidateScoreVariance } : {}), ...(candidateScoreStdDev !== undefined ? { candidateScoreStdDev } : {}), candidateScoreMean: candidateScoreEntropyTotal / scoredTools.length, ...(medianCandidateScore !== undefined ? { medianCandidateScore } : {}), ...(scoredTools[0].score > 0 ? { candidateScoreMeanRatio: (candidateScoreEntropyTotal / scoredTools.length) / scoredTools[0].score } : {}), ...(candidateScoreStdDev !== undefined && candidateScoreEntropyTotal > 0 ? { candidateScoreCoefficientOfVariation: candidateScoreStdDev / (candidateScoreEntropyTotal / scoredTools.length) } : {}), ...(medianCandidateScore !== undefined && candidateScoreEntropyTotal > 0 ? { medianToMeanRatio: medianCandidateScore / (candidateScoreEntropyTotal / scoredTools.length) } : {}), ...(medianCandidateScore !== undefined && medianCandidateScore > 0 ? { winnerToMedianRatio: scoredTools[0].score / medianCandidateScore } : {}), ...(candidateScoreStdDev !== undefined && candidateScoreStdDev > 0 ? { winnerScoreZScore: (scoredTools[0].score - candidateScoreEntropyTotal / scoredTools.length) / candidateScoreStdDev } : {}), ...(candidateScoreStdDev !== undefined && candidateScoreStdDev > 0 ? { runnerUpScoreZScore: (topCandidates[1].score - candidateScoreEntropyTotal / scoredTools.length) / candidateScoreStdDev } : {}), ...(topCandidates[1].score > 0 ? { winnerScoreRatio: topCandidates[0].score / topCandidates[1].score } : {}), topCandidatesScoreVariance: (() => { const mean = topCandidates.reduce((s, c) => s + c.score, 0) / topCandidates.length; return topCandidates.reduce((s, c) => s + (c.score - mean) ** 2, 0) / topCandidates.length; })(), topCandidatesScoreStdDev: (() => { const mean = topCandidates.reduce((s, c) => s + c.score, 0) / topCandidates.length; return Math.sqrt(topCandidates.reduce((s, c) => s + (c.score - mean) ** 2, 0) / topCandidates.length); })(), ...(topCandidatesScoreSkewness !== undefined ? { topCandidatesScoreSkewness } : {}), ...(topCandidatesGiniCoefficient !== undefined ? { topCandidatesGiniCoefficient } : {}) } : {}),
    ...(focusName && focus ? {
      focus: focusName,
      focusBoost,
      winnerInFocus,
      ...(best !== undefined ? { winnerFocusBoost: winnerInFocus ? focusBoost : 0, winnerScoreBase: best.score - (winnerInFocus ? focusBoost : 0), candidatesInFocusCount: scoredTools.filter((t) => isInFocus(focus, t)).length, outOfFocusCandidatesCount: scoredTools.filter((t) => !isInFocus(focus, t)).length, ...(scoredTools.length > 0 ? { inFocusFraction: scoredTools.filter((t) => isInFocus(focus, t)).length / scoredTools.length } : {}), ...(focusRank !== undefined ? { focusRank, focusRankDelta: focusRank - 1, focusRankPercentile: focusRank / scoredTools.length } : {}), ...(unfocusedWinner !== undefined ? { unfocusedWinner } : {}), ...(topOutOfFocusScore !== undefined ? { topOutOfFocusScore, outOfFocusWinnerGap: best!.score - topOutOfFocusScore } : {}), ...(outOfFocusMeanScore !== undefined ? { outOfFocusMeanScore } : {}), ...(outOfFocusBottomScore !== undefined ? { outOfFocusBottomScore } : {}), ...(inFocusTopScore !== undefined ? { inFocusTopScore } : {}), ...(inFocusMeanScore !== undefined ? { inFocusMeanScore } : {}), ...(inFocusBottomScore !== undefined ? { inFocusBottomScore } : {}), ...(!winnerInFocus && inFocusTopScore !== undefined ? { inFocusWinnerGap: best!.score - inFocusTopScore } : {}), ...(best.score > 0 ? { winnerFocusBoostRatio: (winnerInFocus ? focusBoost : 0) / best.score } : {}) } : {}),
      ...(best !== undefined && topCandidates.length > 1 ? {
        focusDecisive: (best.score - (winnerInFocus ? focusBoost : 0)) < topCandidates[1].score,
        focusMargin: best.score - topCandidates[1].score,
        ...(best.score > 0 ? { focusMarginRatio: (best.score - topCandidates[1].score) / best.score } : {}),
        runnerUpInFocus: isInFocus(focus!, scoredTools[1]),
        runnerUpFocusBoost: isInFocus(focus!, scoredTools[1]) ? focusBoost : 0,
        runnerUpScoreBase: topCandidates[1].score - (isInFocus(focus!, scoredTools[1]) ? focusBoost : 0),
        rawFocusMargin: (best.score - (winnerInFocus ? focusBoost : 0)) - (topCandidates[1].score - (isInFocus(focus!, scoredTools[1]) ? focusBoost : 0)),
        ...((best.score - (winnerInFocus ? focusBoost : 0)) > 0 ? { rawFocusMarginRatio: ((best.score - (winnerInFocus ? focusBoost : 0)) - (topCandidates[1].score - (isInFocus(focus!, scoredTools[1]) ? focusBoost : 0))) / (best.score - (winnerInFocus ? focusBoost : 0)) } : {}),
        focusNetBoostDelta: (winnerInFocus ? focusBoost : 0) - (isInFocus(focus!, scoredTools[1]) ? focusBoost : 0),
        ...(topCandidates[1].score > 0 ? { runnerUpFocusBoostRatio: (isInFocus(focus!, scoredTools[1]) ? focusBoost : 0) / topCandidates[1].score } : {}),
        ...((best.score - topCandidates[1].score) !== 0
          ? {
              focusBias: (winnerInFocus ? focusBoost : 0) / (best.score - topCandidates[1].score),
              focusConfidence: Math.min(1, (winnerInFocus ? focusBoost : 0) / (best.score - topCandidates[1].score)),
            }
          : {}),
      } : {}),
    } : {}),
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
  minScore: number = 0,
  serverFilter?: string,
  categoryFilter?: string,
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
  const filterContext = (serverFilter || categoryFilter)
    ? { ...(serverFilter ? { server: serverFilter } : {}), ...(categoryFilter ? { category: categoryFilter } : {}) }
    : undefined;

  const parts: string[] = [];
  parts.push(`Keyword search (${matchMode === 'partial' ? 'OR/partial fallback — no tool matched all terms' : 'AND mode'})`);
  if (filterContext) {
    const filterParts: string[] = [];
    if (serverFilter) filterParts.push(`server="${serverFilter}"`);
    if (categoryFilter) filterParts.push(`category="${categoryFilter}"`);
    parts.push(`pre-filtered by ${filterParts.join(' + ')}`);
  }
  if (topCandidates.length > 0) {
    const top = topCandidates[0];
    parts.push(`top result: "${top.tool}" (relevance: ${top.relevanceScore.toFixed(2)})`);
  }
  if (focusName) {
    parts.push(`"${focusName}" focus active — ${inFocusCount} of ${Math.min(topResults.length, 5)} top results in focus (boost +${focusBoost})`);
  }
  if (minScore > 0) {
    parts.push(`minScore: ${minScore} applied — tools below this relevance threshold were excluded`);
  }
  if (allMatches.length > topResults.length) {
    parts.push(`showing ${topResults.length} of ${allMatches.length} matches`);
  }
  const rationale = parts.join('; ') + '.';

  return {
    method: 'keyword' as const,
    matchMode,
    ...(filterContext ? { filterContext } : {}),
    ...(focusName ? { focus: focusName, focusBoost } : {}),
    ...(minScore > 0 ? { minScore } : {}),
    topCandidates,
    rationale,
  };
}
