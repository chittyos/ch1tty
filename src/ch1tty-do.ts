// Ch1ttyDO — per-session Durable Object. Ports the aggregator's slim-MCP core
// (registry build, search, execute, cast, status, reload, scoreIntent,
// resources, prompts) faithfully from src/aggregator.ts, and adds the DO-native
// pieces: code mode (`code`), provisioning (`provision`), the evaluator, and
// alarm()-driven ledger/eval flushing into DO SQLite.
//
// One DO instance per MCP session (addressed by idFromName(sessionId) in
// worker.ts) — never one mega-DO. Each instance owns its session, coordinator,
// ledger, evaluator, circuit-breaker (inside RemoteProxy), and focus state.
import { DurableObject } from 'cloudflare:workers';
import type {
  Env, ServerConfig, ServerStatus, ServerCategory, ServerAccess,
  ToolCallResult, ContentItem,
} from './types.js';
import { RemoteProxy } from './remote-proxy.js';
import { SessionTracker } from './session.js';
import { SessionCoordinator } from './coordinator.js';
import { LedgerClient, LEDGER_FLUSH_INTERVAL_MS } from './ledger.js';
import { Evaluator } from './evaluator.js';
import { WorkersAiBrain, type ToolCandidate } from './workers-ai-brain.js';
import { validateServersConfig } from './config.js';
import { validateFocusProfiles, resolveFocus, isInFocus, applyFocusBias, type FocusProfile, type FocusProfiles } from './focus.js';
import { getSuggestionsForFocus, type FocusSuggestions } from './suggestions.js';
import { REMOTE_SERVERS, FOCUS_PROFILES_RAW } from './config-data.js';
import { CodemodeBridge } from './codemode-bridge.js';
import { VERSION } from './utils.js';
import { log } from './logger.js';

const SEPARATOR = '/';
const META_SERVER_ID = 'ch1tty';
const META_TOOL_VERBS: ReadonlySet<string> = new Set([
  'search', 'execute', 'status', 'reload', 'cast', 'code', 'provision',
]);
const REGISTRY_TTL = 5 * 60 * 1000;
/** Idle window after which alarm() runs onSessionEnd for a session. */
const SESSION_IDLE_MS = 15 * 60 * 1000;

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

export class Ch1ttyDO extends DurableObject<Env> {
  private proxy: RemoteProxy;
  private sessions = new SessionTracker();
  private coordinator: SessionCoordinator;
  private ledger: LedgerClient;
  private evaluator: Evaluator;
  private brain: WorkersAiBrain;
  private codemode: CodemodeBridge;

  private configs: ServerConfig[];
  private focusProfiles: FocusProfiles;
  private suggestionsCatalog: Record<string, FocusSuggestions> = {};
  private startedAt = Date.now();

  private registry: NamespacedTool[] = [];
  private registryExpiresAt = 0;
  private registryRefreshing: Promise<void> | null = null;
  private indexed = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    log.setLevel(typeof env.CH1TTY_LOG_LEVEL === 'string' ? env.CH1TTY_LOG_LEVEL : undefined);

    const sql = ctx.storage.sql;
    this.ledger = new LedgerClient(sql);
    this.evaluator = new Evaluator(sql);

    this.brain = new WorkersAiBrain(env.AI, env.VECTORIZE);
    this.coordinator = new SessionCoordinator(this.ledger, this.brain);

    this.proxy = new RemoteProxy(env);
    this.configs = validateServersConfig({ servers: REMOTE_SERVERS }).servers;
    this.focusProfiles = validateFocusProfiles(FOCUS_PROFILES_RAW);
    this.codemode = new CodemodeBridge(env.LOADER);

