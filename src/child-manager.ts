import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const execFileAsync = promisify(execFile);
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
const SPAWN_TIMEOUT_MS = 30_000; // 30s to spawn + connect
const LIST_TIMEOUT_MS = 15_000; // 15s to list tools after connected

export class ChildManager {
  private children = new Map<string, ChildConnection>();
  private configs = new Map<string, ServerConfig>();
  private connecting = new Map<string, Promise<ChildConnection>>();
  private opAvailable: boolean | null = null;

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

  private async isOpAvailable(): Promise<boolean> {
    if (this.opAvailable !== null) return this.opAvailable;
    try {
      await execFileAsync('op', ['whoami'], { timeout: 5_000 });
      this.opAvailable = true;
    } catch {
      // Fall back to Connect server mode (op whoami doesn't support Connect)
      if (process.env.OP_CONNECT_HOST && process.env.OP_CONNECT_TOKEN) {
        try {
          await execFileAsync('op', ['vault', 'list', '--format=json'], { timeout: 5_000 });
          this.opAvailable = true;
        } catch {
          this.opAvailable = false;
        }
      } else {
        this.opAvailable = false;
      }
    }
    return this.opAvailable;
  }

  private async resolveEnv(config: ServerConfig): Promise<Record<string, string>> {
    const configEnv = config.env || {};

    // Resolve 1Password op:// references from config.env only (not process.env)
    const resolved: Record<string, string> = { ...configEnv };
    const opKeys = Object.entries(configEnv).filter(([, v]) => v.startsWith('op://'));
    if (opKeys.length > 0) {
      // Check op CLI availability once (cached) to avoid noisy errors on
      // machines where 1Password isn't configured
      if (!(await this.isOpAvailable())) {
        process.stderr.write(
          `[ch1tty:${config.id}] 1Password CLI not configured — skipping op:// env resolution\n`,
        );
        for (const [key] of opKeys) {
          delete resolved[key];
        }
      } else {
        const results = await Promise.allSettled(
          opKeys.map(async ([key, ref]) => {
            const { stdout } = await execFileAsync('op', ['read', ref], { timeout: 30_000 });
            return { key, value: stdout.trim() };
          }),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            resolved[result.value.key] = result.value.value;
          } else {
            process.stderr.write(
              `[ch1tty:${config.id}] Failed to resolve env from 1Password: ${result.reason}\n`,
            );
          }
        }
      }
    }

    return {
      ...process.env as Record<string, string>,
      ...resolved,
    };
  }

  private async doSpawn(config: ServerConfig): Promise<ChildConnection> {
    const env = await this.resolveEnv(config);

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

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  async listTools(serverId: string): Promise<ToolEntry[]> {
    const config = this.configs.get(serverId);
    if (!config) return [];

    // Check cache before spawning
    const existing = this.children.get(serverId);
    if (existing?.toolCache && Date.now() < existing.toolCache.expiresAt) {
      return existing.toolCache.tools;
    }

    // Spawn with timeout
    const conn = await this.withTimeout(
      this.spawn(serverId),
      SPAWN_TIMEOUT_MS,
      `spawn ${serverId}`,
    );

    // List tools with timeout
    const result = await this.withTimeout(
      conn.client.listTools(),
      LIST_TIMEOUT_MS,
      `listTools ${serverId}`,
    );

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
