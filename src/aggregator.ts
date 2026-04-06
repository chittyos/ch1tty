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

const SEPARATOR = '/';
const META_SERVER_ID = 'ch1tty';

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
}

export class Aggregator {
  private backends = new Map<string, Backend>();
  private configs: ServerConfig[];
  private accessFilter?: ServerAccess;
  private categoryFilter?: ServerCategory;
  private configPath?: string;
  private startedAt = Date.now();
  readonly sessions = new SessionTracker();

  // Internal tool registry — never exposed directly to clients
  private registry: NamespacedTool[] = [];
  private registryExpiresAt = 0;
  private registryRefreshing: Promise<void> | null = null;
  private static readonly REGISTRY_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(configs: ServerConfig[], options?: AggregatorOptions) {
    this.accessFilter = options?.accessFilter;
    this.categoryFilter = options?.categoryFilter;
    this.configPath = options?.configPath;
    this.configs = configs;
    this.rebuildBackends();
  }

  private rebuildBackends(): void {
    this.backends.clear();
    const stdio = new ChildManager();
    const http = new RemoteProxy();

    for (const config of this.activeConfigs()) {
      const backend = config.type === 'local' ? stdio : http;
      backend.registerServer(config);
      this.backends.set(config.id, backend);
    }

    // Invalidate registry on backend rebuild
    this.registry = [];
    this.registryExpiresAt = 0;
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
            limit: { type: 'number', description: 'Max results to return (default 20)' },
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
          },
          required: ['tool'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}status`,
        description: 'Gateway status — connected servers, tool counts, cache ages',
        inputSchema: { type: 'object' },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}reload`,
        description: 'Hot-reload servers.json without restarting the gateway',
        inputSchema: { type: 'object' },
      },
    ];
  }

  private async handleMetaTool(toolName: string, args: Record<string, unknown>, sessionId?: string): Promise<ToolCallResult> {
    switch (toolName) {
      case 'search':
        return this.handleSearch(args, sessionId);
      case 'execute':
        return this.handleExecute(args, sessionId);
      case 'status':
        return this.handleStatus();
      case 'reload':
        return this.handleReload();
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

    const registry = await this.getRegistry();

    // Build session context for relevance boosting
    const recentServerIds = new Set<string>();
    if (sessionId) {
      for (const tool of this.sessions.getRecentTools(sessionId)) {
        const sep = tool.indexOf(SEPARATOR);
        if (sep > 0) recentServerIds.add(tool.slice(0, sep));
      }
    }

    let matches = registry;

    if (serverFilter) {
      matches = matches.filter((t) => t.serverId === serverFilter);
    }
    if (categoryFilter) {
      matches = matches.filter((t) => t.category === categoryFilter);
    }
    if (query) {
      const terms = query.split(/\s+/);
      matches = matches.filter((t) => {
        const haystack = `${t.namespacedName} ${t.description} ${t.serverName} ${t.category}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    }

    // If no filters at all, return a summary of available servers instead of all tools
    if (!query && !serverFilter && !categoryFilter) {
      const serverSummary = this.activeConfigs().map((c) => {
        const count = registry.filter((t) => t.serverId === c.id).length;
        return { server: c.id, name: c.name, category: c.category, tools: count };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            hint: 'Use query, server, or category to search for specific tools',
            servers: serverSummary,
            totalTools: registry.length,
          }, null, 2),
        }],
      };
    }

    // Sort: boost tools from recently-used servers to the top
    if (recentServerIds.size > 0) {
      matches = [...matches].sort((a, b) => {
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
      ...(recentServerIds.has(t.serverId) ? { recentlyUsed: true } : {}),
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          matches: results.length,
          total: matches.length,
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
      ? args.args as Record<string, unknown>
      : {};

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

    try {
      const result = await backend.callTool(serverId, name, toolArgs);
      if (sessionId) {
        this.sessions.recordToolCall(sessionId, toolName);
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

    return {
      gateway: 'ch1tty',
      version: VERSION,
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      totalServers: statuses.length,
      connectedServers: statuses.filter((s) => s.connected).length,
      totalTools: statuses.reduce((sum, s) => sum + s.toolCount, 0),
      registryCached: Date.now() < this.registryExpiresAt,
      activeSessions: this.sessions.count,
      servers: statuses,
    };
  }

  private async handleStatus(): Promise<ToolCallResult> {
    const summary = this.getStatusSnapshot();
    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
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
      const oldIds = new Set(this.configs.map((c) => c.id));
      const newIds = new Set(newConfig.servers.map((c) => c.id));

      const added = newConfig.servers.filter((c) => !oldIds.has(c.id));
      const removed = this.configs.filter((c) => !newIds.has(c.id));

      // Build new backends before shutting down old ones (atomic swap)
      const oldBackends = this.backends;
      this.configs = newConfig.servers;
      this.rebuildBackends();

      // Now shut down the old backends
      const seen = new Set<Backend>();
      const shutdowns: Promise<void>[] = [];
      for (const backend of oldBackends.values()) {
        if (seen.has(backend)) continue;
        seen.add(backend);
        shutdowns.push(backend.shutdown());
      }
      await Promise.allSettled(shutdowns);

      const result = {
        reloaded: true,
        added: added.map((c) => c.id),
        removed: removed.map((c) => c.id),
        totalServers: this.activeConfigs().length,
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
    const sepIndex = namespacedName.indexOf(SEPARATOR);
    if (sepIndex === -1) {
      return {
        content: [{
          type: 'text',
          text: `Invalid tool name "${namespacedName}". Available tools: ch1tty/search, ch1tty/execute, ch1tty/status, ch1tty/reload`,
        }],
        isError: true,
      };
    }

    const serverId = namespacedName.slice(0, sepIndex);
    const toolName = namespacedName.slice(sepIndex + 1);

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
      prompts: results.flatMap((r) => r.status === 'fulfilled' ? r.value : []),
    };
  }

  async getPrompt(namespacedName: string, args?: Record<string, string>): Promise<{
    description?: string;
    messages: Array<{ role: string; content: ContentItem }>;
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