    this.rebuildBackends();
  }

  // ── DO entrypoint (worker.ts forwards MCP JSON-RPC here) ─────

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.endsWith('/status')) {
      return Response.json(this.getStatusSnapshot());
    }
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
    }

    const sessionId = req.headers.get('mcp-session-id') ?? `do-${crypto.randomUUID().slice(0, 8)}`;
    // SessionTracker.getOrCreate is idempotent. Coordinator session start is
    // started exactly once (in the initialize handler) so per-request calls do
    // not wipe affinity/patterns or re-stage the entity — see handleJsonRpc.
    this.sessions.getOrCreate(sessionId, 'http');
    // Ensure the alarm is scheduled so buffered events flush + idle sessions close.
    await this.ensureAlarm();

    let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      body = await req.json();
    } catch {
      return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    const response = await this.handleJsonRpc(body, sessionId);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'mcp-session-id': sessionId };
    return new Response(JSON.stringify(response), { headers });
  }

  /** Minimal MCP JSON-RPC handler (initialize / tools/list / tools/call / resources / prompts). */
  private async handleJsonRpc(
    body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> },
    sessionId: string,
  ): Promise<Record<string, unknown>> {
    const id = body.id ?? null;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

    switch (body.method) {
      case 'initialize':
        // Start the coordinator session exactly once per session (begins entity
        // staging + emits session_start). hasSession guards re-initialize.
        if (!this.coordinator.hasSession(sessionId)) {
          void this.coordinator.onSessionStart(sessionId, 'http');
        }
        return ok({
          protocolVersion: '2025-06-18',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'ch1tty', version: VERSION },
        });
      case 'notifications/initialized':
        return ok({});
      case 'tools/list':
        return ok(await this.listAllTools());
      case 'tools/call': {
        // Lazily start the session for clients that skip initialize. hasSession
        // makes this a no-op once started, so affinity/patterns still accumulate.
        if (!this.coordinator.hasSession(sessionId)) {
          void this.coordinator.onSessionStart(sessionId, 'http');
        }
        const name = String(body.params?.name ?? '');
        const args = (body.params?.arguments && typeof body.params.arguments === 'object')
          ? (body.params.arguments as Record<string, unknown>) : {};
        return ok(await this.callTool(name, args, sessionId));
      }
      case 'resources/list':
        return ok(await this.listAllResources());
      case 'resources/templates/list':
        return ok(await this.listAllResourceTemplates());
      case 'resources/read':
        return ok(await this.readResource(String(body.params?.uri ?? '')));
      case 'prompts/list':
        return ok(await this.listAllPrompts());
      case 'prompts/get':
        return ok(await this.getPrompt(String(body.params?.name ?? ''), body.params?.arguments as Record<string, string> | undefined));
      default:
        return err(-32601, `Method not found: ${body.method}`);
    }
  }

  // ── Backends ────────────────────────────────────────────────

  private rebuildBackends(): void {
    // No ChildManager — a Worker cannot spawn stdio children. RemoteProxy only.
    for (const config of this.activeConfigs()) {
      this.proxy.registerServer(config);
    }
    this.registry = [];
    this.registryExpiresAt = 0;

    const ecosystemConfig = this.activeConfigs().find((c) => c.type === 'remote' && c.category === 'ecosystem');
    if (ecosystemConfig) {
      this.coordinator.bindEcosystem(this.proxy, ecosystemConfig.id);
    }
  }

  private activeConfigs(): ServerConfig[] {
    return this.configs.filter((c) => c.enabled !== false);
  }

  // ── Registry ────────────────────────────────────────────────

  private async refreshRegistry(): Promise<void> {
    if (this.registryRefreshing) return this.registryRefreshing;
    this.registryRefreshing = (async () => {
      const toolPromises = this.activeConfigs().map(async (config) => {
        try {
          const tools = await this.proxy.listTools(config.id);
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
      this.registry = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      this.registryExpiresAt = Date.now() + REGISTRY_TTL;

      // Upsert tool vectors into Vectorize (no-op without the binding).
      const candidates: ToolCandidate[] = this.registry.map((t) => ({
        namespacedName: t.namespacedName,
        description: t.description,
        category: t.category,
        serverName: t.serverName,
      }));
      this.brain.indexCandidates(candidates).then((n) => {
        if (n > 0) { this.indexed = true; log.info(`Indexed ${n} tool vectors into Vectorize`); }
      }).catch((e) => log.warn(`Vectorize index failed: ${e}`));
    })();
    try {
      await this.registryRefreshing;
    } finally {
      this.registryRefreshing = null;
    }
  }

  private async getRegistry(): Promise<NamespacedTool[]> {
    if (Date.now() >= this.registryExpiresAt) await this.refreshRegistry();
    return this.registry;
  }

  // ── Meta-tools ──────────────────────────────────────────────

  private metaTools() {
    const remoteIds = this.activeConfigs().filter((c) => c.type === 'remote').map((c) => c.id);
    return [
      {
        name: `${META_SERVER_ID}${SEPARATOR}search`,
        description: 'Search the tool registry. Returns matching tool names, descriptions, and input schemas. Use before execute.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search keywords matched against tool names and descriptions' },
            server: { type: 'string', description: 'Filter by server id (e.g. "neon", "chittyos")' },
            category: { type: 'string', description: 'Filter by category (ecosystem, code, search, reasoning, desktop, documents, communication)' },
            focus: { type: 'string', description: 'Focus profile to bias results toward. A soft lens — out-of-focus tools still appear. Use "none" to disable.' },
            limit: { type: 'number', description: 'Max results to return (default 20)' },
          },
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}execute`,
        description: 'Execute a tool by its namespaced name (serverId/toolName). Use search to discover available tools first.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            tool: { type: 'string', description: 'Namespaced tool name from search results (e.g. "neon/list_projects")' },
            args: { type: 'object', description: 'Arguments to pass to the tool' },
          },
          required: ['tool'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}code`,
        description:
          'Run model-written TypeScript in an isolated sandbox where each remote upstream is a typed namespace. ' +
          'Compose multiple upstream calls in one pass instead of round-tripping execute. ' +
          CodemodeBridge.describeNamespaces(remoteIds),
        inputSchema: {
          type: 'object' as const,
          properties: {
            code: { type: 'string', description: 'Async function body. Return the final value. Call upstream namespaces (e.g. await neon.execute("run_sql", {...})).' },
          },
          required: ['code'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}cast`,
        description:
          'Describe what you want done in natural language. Ch1tty searches its full surface — tools, prompts, and resources — ' +
          'resolves intent, and executes the best tool match.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            intent: { type: 'string', description: 'Natural language description of what you want accomplished' },
            args: { type: 'object', description: 'Arguments to pass to the resolved tool (if known)' },
            confirm: { type: 'boolean', description: 'If true, return the execution plan without running it (default false)' },
            focus: { type: 'string', description: 'Focus profile to bias resolution toward. Use "none" to disable.' },
          },
          required: ['intent'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}provision`,
        description:
          'Provision a persistent agent for an intent and bind it to an entity ("attach a system to a thing"). ' +
          'Forks an Agent DO via the orchestrator (provision_fork) and binds it (provision_bind).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            intent: { type: 'string', description: 'What the provisioned agent should accomplish' },
            entityId: { type: 'string', description: 'ChittyID of the entity to attach the agent to' },
          },
          required: ['intent', 'entityId'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}status`,
        description: 'Gateway status — connected servers, tool counts, cache ages, brain/ledger health',
        inputSchema: { type: 'object' as const },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}reload`,
        description: 'Rebuild the backend registry from the bundled config',
        inputSchema: { type: 'object' as const },
      },
    ];
  }

  private async handleMetaTool(toolName: string, args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const started = Date.now();
    let result: ToolCallResult;
    switch (toolName) {
      case 'search': result = await this.handleSearch(args, sessionId); break;
      case 'execute': result = await this.handleExecute(args, sessionId); break;
      case 'code': result = await this.handleCode(args, sessionId); break;
      case 'cast': result = await this.handleCast(args, sessionId); break;
      case 'provision': result = await this.handleProvision(args, sessionId); break;
      case 'status': result = await this.handleStatus(); break;
      case 'reload': result = await this.handleReload(); break;
      default:
        result = { content: [{ type: 'text', text: `Unknown tool: ch1tty/${toolName}` }], isError: true };
    }
    this.evaluator.record({
      ts: started, route: toolName, latency_ms: Date.now() - started,
      ok: !result.isError,
    });
    return result;
  }

  // ── Search (ported from aggregator.handleSearch) ────────────

  private resolveActiveFocus(perCall: unknown): { name?: string; profile?: FocusProfile } {
    let name: string | undefined;
    if (typeof perCall === 'string') {
      const trimmed = perCall.trim();
      name = trimmed === '' || trimmed.toLowerCase() === 'none' ? undefined : trimmed;
    }
    return { name, profile: resolveFocus(this.focusProfiles, name) };
  }

  private async handleSearch(args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
    const serverFilter = typeof args.server === 'string' ? args.server : undefined;
    const categoryFilter = typeof args.category === 'string' ? args.category : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const { name: focusName, profile: focus } = this.resolveActiveFocus(args.focus);

    const registry = await this.getRegistry();

    const recentServerIds = new Set<string>();
    if (sessionId) {
      const affinity = this.coordinator.getServerAffinity(sessionId);
      for (const serverId of affinity.keys()) recentServerIds.add(serverId);
      if (recentServerIds.size === 0) {
        for (const tool of this.sessions.getRecentTools(sessionId)) {
          const sep = tool.indexOf(SEPARATOR);
          if (sep > 0) recentServerIds.add(tool.slice(0, sep));
        }
      }
    }

    let matches = registry;
    if (serverFilter) matches = matches.filter((t) => t.serverId === serverFilter);
    if (categoryFilter) matches = matches.filter((t) => t.category === categoryFilter);

    let partialFallback = false;
    if (query) {
      const queryTerms = query.split(/\s+/).filter((t) => t.length > 0);
      const andMatches = matches.filter((t) => {
        const haystack = `${t.namespacedName} ${t.description} ${t.serverName} ${t.category}`.toLowerCase();
        return queryTerms.every((term) => haystack.includes(term));
      });
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

    if (!query && !serverFilter && !categoryFilter) {
      let serverSummary = this.activeConfigs().map((c) => {
        const count = registry.filter((t) => t.serverId === c.id).length;
        const inFocus = focus ? isInFocus(focus, { serverId: c.id, category: c.category }) : false;
        return { server: c.id, name: c.name, category: c.category, tools: count, ...(focus ? { inFocus } : {}) };
      });
      if (focus) serverSummary = [...serverSummary].sort((a, b) => Number(b.inFocus) - Number(a.inFocus));
      const entity = sessionId ? this.coordinator.getEntityContext(sessionId) : undefined;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            hint: 'Use query, server, or category to search for specific tools',
            ...(entity?.chittyId ? { entity: entity.chittyId, identityClass: entity.identityClass } : {}),
            ...(focusName ? { focus: focusName } : {}),
            servers: serverSummary,
            totalTools: registry.length,
          }, null, 2),
        }],
      };
    }

    const relevanceMap = new Map<string, number>();
    if (query) {
      const queryTerms = query.split(/\s+/).filter((t) => t.length > 0);
      for (const t of matches) {
        const haystack = `${t.namespacedName} ${t.description} ${t.serverName} ${t.category}`.toLowerCase();
        const matchCount = queryTerms.filter((term) => haystack.includes(term)).length;
        const kwScore = queryTerms.length > 0 ? matchCount / queryTerms.length : 0;
        const nameBonus = queryTerms.some((term) => t.name.toLowerCase() === term || t.serverId.toLowerCase() === term) ? 0.3 : 0;
        relevanceMap.set(t.namespacedName, Math.round((kwScore + nameBonus) * 100) / 100);
      }
    }

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

    const results = matches.slice(0, limit).map((t) => ({
      tool: t.namespacedName,
      server: t.serverId,
      category: t.category,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(relevanceMap.size > 0 ? { score: relevanceMap.get(t.namespacedName) ?? 0 } : {}),
      ...(recentServerIds.has(t.serverId) ? { recentlyUsed: true } : {}),
      ...(focus && focused(t) ? { inFocus: true } : {}),
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          matches: results.length,
          total: matches.length,
          ...(partialFallback ? { mode: 'partial' } : {}),
          ...(focusName ? { focus: focusName } : {}),
          ...(sessionId ? { sessionId } : {}),
          tools: results,
        }, null, 2),
      }],
    };
  }

  // ── Execute ─────────────────────────────────────────────────

  private async handleExecute(args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const toolName = typeof args.tool === 'string' ? args.tool : '';
    const toolArgs = (typeof args.args === 'object' && args.args !== null && !Array.isArray(args.args))
      ? (args.args as Record<string, unknown>) : {};

    if (!toolName) {
      return { content: [{ type: 'text', text: 'Missing required "tool" argument. Use ch1tty/search to find tools first.' }], isError: true };
    }
    const sepIndex = toolName.indexOf(SEPARATOR);
    if (sepIndex === -1) {
      return { content: [{ type: 'text', text: `Invalid tool name "${toolName}". Expected format: serverId/toolName.` }], isError: true };
    }
    const serverId = toolName.slice(0, sepIndex);
    const name = toolName.slice(sepIndex + 1);

    if (!this.proxy.isRegistered(serverId)) {
      const known = this.activeConfigs().map((c) => c.id).join(', ') || '(none)';
      return { content: [{ type: 'text', text: `Unknown server "${serverId}". Known servers: ${known}` }], isError: true };
    }

    const started = Date.now();
    try {
      const result = await this.proxy.callTool(serverId, name, toolArgs);
      this.evaluator.record({ ts: started, route: 'upstream', latency_ms: Date.now() - started, ok: !result.isError, server: serverId, capability: name });
      if (sessionId) {
        this.sessions.recordToolCall(sessionId, toolName);
        this.coordinator.onToolCall(sessionId, toolName);
      }
      return result;
    } catch (err) {
      this.evaluator.record({ ts: started, route: 'upstream', latency_ms: Date.now() - started, ok: false, server: serverId, capability: name });
      return { content: [{ type: 'text', text: `Execute failed for ${toolName}: ${String(err)}` }], isError: true };
    }
  }

  // ── Code mode ───────────────────────────────────────────────

  private async handleCode(args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const code = typeof args.code === 'string' ? args.code : '';
    if (!code.trim()) {
      return { content: [{ type: 'text', text: 'Missing required "code" argument.' }], isError: true };
    }
    const remoteIds = this.activeConfigs().filter((c) => c.type === 'remote').map((c) => c.id);
    const host = {
      remoteServerIds: () => remoteIds,
      runTool: async (namespacedTool: string, a: Record<string, unknown>, sid?: string) => {
        const res = await this.handleExecute({ tool: namespacedTool, args: a }, sid);
        // Hand the sandbox structured content, not the MCP envelope.
        if (res.content.length === 1 && res.content[0]!.type === 'text') {
          const text = (res.content[0] as { text: string }).text;
          try { return JSON.parse(text); } catch { return text; }
        }
        return res.content;
      },
      searchTools: async (query: string, server?: string) => {
        const reg = await this.getRegistry();
        const q = query.toLowerCase();
        return reg
          .filter((t) => (server ? t.serverId === server : true))
          .filter((t) => !q || `${t.namespacedName} ${t.description}`.toLowerCase().includes(q))
          .slice(0, 30)
          .map((t) => ({ tool: t.namespacedName, description: t.description, inputSchema: t.inputSchema }));
      },
    };

    const out = await this.codemode.run(code, host, sessionId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          code: out.error ? 'error' : 'executed',
          ...(out.error ? { error: out.error } : {}),
          result: out.result,
          ...(out.logs && out.logs.length ? { logs: out.logs } : {}),
        }, null, 2),
      }],
      isError: Boolean(out.error),
    };
  }

  // ── Provision (orchestrator provision_fork + provision_bind) ─

  private async handleProvision(args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const intent = typeof args.intent === 'string' ? args.intent.trim() : '';
    const entityId = typeof args.entityId === 'string' ? args.entityId.trim() : '';
    if (!intent || !entityId) {
      return { content: [{ type: 'text', text: 'Missing required "intent" and/or "entityId".' }], isError: true };
    }
    if (!this.proxy.isRegistered('orchestrator')) {
      return { content: [{ type: 'text', text: 'Orchestrator upstream not registered — cannot provision.' }], isError: true };
    }

    // Step 1: fork a persistent Agent DO for the intent.
    const forkRes = await this.proxy.callTool('orchestrator', 'provision_fork', { intent, entity_id: entityId });
    if (forkRes.isError) {
      return { content: [{ type: 'text', text: `provision_fork failed: ${textOf(forkRes)}` }], isError: true };
    }
    const forkParsed = parseJsonContent(forkRes);
    const agentId = (forkParsed?.agent_id ?? forkParsed?.agentId ?? forkParsed?.id) as string | undefined;

    // Step 2: bind the forked agent to the entity ("attach a system to a thing").
    const bindArgs: Record<string, unknown> = { entity_id: entityId, intent };
    if (agentId) bindArgs.agent_id = agentId;
    const bindRes = await this.proxy.callTool('orchestrator', 'provision_bind', bindArgs);

    if (sessionId) {
      this.coordinator.logEvent(sessionId, `provisioned agent for ${entityId}`, 'provision', { intent, agentId, bound: !bindRes.isError });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          provision: bindRes.isError ? 'fork_only' : 'bound',
          entityId,
          intent,
          agentId: agentId ?? null,
          fork: forkParsed ?? textOf(forkRes),
          bind: bindRes.isError ? { error: textOf(bindRes) } : parseJsonContent(bindRes) ?? textOf(bindRes),
        }, null, 2),
      }],
      isError: bindRes.isError,
    };
  }

  // ── Status / Reload ─────────────────────────────────────────

  getStatusSnapshot() {
    const statuses: ServerStatus[] = this.activeConfigs().map((config) => {
      const status = this.proxy.getStatus(config.id);
      return { id: config.id, name: config.name, type: config.type, enabled: config.enabled !== false, ...status };
    });

    const coordinatorSnap = this.coordinator.getSnapshot();
    const brainCircuitOpen = coordinatorSnap.brain.circuitOpen;
    const ledgerStats = coordinatorSnap.ledger;
    const ledgerWarn = ledgerStats.buffered > 0 || ledgerStats.flushErrors > 0;
    const ledgerStatus: 'ok' | 'warn' | 'degraded' = ledgerWarn ? 'warn' : 'ok';
    const brainDegraded = brainCircuitOpen;
    const systemStatus: 'ok' | 'warn' | 'degraded' = brainDegraded || ledgerStatus === 'warn' ? 'warn' : 'ok';

    return {
      gateway: 'ch1tty',
      version: VERSION,
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      totalServers: statuses.length,
      connectedServers: statuses.filter((s) => s.connected).length,
      totalTools: statuses.reduce((sum, s) => sum + s.toolCount, 0),
      registryCached: Date.now() < this.registryExpiresAt,
      vectorizeIndexed: this.indexed,
      activeSessions: this.sessions.count,
      availableFocusProfiles: Object.keys(this.focusProfiles.profiles),
      systemHealth: { status: systemStatus, brainDegraded, ledgerStatus },
      brainHealth: { status: brainDegraded ? 'degraded' : 'ok', circuitOpen: brainCircuitOpen, vectorize: coordinatorSnap.brain.vectorize },
      ledgerHealth: { status: ledgerStatus, buffered: ledgerStats.buffered, flushed: ledgerStats.flushed, flushErrors: ledgerStats.flushErrors },
      evaluator: this.evaluator.getStats(),
      coordinator: coordinatorSnap,
      servers: statuses,
    };
  }

  private async handleStatus(): Promise<ToolCallResult> {
    return { content: [{ type: 'text', text: JSON.stringify(this.getStatusSnapshot(), null, 2) }] };
  }

  private async handleReload(): Promise<ToolCallResult> {
    this.configs = validateServersConfig({ servers: REMOTE_SERVERS }).servers;
    this.rebuildBackends();
    await this.refreshRegistry();
    return {
      content: [{ type: 'text', text: JSON.stringify({ reloaded: true, totalServers: this.activeConfigs().length }, null, 2) }],
    };
  }

  // ── Cast (ported from aggregator.handleCast) ────────────────

  private async handleCast(args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    const intent = typeof args.intent === 'string' ? args.intent.trim() : '';
    const toolArgs = (typeof args.args === 'object' && args.args !== null && !Array.isArray(args.args))
      ? (args.args as Record<string, unknown>) : {};
    const confirm = args.confirm === true;
    const { name: focusName, profile: focus } = this.resolveActiveFocus(args.focus);

    if (!intent) {
      return { content: [{ type: 'text', text: 'Missing required "intent". Describe what you want done.' }], isError: true };
    }

    const terms = intent.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    const [registryResult, promptsResult, resourcesResult] = await Promise.allSettled([
      this.getRegistry(), this.listAllPrompts(), this.listAllResources(),
    ]);
    if (registryResult.status !== 'fulfilled') throw registryResult.reason;
    const registry = registryResult.value;
    const allPrompts = promptsResult.status === 'fulfilled' ? promptsResult.value.prompts : [];
    const allResources = resourcesResult.status === 'fulfilled' ? resourcesResult.value.resources : [];

    const candidates: ToolCandidate[] = registry.map((t) => ({
      namespacedName: t.namespacedName, description: t.description, category: t.category, serverName: t.serverName,
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
      if (focus) {
        const seen = new Set(scoredTools.map((t) => t.namespacedName));
        let added = 0;
        for (const t of this.scoreIntent(intent, registry, sessionId)) {
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
      scoredTools = this.scoreIntent(intent, registry, sessionId);
      castRoute = 'fallback';
    }

    if (focus) scoredTools = applyFocusBias(focus, scoredTools);

    if (sessionId) {
      this.coordinator.ledger.record(sessionId, 'cast_route', {
        intent: intent.slice(0, 200), route: castRoute, confirm,
        candidate_count: scoredTools.length, ...(focusName ? { focus: focusName } : {}),
      });
    }

    const scoredPrompts = allPrompts
      .map((p) => {
        const haystack = `${p.name} ${p.description || ''}`.toLowerCase();
        const matchCount = terms.filter((t) => haystack.includes(t)).length;
        const score = terms.length > 0 ? Math.round((matchCount / terms.length) * 100) / 100 : 0;
        return { ...p, score };
      })
      .filter((p) => p.score > 0.1).sort((a, b) => b.score - a.score).slice(0, 5);

    const scoredResources = allResources
      .map((r) => {
        const haystack = `${r.uri} ${r.name} ${r.description || ''}`.toLowerCase();
        const matchCount = terms.filter((t) => haystack.includes(t)).length;
        const score = terms.length > 0 ? Math.round((matchCount / terms.length) * 100) / 100 : 0;
        return { ...r, score };
      })
      .filter((r) => r.score > 0.1).sort((a, b) => b.score - a.score).slice(0, 5);

    let resolvedBy: 'brain' | 'keyword' = castRoute === 'brain' ? 'brain' : 'keyword';

    if (scoredTools.length === 0 && scoredPrompts.length === 0 && scoredResources.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ cast: 'no_match', resolvedBy, intent, hint: 'No tools, prompts, or resources matched. Try ch1tty/search with different keywords.' }, null, 2) }],
      };
    }

    const best = scoredTools[0];
    if (best && castRoute === 'brain' && keywordAugmented.has(best.namespacedName)) resolvedBy = 'keyword';
    const alternatives = scoredTools.slice(1, 4).map((t) => ({ tool: t.namespacedName, score: t.score, description: t.description }));

    const related: Record<string, unknown> = {};
    if (scoredPrompts.length > 0) related.prompts = scoredPrompts.map((p) => ({ name: p.name, description: p.description, arguments: p.arguments, score: p.score }));
    if (scoredResources.length > 0) related.resources = scoredResources.map((r) => ({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType, score: r.score }));

    if (!best) {
      return { content: [{ type: 'text', text: JSON.stringify({ cast: 'discovered', resolvedBy, intent, hint: 'No executable tools matched, but related prompts/resources found.', ...related }, null, 2) }] };
    }

    const focusSuggestions = focusName ? getSuggestionsForFocus(focusName, this.suggestionsCatalog, { intent }) : null;

    if (confirm) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cast: 'plan', resolvedBy, intent, ...(focusName ? { focus: focusName } : {}),
            resolved: { tool: best.namespacedName, server: best.serverId, category: best.category, description: best.description, score: best.score, inputSchema: best.inputSchema },
            alternatives, ...related, ...(focusSuggestions ? { suggestions: focusSuggestions } : {}), args: toolArgs,
            hint: 'Call cast again without confirm to execute, or use ch1tty/execute directly.',
          }, null, 2),
        }],
      };
    }

    const result = await this.handleExecute({ tool: best.namespacedName, args: toolArgs }, sessionId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            cast: 'executed', resolvedBy, intent, ...(focusName ? { focus: focusName } : {}),
            resolved: best.namespacedName, score: best.score,
            ...(alternatives.length > 0 ? { alternatives } : {}), ...related,
            ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
          }),
        },
        ...result.content,
      ],
      isError: result.isError,
    };
  }

  private scoreIntent(intent: string, registry: NamespacedTool[], sessionId?: string): Array<NamespacedTool & { score: number }> {
    const terms = intent.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const shortTerms = intent.toLowerCase().split(/\s+/).filter((t) => t.length === 2);
    if (terms.length === 0 && shortTerms.length === 0) return [];

    const affinityMap = sessionId ? this.coordinator.getServerAffinity(sessionId) : new Map<string, number>();

    const scored = registry.map((tool) => {
      const haystack = `${tool.namespacedName} ${tool.description} ${tool.serverName} ${tool.category}`.toLowerCase();
      const matchCount = terms.filter((term) => haystack.includes(term)).length;
      const keywordScore = terms.length > 0 ? matchCount / terms.length : 0;
      const affinityTs = affinityMap.get(tool.serverId);
      const affinityScore = affinityTs ? 0.2 * Math.exp(-(Date.now() - affinityTs) / (10 * 60 * 1000)) : 0;
      const nameBonus = [...terms, ...shortTerms].some((t) => tool.name.toLowerCase() === t || tool.serverId.toLowerCase() === t) ? 0.3 : 0;
      const score = Math.round((keywordScore + affinityScore + nameBonus) * 100) / 100;
      return { ...tool, score };
    });
    return scored.filter((t) => t.score > 0.1).sort((a, b) => b.score - a.score);
  }

  // ── Public MCP interface ────────────────────────────────────

  async listAllTools() {
    return { tools: this.metaTools() };
  }

  async callTool(namespacedName: string, args: Record<string, unknown> = {}, sessionId?: string): Promise<ToolCallResult> {
    const normalized = this.normalizeToolName(namespacedName);
    const sepIndex = normalized.indexOf(SEPARATOR);
    if (sepIndex === -1) {
      return { content: [{ type: 'text', text: `Invalid tool name "${namespacedName}". Available: ch1tty/search, ch1tty/execute, ch1tty/code, ch1tty/cast, ch1tty/provision, ch1tty/status, ch1tty/reload` }], isError: true };
    }
    const serverId = normalized.slice(0, sepIndex);
    const toolName = normalized.slice(sepIndex + 1);
    if (serverId !== META_SERVER_ID) {
      return { content: [{ type: 'text', text: `Unknown tool "${namespacedName}". Use ch1tty/search to discover tools, then ch1tty/execute.` }], isError: true };
    }
    return this.handleMetaTool(toolName, args, sessionId);
  }

  private normalizeToolName(raw: string): string {
    if (!raw) return raw;
    let name = raw;
    const prefix = `${META_SERVER_ID}${SEPARATOR}`;
    const doubled = name.toLowerCase();
    if (doubled.startsWith(`${prefix}${META_SERVER_ID}`)) name = name.slice(prefix.length);
    if (name.toLowerCase().startsWith(`${META_SERVER_ID}.`)) name = `${prefix}${name.slice(META_SERVER_ID.length + 1)}`;
    if (name === 'gateway_status') name = `${prefix}status`;
    if (!name.includes(SEPARATOR) && !name.includes('.') && META_TOOL_VERBS.has(name)) name = `${prefix}${name}`;
    return name;
  }

  // ── Resources / Prompts (passthrough, ported) ───────────────

  async listAllResources() {
    const resourcePromises = this.activeConfigs().map(async (config) => {
      try {
        const { resources } = await this.proxy.listResources(config.id);
        return resources.map((r) => ({ uri: `${config.id}://${r.uri}`, name: `[${config.name}] ${r.name}`, description: r.description, mimeType: r.mimeType }));
      } catch (err) {
        log.error(`Failed to list resources: ${err}`, config.id);
        return [];
      }
    });
    const results = await Promise.allSettled(resourcePromises);
    return { resources: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])) };
  }

  async listAllResourceTemplates() {
    const templatePromises = this.activeConfigs().map(async (config) => {
      try {
        const { templates } = await this.proxy.listResources(config.id);
        return templates.map((t) => ({ uriTemplate: `${config.id}://${t.uriTemplate}`, name: `[${config.name}] ${t.name}`, description: t.description, mimeType: t.mimeType }));
      } catch (err) {
        log.error(`Failed to list resource templates: ${err}`, config.id);
        return [];
      }
    });
    const results = await Promise.allSettled(templatePromises);
    return { resourceTemplates: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])) };
  }

  async readResource(uri: string) {
    const match = uri.match(/^([^:]+):\/\/(.+)$/);
    if (!match) throw new Error(`Invalid namespaced resource URI: ${uri}`);
    const [, serverId, originalUri] = match;
    if (!this.proxy.isRegistered(serverId!)) throw new Error(`Unknown server "${serverId}" in resource URI: ${uri}`);
    return this.proxy.readResource(serverId!, originalUri!);
  }

  async listAllPrompts() {
    const promptPromises = this.activeConfigs().map(async (config) => {
      try {
        const prompts = await this.proxy.listPrompts(config.id);
        return prompts.map((p) => ({ name: `${config.id}${SEPARATOR}${p.name}`, description: `[${config.name}] ${p.description || p.name}`, arguments: p.arguments }));
      } catch (err) {
        log.error(`Failed to list prompts: ${err}`, config.id);
        return [];
      }
    });
    const results = await Promise.allSettled(promptPromises);
    return { prompts: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])) };
  }

  async getPrompt(namespacedName: string, args?: Record<string, string>): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    const sepIndex = namespacedName.indexOf(SEPARATOR);
    if (sepIndex === -1) throw new Error(`Invalid prompt name "${namespacedName}". Expected format: serverId/promptName`);
    const serverId = namespacedName.slice(0, sepIndex);
    const promptName = namespacedName.slice(sepIndex + 1);
    if (!this.proxy.isRegistered(serverId)) throw new Error(`Unknown server "${serverId}" for prompt: ${namespacedName}`);
    return this.proxy.getPrompt(serverId, promptName, args);
  }

  // ── Alarm (flush ledger + evaluator to chittytrack) ─────────

  private async ensureAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null) {
      await this.ctx.storage.setAlarm(Date.now() + LEDGER_FLUSH_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    // A per-session DO (idFromName) has no transport-close event, so onSessionEnd
    // (context_checkpoint to ContextConsciousness + session_end ledger summary)
    // is driven here: close sessions idle longer than SESSION_IDLE_MS. This is
    // the real lifecycle-end path the stdio gateway ran on transport.onclose.
    for (const sid of this.coordinator.idleSessions(SESSION_IDLE_MS)) {
      await this.coordinator.onSessionEnd(sid).catch((e) => log.warn(`onSessionEnd(${sid}) failed: ${e}`));
      this.sessions.remove(sid);
    }

    const ledgerN = await this.ledger.flush();
    const evalN = await this.evaluator.flush();
    log.debug(`Alarm flush: ledger=${ledgerN} eval=${evalN}`);

    // Reschedule while there's anything still buffered OR any session is still
    // active (so it can be idle-closed later); otherwise let the alarm lapse.
    const lStats = this.ledger.getStats();
    const eStats = this.evaluator.getStats();
    if (lStats.buffered > 0 || eStats.buffered > 0 || this.sessions.count > 0) {
      await this.ctx.storage.setAlarm(Date.now() + LEDGER_FLUSH_INTERVAL_MS);
    }
  }
}

// ── helpers ───────────────────────────────────────────────────

function textOf(r: ToolCallResult): string {
  const c = r.content?.[0];
  return c && c.type === 'text' ? c.text : JSON.stringify(r.content);
}

function parseJsonContent(r: ToolCallResult): Record<string, unknown> | null {
  const t = textOf(r);
  try { return JSON.parse(t); } catch { return null; }
}
