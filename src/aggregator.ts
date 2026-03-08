import type { ServerAccess, ServerCategory, ServerConfig } from './types.js';
import { ChildManager } from './child-manager.js';
import { RemoteProxy } from './remote-proxy.js';

const SEPARATOR = '/';

export interface AggregatorOptions {
  accessFilter?: ServerAccess;
  categoryFilter?: ServerCategory;
}

export class Aggregator {
  private childManager = new ChildManager();
  private remoteProxy = new RemoteProxy();
  private configs: ServerConfig[];
  private accessFilter?: ServerAccess;
  private categoryFilter?: ServerCategory;

  constructor(configs: ServerConfig[], options?: AggregatorOptions) {
    this.accessFilter = options?.accessFilter;
    this.categoryFilter = options?.categoryFilter;
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
      if (this.accessFilter && c.access !== this.accessFilter) return false;
      if (this.categoryFilter && c.category !== this.categoryFilter) return false;
      return true;
    });
  }

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

    return { tools };
  }

  async callTool(
    namespacedName: string,
    args: Record<string, unknown> = {},
  ): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> {
    const sepIndex = namespacedName.indexOf(SEPARATOR);
    const knownServers = this.configs.map((config) => config.id).join(', ') || '(none)';
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

  async shutdown(): Promise<void> {
    await this.childManager.shutdown();
  }
}
