import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ServerConfig } from './types.js';

interface ChildConnection {
  client: Client;
  transport: StdioClientTransport;
  toolCache: { tools: ToolEntry[]; expiresAt: number } | null;
}

interface ToolEntry {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class ChildManager {
  private children = new Map<string, ChildConnection>();
  private configs = new Map<string, ServerConfig>();
  private connecting = new Map<string, Promise<ChildConnection>>();

  registerServer(config: ServerConfig): void {
    if (config.type !== 'local') return;
    this.configs.set(config.id, config);
  }

  private async spawn(serverId: string): Promise<ChildConnection> {
    const config = this.configs.get(serverId);
    if (!config) throw new Error(`Unknown local server: ${serverId}`);
    if (!config.command) throw new Error(`No command configured for server: ${serverId}`);

    const existing = this.children.get(serverId);
    if (existing) return existing;

    // Prevent concurrent spawns for the same server
    const pending = this.connecting.get(serverId);
    if (pending) return pending;

    const promise = this.doSpawn(config);
    this.connecting.set(serverId, promise);

    try {
      const conn = await promise;
      this.children.set(serverId, conn);
      return conn;
    } finally {
      this.connecting.delete(serverId);
    }
  }

  private async doSpawn(config: ServerConfig): Promise<ChildConnection> {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...(config.env || {}),
    };

    const transport = new StdioClientTransport({
      command: config.command!,
      args: config.args || [],
      env,
      stderr: 'pipe',
    });

    const client = new Client(
      { name: `ch1tty-child-${config.id}`, version: '1.0.0' },
      { capabilities: {} },
    );

    // Log child stderr for debugging
    const stderr = transport.stderr;
    if (stderr) {
      const readable = stderr as import('node:stream').Readable;
      readable.on('data', (chunk: Buffer) => {
        process.stderr.write(`[ch1tty:${config.id}] ${chunk.toString()}`);
      });
    }

    await client.connect(transport);
    return { client, transport, toolCache: null };
  }

  async listTools(serverId: string): Promise<ToolEntry[]> {
    const config = this.configs.get(serverId);
    if (!config) return [];

    // For lazy servers not yet spawned, spawn to discover tools
    const conn = await this.spawn(serverId);

    // Check cache
    if (conn.toolCache && Date.now() < conn.toolCache.expiresAt) {
      return conn.toolCache.tools;
    }

    const result = await conn.client.listTools();
    const tools: ToolEntry[] = result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    conn.toolCache = { tools, expiresAt: Date.now() + TOOL_CACHE_TTL };
    return tools;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> = {}): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> {
    const conn = await this.spawn(serverId);
    const result = await conn.client.callTool({ name: toolName, arguments: args });

    // Normalize the result shape
    if ('content' in result) {
      return {
        content: (result.content as Array<{ type: string; text: string }>),
        isError: (result.isError as boolean | undefined) ?? false,
      };
    }

    // Legacy toolResult format
    return {
      content: [{ type: 'text', text: JSON.stringify((result as { toolResult: unknown }).toolResult) }],
      isError: false,
    };
  }

  isRegistered(serverId: string): boolean {
    return this.configs.has(serverId);
  }

  async shutdown(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [id, conn] of this.children) {
      closePromises.push(
        conn.client.close().catch((err) => {
          process.stderr.write(`[ch1tty] Error closing ${id}: ${err}\n`);
        }),
      );
    }

    await Promise.allSettled(closePromises);
    this.children.clear();
    this.connecting.clear();
  }
}
