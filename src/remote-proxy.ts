import { execFileSync } from 'node:child_process';
import type { ServerConfig } from './types.js';

interface ToolEntry {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface JsonRpcError {
  message?: string;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: JsonRpcError;
}

const TOOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TOKEN_CACHE_TTL = 11 * 60 * 60 * 1000; // 11 hours (tokens last 12hr)
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

function resolveHttpTimeoutMs(): number {
  const raw = process.env.CH1TTY_HTTP_TIMEOUT_MS;
  if (!raw) return DEFAULT_HTTP_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    process.stderr.write(
      `[ch1tty] Ignoring invalid CH1TTY_HTTP_TIMEOUT_MS="${raw}", using ${DEFAULT_HTTP_TIMEOUT_MS}\n`,
    );
    return DEFAULT_HTTP_TIMEOUT_MS;
  }

  return parsed;
}

export class RemoteProxy {
  private configs = new Map<string, ServerConfig>();
  private toolCaches = new Map<string, { tools: ToolEntry[]; expiresAt: number }>();
  private tokenCaches = new Map<string, TokenCache>();
  private httpTimeoutMs = resolveHttpTimeoutMs();

  registerServer(config: ServerConfig): void {
    if (config.type !== 'remote') return;
    this.configs.set(config.id, config);
  }

  private getAuthToken(config: ServerConfig): string | null {
    if (!config.authTokenKey) return null;

    const cached = this.tokenCaches.get(config.id);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    try {
      const token = execFileSync('chitty-mcp-token', [config.authTokenKey], {
        encoding: 'utf-8',
        timeout: 10_000,
      }).trim();

      this.tokenCaches.set(config.id, {
        token,
        expiresAt: Date.now() + TOKEN_CACHE_TTL,
      });

      return token;
    } catch (err) {
      process.stderr.write(
        `[ch1tty:${config.id}] Failed to get auth token: ${err}\n`,
      );
      return null;
    }
  }

  private buildHeaders(config: ServerConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const token = this.getAuthToken(config);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  private async fetchWithTimeout(
    endpoint: string,
    init: Omit<RequestInit, 'signal'>,
    action: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.httpTimeoutMs);

    try {
      return await fetch(endpoint, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`${action} timed out after ${this.httpTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseSseJson(text: string): JsonRpcResponse {
    const lines = text.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line !== '' && line !== '[DONE]');

    if (dataLines.length === 0) {
      throw new Error('SSE response did not include a JSON data event');
    }

    let parseError: unknown = null;
    for (const payload of dataLines) {
      try {
        return JSON.parse(payload) as JsonRpcResponse;
      } catch (err) {
        parseError = err;
      }
    }

    throw new Error(`Unable to parse SSE JSON payload: ${String(parseError)}`);
  }

  private async parseJsonRpcResponse(response: Response): Promise<JsonRpcResponse> {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      return this.parseSseJson(text);
    }

    try {
      return await response.json() as JsonRpcResponse;
    } catch (err) {
      throw new Error(`Invalid JSON response: ${String(err)}`);
    }
  }

  async listTools(serverId: string): Promise<ToolEntry[]> {
    const config = this.configs.get(serverId);
    if (!config?.endpoint) return [];

    const cached = this.toolCaches.get(serverId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.tools;
    }

    try {
      const headers = this.buildHeaders(config);

      // MCP Streamable HTTP: POST with JSON-RPC to the endpoint
      const response = await this.fetchWithTimeout(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      }, `tools/list for ${serverId}`);

      if (!response.ok) {
        process.stderr.write(
          `[ch1tty:${serverId}] Tool list fetch failed: ${response.status} ${response.statusText}\n`,
        );
        return [];
      }

      const data = await this.parseJsonRpcResponse(response);
      if (data.error) {
        process.stderr.write(
          `[ch1tty:${serverId}] Tool list remote error: ${data.error.message || 'Unknown remote error'}\n`,
        );
        return [];
      }

      const result = data.result as { tools?: ToolEntry[] } | undefined;
      const toolsRaw = Array.isArray(result?.tools) ? result.tools : [];
      const tools: ToolEntry[] = toolsRaw.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      this.toolCaches.set(serverId, { tools, expiresAt: Date.now() + TOOL_CACHE_TTL });
      return tools;
    } catch (err) {
      process.stderr.write(`[ch1tty:${serverId}] Tool list error: ${err}\n`);
      return [];
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> = {}): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> {
    const config = this.configs.get(serverId);
    if (!config?.endpoint) {
      return {
        content: [{ type: 'text', text: `Unknown remote server: ${serverId}` }],
        isError: true,
      };
    }

    try {
      const headers = this.buildHeaders(config);

      const response = await this.fetchWithTimeout(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        }),
      }, `tools/call for ${serverId}/${toolName}`);

      if (!response.ok) {
        return {
          content: [{ type: 'text', text: `Remote call failed: ${response.status} ${response.statusText}` }],
          isError: true,
        };
      }

      const data = await this.parseJsonRpcResponse(response);
      if (data.error) {
        return {
          content: [{ type: 'text', text: `Remote error: ${data.error.message || 'Unknown remote error'}` }],
          isError: true,
        };
      }

      const result = data.result as { content?: Array<{ type: string; text: string }>; isError?: boolean } | undefined;
      const content = Array.isArray(result?.content)
        ? result.content
        : [{ type: 'text', text: 'No content returned' }];

      return {
        content,
        isError: result?.isError ?? false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Remote call error: ${String(err)}` }],
        isError: true,
      };
    }
  }

  isRegistered(serverId: string): boolean {
    return this.configs.has(serverId);
  }
}
