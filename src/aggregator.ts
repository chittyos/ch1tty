import type {
  ServerAccess,
  ServerCategory,
  ServerConfig,
  ResourceEntry,
  ResourceTemplateEntry,
  PromptEntry,
  ServerStatus,
} from './types.js';
import { ChildManager } from './child-manager.js';
import { RemoteProxy } from './remote-proxy.js';
import { loadConfigFromPath } from './config.js';

const SEPARATOR = '/';
const META_SERVER_ID = 'ch1tty';

export interface AggregatorOptions {
  accessFilter?: ServerAccess;
  categoryFilter?: ServerCategory;
  configPath?: string;
}

export class Aggregator {
  private childManager = new ChildManager();
  private remoteProxy = new RemoteProxy();
  private configs: ServerConfig[];
  private accessFilter?: ServerAccess;
  private categoryFilter?: ServerCategory;
  private configPath?: string;
  private startedAt = Date.now();

  constructor(configs: ServerConfig[], options?: AggregatorOptions) {
    this.accessFilter = options?.accessFilter;
    this.categoryFilter = options?.categoryFilter;
    this.configPath = options?.configPath;
    this.configs = configs;

    for (const config of this.activeConfigs()) {
      if (config.type === 'local') {
        this.childManager.registerServer(config);
      } else {
        this.remoteProxy.registerServer(config);
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
    ];
  }

  private async handleMetaTool(
    toolName: string,
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    switch (toolName) {
      case 'status':
        return this.handleStatus();
      case 'reload':
        return this.handleReload();
      default:
        return {
          content: [{ type: 'text', text: `Unknown meta-tool: ${toolName}` }],
          isError: true,
        };
    }
  }

  private async handleStatus(): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    const statuses: ServerStatus[] = this.activeConfigs().map((config) => {
      const backend = config.type === 'local'
        ? this.childManager.getStatus(config.id)
        : this.remoteProxy.getStatus(config.id);

      return {
        id: config.id,
        name: config.name,
        type: config.type,
        enabled: config.enabled !== false,
        ...backend,
      };
    });

    const summary = {
      gateway: 'ch1tty',
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      totalServers: statuses.length,
      connectedServers: statuses.filter((s) => s.connected).length,
      totalTools: statuses.reduce((sum, s) => sum + s.toolCount, 0),
      servers: statuses,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
    };
  }

  private async handleReload(): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
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

      // Shutdown removed servers
      for (const config of removed) {
        if (config.type === 'local') {
          // ChildManager doesn't have per-server shutdown, but new instance won't include them
        }
      }

      // Rebuild managers
      await this.shutdown();
      this.configs = newConfig.servers;

      const newChildManager = new ChildManager();
      const newRemoteProxy = new RemoteProxy();

      for (const config of this.activeConfigs()) {
        if (config.type === 'local') {
          newChildManager.registerServer(config);
        } else {
          newRemoteProxy.registerServer(config);
        }
      }

      this.childManager = newChildManager;
      this.remoteProxy = newRemoteProxy;

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
        const tools = config.type === 'local'
          ? await this.childManager.listTools(config.id)
          : await this.remoteProxy.listTools(config.id);

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

    // Prepend meta-tools
    return { tools: [...this.metaTools(), ...tools] };
  }

  async callTool(
    namespacedName: string,
    args: Record<string, unknown> = {},
  ): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> {
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

    // Handle meta-tools
    if (serverId === META_SERVER_ID) {
      return this.handleMetaTool(toolName);
    }

    if (this.childManager.isRegistered(serverId)) {
      try {
        return await this.childManager.callTool(serverId, toolName, args);
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Tool call failed for ${serverId}/${toolName}: ${String(err)}` }],
          isError: true,
        };
      }
    }

    if (this.remoteProxy.isRegistered(serverId)) {
      try {
        return await this.remoteProxy.callTool(serverId, toolName, args);
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Tool call failed for ${serverId}/${toolName}: ${String(err)}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Unknown server "${serverId}". Known servers: ${knownServers}`,
      }],
      isError: true,
    };
  }

  // ── Resources ─────────────────────────────────────────────────

  async listAllResources(): Promise<{
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  }> {
    const resourcePromises = this.activeConfigs().map(async (config) => {
      try {
        const { resources } = config.type === 'local'
          ? await this.childManager.listResources(config.id)
          : await this.remoteProxy.listResources(config.id);

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
    const resources = results.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    );

    return { resources };
  }

  async listAllResourceTemplates(): Promise<{
    resourceTemplates: Array<{ uriTemplate: string; name: string; description?: string; mimeType?: string }>;
  }> {
    const templatePromises = this.activeConfigs().map(async (config) => {
      try {
        const { templates } = config.type === 'local'
          ? await this.childManager.listResources(config.id)
          : await this.remoteProxy.listResources(config.id);

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
    const resourceTemplates = results.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    );

    return { resourceTemplates };
  }

  async readResource(uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }> {
    // Parse namespaced URI: serverId://originalUri
    const match = uri.match(/^([^:]+):\/\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid namespaced resource URI: ${uri}`);
    }

    const [, serverId, originalUri] = match;

    if (this.childManager.isRegistered(serverId)) {
      return this.childManager.readResource(serverId, originalUri);
    }

    if (this.remoteProxy.isRegistered(serverId)) {
      return this.remoteProxy.readResource(serverId, originalUri);
    }

    throw new Error(`Unknown server "${serverId}" in resource URI: ${uri}`);
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
        const prompts = config.type === 'local'
          ? await this.childManager.listPrompts(config.id)
          : await this.remoteProxy.listPrompts(config.id);

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
    const prompts = results.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    );

    return { prompts };
  }

  async getPrompt(namespacedName: string, args?: Record<string, string>): Promise<{
    description?: string;
    messages: Array<{ role: string; content: { type: string; text: string } }>;
  }> {
    const sepIndex = namespacedName.indexOf(SEPARATOR);
    if (sepIndex === -1) {
      throw new Error(`Invalid prompt name "${namespacedName}". Expected format: serverId/promptName`);
    }

    const serverId = namespacedName.slice(0, sepIndex);
    const promptName = namespacedName.slice(sepIndex + 1);

    if (this.childManager.isRegistered(serverId)) {
      return this.childManager.getPrompt(serverId, promptName, args);
    }

    if (this.remoteProxy.isRegistered(serverId)) {
      return this.remoteProxy.getPrompt(serverId, promptName, args);
    }

    throw new Error(`Unknown server "${serverId}" for prompt: ${namespacedName}`);
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    await Promise.allSettled([
      this.childManager.shutdown(),
      this.remoteProxy.shutdown(),
    ]);
  }
}
