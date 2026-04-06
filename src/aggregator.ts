import type {
  ServerAccess,
  ServerCategory,
  ServerConfig,
  ServerStatus,
  ToolCallResult,
  Backend,
  ContentItem,
} from './types.js';
import { ChildManager } from './child-manager.js';
import { RemoteProxy } from './remote-proxy.js';
import { loadConfigFromPath } from './config.js';
import { VERSION } from './utils.js';
import * as alchemist from './alchemist.js';
import { ChittyTaskClient } from './task-client.js';
import { OllamaClient } from './ollama.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const SEPARATOR = '/';
const META_SERVER_ID = 'ch1tty';

export interface AggregatorOptions {
  accessFilter?: ServerAccess;
  categoryFilter?: ServerCategory;
  configPath?: string;
}

export interface ToolExecutionContext {
  authInfo?: AuthInfo;
  sessionId?: string;
}

export class Aggregator {
  private backends = new Map<string, Backend>();
  private configs: ServerConfig[];
  private accessFilter?: ServerAccess;
  private categoryFilter?: ServerCategory;
  private configPath?: string;
  private startedAt = Date.now();
  private taskClient = new ChittyTaskClient();
  private ollama = new OllamaClient();

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

  // ── Meta-tools ────────────────────────────────────────────────

  private metaTools(): Array<{
    name: string;
    description?: string;
    inputSchema: { type: 'object'; properties?: Record<string, object>; required?: string[] };
  }> {
    return [
      {
        name: `${META_SERVER_ID}${SEPARATOR}status`,
        description: '[ch1tty] Gateway status — connected servers, tool counts, cache ages',
        inputSchema: { type: 'object' },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}reload`,
        description: '[ch1tty] Hot-reload servers.json without restarting the gateway',
        inputSchema: { type: 'object' },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}alchemist_discover`,
        description: '[ch1tty] The Alchemist — scan all backends, map tool capabilities, categories, and server groupings',
        inputSchema: { type: 'object' },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}alchemist_combos`,
        description: '[ch1tty] The Alchemist — detect composable tool chains, cross-backend pipelines, and workflow patterns',
        inputSchema: { type: 'object' },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}alchemist_prompts`,
        description: '[ch1tty] The Alchemist — generate optimized prompt strings tailored to the current tool surface',
        inputSchema: { type: 'object' },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}alchemist_suggest`,
        description: '[ch1tty] The Alchemist — given a goal, returns a recipe: which tools, what order, what prompts',
        inputSchema: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: 'What you want to accomplish (e.g. "track evidence", "monitor services", "query finances")',
            },
          },
          required: ['goal'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}task_list`,
        description: '[ch1tty] Canonical task management — list tasks from Chitty task service',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Optional explicit session id override' },
            status: { type: 'string', description: 'Optional task status filter' },
            limit: { type: 'number', description: 'Optional max tasks to return' },
          },
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}task_create`,
        description: '[ch1tty] Canonical task management — create a tracked task in Chitty task service',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Task title' },
            description: { type: 'string', description: 'Optional task description' },
            taskType: { type: 'string', description: 'Task classification, defaults to user_request' },
            priority: { type: 'string', description: 'Priority, for example low, normal, high' },
            metadata: { type: 'object', description: 'Optional structured metadata' },
          },
          required: ['title'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}task_get`,
        description: '[ch1tty] Canonical task management — fetch a single task by id',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task identifier' },
          },
          required: ['taskId'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}task_update`,
        description: '[ch1tty] Canonical task management — update task state, assignment, or result',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task identifier' },
            status: { type: 'string', description: 'New task status' },
            title: { type: 'string', description: 'Updated title' },
            description: { type: 'string', description: 'Updated description' },
            priority: { type: 'string', description: 'Updated priority' },
            assignedService: { type: 'string', description: 'Owning service id' },
            result: { type: 'object', description: 'Structured task result payload' },
            error: { type: 'string', description: 'Failure detail for failed tasks' },
          },
          required: ['taskId'],
        },
      },
      // ── Ollama intelligence tools ──
      {
        name: `${META_SERVER_ID}${SEPARATOR}think`,
        description: '[ch1tty] Meta-routing — ask Ch1tty\'s Ollama brain for the optimal strategy to handle a request',
        inputSchema: {
          type: 'object',
          properties: {
            request: { type: 'string', description: 'What needs to be done' },
            context: { type: 'string', description: 'Additional context (project, entity, urgency)' },
          },
          required: ['request'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}brain_status`,
        description: '[ch1tty] Check Ollama brain status — model, availability, health',
        inputSchema: { type: 'object' },
      },
      // ── Ledger write tools — model/channel agnostic ──
      {
        name: `${META_SERVER_ID}${SEPARATOR}log_decision`,
        description: '[ch1tty] Log a decision to the entity\'s ChittyLedger — auditable, cross-channel visible',
        inputSchema: {
          type: 'object',
          properties: {
            decision: { type: 'string', description: 'What was decided' },
            reasoning: { type: 'string', description: 'Why — the rationale' },
            topic: { type: 'string', description: 'Which workstream/topic this relates to' },
            project: { type: 'string', description: 'Project context (auto-detected from session if omitted)' },
          },
          required: ['decision'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}log_event`,
        description: '[ch1tty] Log a generic event to ChittyLedger — tool calls, outcomes, observations',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'What happened' },
            type: { type: 'string', description: 'Event type: tool_call, outcome, observation, milestone' },
            topic: { type: 'string', description: 'Workstream/topic' },
            project: { type: 'string', description: 'Project context' },
            metadata: { type: 'object', description: 'Structured data about the event' },
          },
          required: ['action'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}update_workstream`,
        description: '[ch1tty] Tag events to a workstream or create a new workstream',
        inputSchema: {
          type: 'object',
          properties: {
            workstream: { type: 'string', description: 'Workstream name (existing or new)' },
            status: { type: 'string', description: 'active, paused, completed' },
            summary: { type: 'string', description: 'Current state of this workstream' },
          },
          required: ['workstream'],
        },
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}session_checkpoint`,
        description: '[ch1tty] Checkpoint current session — flush events to ledger, snapshot state',
        inputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'What was accomplished since last checkpoint' },
            nextSteps: { type: 'string', description: 'What should happen next' },
          },
        },
      },
    ];
  }

  private async handleMetaTool(
    toolName: string,
    args?: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    switch (toolName) {
      case 'status':
        return this.handleStatus();
      case 'reload':
        return this.handleReload();
      case 'alchemist_discover':
        return this.handleAlchemist('discover');
      case 'alchemist_combos':
        return this.handleAlchemist('combos');
      case 'alchemist_prompts':
        return this.handleAlchemist('prompts');
      case 'alchemist_suggest':
        return this.handleAlchemist('suggest', args?.goal as string);
      case 'task_list':
        return this.handleTaskTool('list', args, context);
      case 'task_create':
        return this.handleTaskTool('create', args, context);
      case 'task_get':
        return this.handleTaskTool('get', args, context);
      case 'task_update':
        return this.handleTaskTool('update', args, context);
      case 'think':
        return this.handleThink(args);
      case 'brain_status':
        return this.handleBrainStatus();
      case 'log_decision':
        return this.handleLedgerWrite('DECISION', args, context);
      case 'log_event':
        return this.handleLedgerWrite('EVENT', args, context);
      case 'update_workstream':
        return this.handleLedgerWrite('WORKSTREAM', args, context);
      case 'session_checkpoint':
        return this.handleLedgerWrite('CHECKPOINT', args, context);
      default:
        return {
          content: [{ type: 'text', text: `Unknown meta-tool: ${toolName}` }],
          isError: true,
        };
    }
  }

  getStatusSnapshot(): {
    gateway: string;
    version: string;
    transport: string;
    uptime: number;
    totalServers: number;
    connectedServers: number;
    totalTools: number;
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
      transport: 'stdio',
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      totalServers: statuses.length,
      connectedServers: statuses.filter((s) => s.connected).length,
      totalTools: statuses.reduce((sum, s) => sum + s.toolCount, 0),
      servers: statuses,
    };
  }

  private async handleStatus(): Promise<ToolCallResult> {
    const summary = this.getStatusSnapshot();
    const brain = await this.ollama.health();
    return {
      content: [{ type: 'text', text: JSON.stringify({
        ...summary,
        brain: {
          status: brain.ok ? 'connected' : 'offline',
          model: brain.model,
          models: brain.models,
        },
      }, null, 2) }],
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

      process.stderr.write(`[ch1tty] Config reloaded: +${added.length} -${removed.length} servers\n`);
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

  // ── Alchemist ────────────────────────────────────────────────

  private async handleAlchemist(mode: 'discover' | 'combos' | 'prompts' | 'suggest', goal?: string): Promise<ToolCallResult> {
    try {
      const { tools: allTools } = await this.listAllTools();
      // Filter out meta-tools for cleaner analysis
      const tools = allTools.filter((t) => !t.name.startsWith(`${META_SERVER_ID}${SEPARATOR}`));

      let result: unknown;
      switch (mode) {
        case 'discover':
          result = alchemist.discover(tools as Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>);
          break;
        case 'combos':
          result = alchemist.combos(tools as Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>);
          break;
        case 'prompts':
          result = alchemist.prompts(tools as Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>);
          break;
        case 'suggest':
          if (!goal) {
            return {
              content: [{ type: 'text', text: 'The "goal" parameter is required for alchemist_suggest' }],
              isError: true,
            };
          }
          result = alchemist.suggest(goal, tools as Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>);
          if (!result) {
            return {
              content: [{ type: 'text', text: `No recipe found for goal: "${goal}". Try broader terms like "evidence", "finance", "monitor", "memory", or "data".` }],
            };
          }
          break;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Alchemist error: ${String(err)}` }],
        isError: true,
      };
    }
  }

  // ── Task Management ───────────────────────────────────────────

  private async handleTaskTool(
    mode: 'list' | 'create' | 'get' | 'update',
    args: Record<string, unknown> = {},
    context?: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    if (!this.taskClient.isConfigured()) {
      return this.taskClient.missingConfigResult();
    }

    try {
      let result: unknown;
      switch (mode) {
        case 'list':
          result = await this.taskClient.listTasks({
            sessionId: asString(args.sessionId),
            status: asString(args.status),
            limit: asNumber(args.limit),
          }, toTaskContext(context));
          break;
        case 'create': {
          const title = asString(args.title);
          if (!title) {
            return missingArgResult('title', 'task_create');
          }
          result = await this.taskClient.createTask({
            title,
            description: asString(args.description),
            taskType: asString(args.taskType),
            priority: asString(args.priority),
            metadata: asRecord(args.metadata),
            sessionId: asString(args.sessionId),
          }, toTaskContext(context));
          break;
        }
        case 'get': {
          const taskId = asString(args.taskId);
          if (!taskId) {
            return missingArgResult('taskId', 'task_get');
          }
          result = await this.taskClient.getTask(taskId);
          break;
        }
        case 'update': {
          const taskId = asString(args.taskId);
          if (!taskId) {
            return missingArgResult('taskId', 'task_update');
          }
          result = await this.taskClient.updateTask(taskId, {
            status: asString(args.status),
            title: asString(args.title),
            description: asString(args.description),
            priority: asString(args.priority),
            assignedService: asString(args.assignedService),
            result: asRecord(args.result),
            error: asString(args.error),
          }, toTaskContext(context));
          break;
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Task management error: ${String(err)}` }],
        isError: true,
      };
    }
  }

  // ── Tools ─────────────────────────────────────────────────────

  async listAllTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema: { type: 'object'; properties?: Record<string, object>; required?: string[] };
    }>;
  }> {
    const toolPromises = this.activeConfigs().map(async (config) => {
      try {
        const backend = this.backendFor(config.id);
        if (!backend) return [];

        const tools = await backend.listTools(config.id);
        const tag = `[${config.category}:${config.access}]`;
        return tools.map((t) => ({
          name: `${config.id}${SEPARATOR}${t.name}`,
          description: `${tag} [${config.name}] ${t.description || t.name}`,
          inputSchema: (t.inputSchema || { type: 'object' }) as {
            type: 'object';
            properties?: Record<string, object>;
            required?: string[];
          },
        }));
      } catch (err) {
        process.stderr.write(`[ch1tty] Failed to list tools for ${config.id}: ${err}\n`);
        return [];
      }
    });

    const results = await Promise.allSettled(toolPromises);
    const tools = results.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    );

    return { tools: [...this.metaTools(), ...tools] };
  }

  async callTool(
    namespacedName: string,
    args: Record<string, unknown> = {},
    context?: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const sepIndex = namespacedName.indexOf(SEPARATOR);
    const knownServers = [META_SERVER_ID, ...this.configs.map((config) => config.id)].join(', ') || '(none)';
    if (sepIndex === -1) {
      return {
        content: [{
          type: 'text',
          text: `Invalid tool name "${namespacedName}". Expected format: serverId/toolName. Known servers: ${knownServers}`,
        }],
        isError: true,
      };
    }

    const serverId = namespacedName.slice(0, sepIndex);
    const toolName = namespacedName.slice(sepIndex + 1);

    if (serverId === META_SERVER_ID) {
      return this.handleMetaTool(toolName, args, context);
    }

    const backend = this.backendFor(serverId);
    if (!backend) {
      return {
        content: [{
          type: 'text',
          text: `Unknown server "${serverId}". Known servers: ${knownServers}`,
        }],
        isError: true,
      };
    }

    try {
      return await backend.callTool(serverId, toolName, args);
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Tool call failed for ${serverId}/${toolName}: ${String(err)}` }],
        isError: true,
      };
    }
  }

  // ── Resources ─────────────────────────────────────────────────

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
        process.stderr.write(`[ch1tty] Failed to list resources for ${config.id}: ${err}\n`);
        return [];
      }
    });

    const results = await Promise.allSettled(resourcePromises);
    const backendResources = results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);

    // Native Ch1tty resources — model/channel agnostic session awareness
    const nativeResources = [
      {
        uri: 'ch1tty://sessions/active',
        name: '[ch1tty] Active Sessions',
        description: 'All active sessions across this machine — parallel session awareness',
        mimeType: 'application/json',
      },
      {
        uri: 'ch1tty://workstreams',
        name: '[ch1tty] Workstreams',
        description: 'Workstream index — topics/projects across all sessions and channels',
        mimeType: 'application/json',
      },
      {
        uri: 'ch1tty://resume',
        name: '[ch1tty] Resume Context',
        description: 'Synthesized context for resuming work — cross-session, cross-channel',
        mimeType: 'application/json',
      },
    ];

    return {
      resources: [...nativeResources, ...backendResources],
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
        process.stderr.write(`[ch1tty] Failed to list resource templates for ${config.id}: ${err}\n`);
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
    // ── Native Ch1tty resources ──
    if (uri.startsWith('ch1tty://')) {
      return this.readNativeResource(uri);
    }

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

  /**
   * Native Ch1tty resources — session awareness, workstreams, resume.
   * Model/channel agnostic. Any MCP client gets this.
   */
  private async readNativeResource(uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string }>;
  }> {
    const path = uri.replace('ch1tty://', '');

    if (path === 'sessions/active') {
      // Scan local sessions + check for cross-machine sessions from ledger
      const sessions = await this.getActiveSessions();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(sessions, null, 2) }],
      };
    }

    if (path === 'workstreams') {
      // Workstream index — from local cache or Neon
      const workstreams = await this.getWorkstreams();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(workstreams, null, 2) }],
      };
    }

    if (path === 'resume') {
      // Synthesized resume context
      const resume = await this.getResumeContext();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(resume, null, 2) }],
      };
    }

    throw new Error(`Unknown ch1tty resource: ${uri}`);
  }

  /** Scan ~/.claude/sessions/ for active pids, grouped by cwd */
  private async getActiveSessions(): Promise<{
    sessions: Array<{ pid: number; cwd: string; sessionId: string; startedAt: number; alive: boolean }>;
    byProject: Record<string, number>;
  }> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');

    const sessions: Array<{ pid: number; cwd: string; sessionId: string; startedAt: number; alive: boolean }> = [];
    const byProject: Record<string, number> = {};

    try {
      const files = await fs.readdir(sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = JSON.parse(await fs.readFile(path.join(sessionsDir, file), 'utf-8'));
          let alive = false;
          try {
            process.kill(data.pid, 0);
            alive = true;
          } catch { /* dead */ }

          if (alive) {
            sessions.push({
              pid: data.pid,
              cwd: data.cwd,
              sessionId: data.sessionId,
              startedAt: data.startedAt,
              alive,
            });
            const project = data.cwd?.split('/').pop() || 'unknown';
            byProject[project] = (byProject[project] || 0) + 1;
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* sessions dir may not exist */ }

    return { sessions, byProject };
  }

  /** Get workstream index — local cache file or empty */
  private async getWorkstreams(): Promise<{ workstreams: unknown[] }> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const indexFile = path.join(os.homedir(), '.claude', 'chittycontext', 'workstream_index.json');

    try {
      const data = JSON.parse(await fs.readFile(indexFile, 'utf-8'));
      return data;
    } catch {
      return { workstreams: [] };
    }
  }

  /** Get resume context — checkpoint + active sessions + workstreams */
  private async getResumeContext(): Promise<Record<string, unknown>> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const sessions = await this.getActiveSessions();
    const workstreams = await this.getWorkstreams();

    // Find most recent checkpoint
    const checkpointsDir = path.join(os.homedir(), '.claude', 'checkpoints');
    let latestCheckpoint: string | null = null;
    try {
      const files = await fs.readdir(checkpointsDir);
      const latest = files.filter(f => f.endsWith('-latest.md')).sort().pop();
      if (latest) {
        latestCheckpoint = await fs.readFile(path.join(checkpointsDir, latest), 'utf-8');
      }
    } catch { /* no checkpoints */ }

    return {
      activeSessions: sessions,
      workstreams,
      checkpoint: latestCheckpoint ? { available: true, preview: latestCheckpoint.slice(0, 500) } : null,
      resumeFrom: 'ch1tty://resume',
    };
  }

  // ── Prompts ───────────────────────────────────────────────────

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
        process.stderr.write(`[ch1tty] Failed to list prompts for ${config.id}: ${err}\n`);
        return [];
      }
    });

    const results = await Promise.allSettled(promptPromises);
    const backendPrompts = results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);

    // Native Ch1tty prompts — model/channel agnostic
    const nativePrompts = [
      {
        name: `${META_SERVER_ID}${SEPARATOR}resume`,
        description: '[ch1tty] Resume work — shows workstreams, active sessions, and synthesized context across all channels',
        arguments: [
          { name: 'topic', description: 'Optional: resume a specific topic or project', required: false },
          { name: 'entity', description: 'Optional: resume as a specific ChittyID', required: false },
        ],
      },
      {
        name: `${META_SERVER_ID}${SEPARATOR}session_context`,
        description: '[ch1tty] Current session context — active parallel sessions, uncommitted work, workstream state',
        arguments: [],
      },
    ];

    return {
      prompts: [...nativePrompts, ...backendPrompts],
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

    // ── Native Ch1tty prompts ──
    if (serverId === META_SERVER_ID) {
      return this.getNativePrompt(promptName, args);
    }

    const backend = this.backendFor(serverId);
    if (!backend) {
      throw new Error(`Unknown server "${serverId}" for prompt: ${namespacedName}`);
    }

    return backend.getPrompt(serverId, promptName, args);
  }

  /** Ask Ollama brain for routing decision */
  private async handleThink(args?: Record<string, unknown>): Promise<ToolCallResult> {
    const request = (args?.request as string) || '';
    if (!request) {
      return { content: [{ type: 'text', text: 'Provide a request to think about.' }], isError: true };
    }

    // Build context for Ollama
    const tools = (await this.listAllTools()).tools.map((t) => t.name);
    const backends = this.activeConfigs().map((c) => c.id);

    const decision = await this.ollama.route({
      request,
      availableTools: tools,
      activeBackends: backends,
      sessionInfo: {
        project: (args?.context as string) || undefined,
      },
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          strategy: decision.strategy,
          backend: decision.backend,
          tool: decision.tool,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          model: this.ollama.modelName,
        }, null, 2),
      }],
    };
  }

  /** Ollama brain health check */
  private async handleBrainStatus(): Promise<ToolCallResult> {
    const health = await this.ollama.health();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          brain: health.ok ? 'connected' : 'offline',
          model: health.model,
          availableModels: health.models,
          fallback: 'deterministic routing (keyword-based)',
        }, null, 2),
      }],
    };
  }

  /** Handle ledger write tools — writes to local buffer, daemon flushes to Neon */
  private async handleLedgerWrite(
    type: string,
    args?: Record<string, unknown>,
    _context?: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const bufferDir = path.join(os.homedir(), '.claude', 'chittycontext', 'buffers');
    await fs.mkdir(bufferDir, { recursive: true });

    const bufferFile = path.join(bufferDir, `session-${process.pid}.jsonl`);

    const event: Record<string, unknown> = {
      type,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      ...args,
    };

    // Append to session buffer (fast, local, ~1ms)
    await fs.appendFile(bufferFile, JSON.stringify(event) + '\n');

    const messages: Record<string, string> = {
      DECISION: `Decision logged: "${args?.decision || '?'}"`,
      EVENT: `Event logged: "${args?.action || '?'}"`,
      WORKSTREAM: `Workstream "${args?.workstream || '?'}" updated`,
      CHECKPOINT: `Checkpoint saved: "${args?.summary || 'session state'}"`,
    };

    return {
      content: [{
        type: 'text',
        text: messages[type] || `Logged ${type} event to session buffer. Daemon will flush to ChittyLedger.`,
      }],
    };
  }

  /** Native Ch1tty prompts — resume, session context */
  private async getNativePrompt(name: string, args?: Record<string, string>): Promise<{
    description?: string;
    messages: Array<{ role: string; content: ContentItem }>;
  }> {
    if (name === 'resume') {
      const resume = await this.getResumeContext();
      const sessions = resume.activeSessions as { sessions: unknown[]; byProject: Record<string, number> };
      const workstreams = resume.workstreams as { workstreams: unknown[] };

      let text = '# Resume Context\n\n';
      text += `## Active Sessions\n${JSON.stringify(sessions.byProject, null, 2)}\n\n`;
      text += `## Workstreams\n${JSON.stringify(workstreams.workstreams, null, 2)}\n\n`;

      if (resume.checkpoint) {
        text += `## Latest Checkpoint\n${(resume.checkpoint as { preview: string }).preview}\n`;
      }

      if (args?.topic) {
        text += `\n## Requested Topic: ${args.topic}\n`;
        text += 'Filter the above context to this topic and present relevant workstreams.\n';
      }

      return {
        description: 'Resume work from where you or any channel left off',
        messages: [{
          role: 'user',
          content: { type: 'text', text },
        }],
      };
    }

    if (name === 'session_context') {
      const sessions = await this.getActiveSessions();
      const workstreams = await this.getWorkstreams();

      let text = '# Current Session Context\n\n';
      text += `Active sessions: ${sessions.sessions.length}\n`;
      text += `By project: ${JSON.stringify(sessions.byProject)}\n\n`;

      if (sessions.sessions.length > 1) {
        text += '**WARNING: Parallel sessions active.** Check git diff --stat before modifying files.\n\n';
      }

      text += `Workstreams: ${JSON.stringify(workstreams, null, 2)}\n`;

      return {
        description: 'Current session awareness — parallel sessions, workstream state',
        messages: [{
          role: 'user',
          content: { type: 'text', text },
        }],
      };
    }

    throw new Error(`Unknown ch1tty prompt: ${name}`);
  }

  // ── Lifecycle ─────────────────────────────────────────────────

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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function missingArgResult(argName: string, toolName: string): ToolCallResult {
  return {
    content: [{ type: 'text', text: `The "${argName}" parameter is required for ${toolName}` }],
    isError: true,
  };
}

function toTaskContext(context?: ToolExecutionContext): {
  sessionId?: string;
  auth?: {
    clientId?: string;
    scopes?: string[];
    token?: string;
  };
} {
  return {
    sessionId: context?.sessionId,
    auth: context?.authInfo
      ? {
          clientId: context.authInfo.clientId,
          scopes: context.authInfo.scopes,
          token: context.authInfo.token,
        }
      : undefined,
  };
}
