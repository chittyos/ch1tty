// Real CommsDispatch — the late-binding seam to ch1tty MCP backends.
//
// Each backend (quo, gmail, …) is reached over Streamable HTTP MCP using an
// endpoint + token sourced from per-backend env vars, mirroring the auth approach
// in src/remote-proxy.ts. If a backend's endpoint/token env is ABSENT, or the call
// FAILS, this throws — the combo turns that into channelsQueried[].ok=false for the
// channel. NEVER a silent fallback, NEVER fake data.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CommsDispatch } from './types.js';

/** Per-backend connection env. mcpServerId → env var prefix. */
function envPrefix(mcpServerId: string): string {
  // chittyagent-quo → COMMS_MCP_CHITTYAGENT_QUO_*
  return `COMMS_MCP_${mcpServerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function backendConfig(mcpServerId: string): { endpoint: string; token?: string; cfId?: string; cfSecret?: string } {
  const p = envPrefix(mcpServerId);
  const endpoint = process.env[`${p}_ENDPOINT`];
  if (!endpoint) {
    throw new Error(
      `no endpoint for backend '${mcpServerId}': set ${p}_ENDPOINT (no silent fallback)`,
    );
  }
  return {
    endpoint,
    token: process.env[`${p}_TOKEN`],
    cfId: process.env[`${p}_CF_ACCESS_CLIENT_ID`] ?? process.env.CF_ACCESS_CLIENT_ID,
    cfSecret: process.env[`${p}_CF_ACCESS_CLIENT_SECRET`] ?? process.env.CF_ACCESS_CLIENT_SECRET,
  };
}

function getTimeoutMs(): number {
  const v = parseInt(process.env.CH1TTY_REMOTE_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 120_000;
}

export class McpClientDispatch implements CommsDispatch {
  private clients = new Map<string, Promise<Client>>();

  private connect(mcpServerId: string): Promise<Client> {
    const existing = this.clients.get(mcpServerId);
    if (existing) return existing;

    const promise = (async () => {
      const cfg = backendConfig(mcpServerId);
      const headers: Record<string, string> = {};
      if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;
      if (cfg.cfId) headers['CF-Access-Client-Id'] = cfg.cfId;
      if (cfg.cfSecret) headers['CF-Access-Client-Secret'] = cfg.cfSecret;

      const transport = new StreamableHTTPClientTransport(new URL(cfg.endpoint), {
        requestInit: { headers },
      });
      const client = new Client(
        { name: `comms-mcp-dispatch-${mcpServerId}`, version: '1.0.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
      return client;
    })();

    this.clients.set(mcpServerId, promise);
    promise.catch(() => this.clients.delete(mcpServerId));
    return promise;
  }

  async call(mcpServerId: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connect(mcpServerId);
    const timeout = getTimeoutMs();
    const result = await Promise.race([
      client.callTool({ name: tool, arguments: args }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`callTool ${mcpServerId}/${tool} timed out after ${timeout}ms`)), timeout),
      ),
    ]);
    if ((result as { isError?: boolean }).isError) {
      throw new Error(`backend ${mcpServerId}/${tool} returned isError: ${JSON.stringify((result as { content?: unknown }).content)}`);
    }
    return result;
  }

  async close(): Promise<void> {
    for (const [, p] of this.clients) {
      try {
        const c = await p;
        await c.close();
      } catch {
        /* best-effort */
      }
    }
    this.clients.clear();
  }
}
