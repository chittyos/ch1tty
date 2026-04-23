/**
 * ChittyAgent Ch1tty — OAuth-protected MCP portal gateway
 *
 * Proxies the 5 slim-MCP meta-tools from ch1tty.chitty.cc/mcp via direct
 * MCP Streamable HTTP fetch. All backend tool aggregation is handled by
 * the ch1tty gateway — this worker is just OAuth + transport for external
 * clients (ChatGPT, etc).
 *
 * @canonical-uri chittycanon://core/services/chittyagent-ch1tty
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { routeAgentRequest } from "agents";
import OAuthProvider, { type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";

interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
  CH1TTY_UPSTREAM: string;
  CH1TTY_MCP_TOKEN: string;
  SERVICE_NAME: string;
  SERVICE_VERSION: string;
  OAUTH_PROVIDER: OAuthHelpers;
}

// ── MCP Streamable HTTP client ───────────────────────────────────

interface UpstreamSession {
  url: string;
  sessionId: string;
  token: string;
}

const MCP_ACCEPT = "application/json, text/event-stream";

function parseSSE(body: string): unknown | null {
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      try { return JSON.parse(line.slice(6)); } catch { /* skip */ }
    }
  }
  return null;
}

async function mcpFetch(
  url: string,
  body: Record<string, unknown>,
  token: string,
  sessionId?: string,
): Promise<{ data: unknown; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": MCP_ACCEPT,
    "Authorization": `Bearer ${token}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const newSessionId = res.headers.get("mcp-session-id") || sessionId;
  const text = await res.text();

  const ct = res.headers.get("content-type") || "";
  let data: unknown;
  if (ct.includes("text/event-stream")) {
    data = parseSSE(text);
  } else {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  return { data, sessionId: newSessionId || undefined };
}

async function initUpstream(url: string, token: string): Promise<UpstreamSession | null> {
  try {
    const { sessionId } = await mcpFetch(url, {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "chittyagent-ch1tty", version: "3.0.0" },
      },
      id: 1,
    }, token);

    if (!sessionId) return null;

    await mcpFetch(url, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }, token, sessionId);

    return { url, sessionId, token };
  } catch {
    return null;
  }
}

async function callUpstreamTool(
  session: UpstreamSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { data } = await mcpFetch(session.url, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
    id: Date.now(),
  }, session.token, session.sessionId);

  const result = data as {
    result?: { content?: Array<{ type: string; text: string }> };
    error?: { message: string };
  };

  if (result?.error) {
    return { content: [{ type: "text" as const, text: `Error: ${result.error.message}` }] };
  }

  const content = result?.result?.content?.map(c => ({
    type: "text" as const,
    text: c.text,
  })) || [{ type: "text" as const, text: "No result" }];

  return { content };
}

// ── Zod schemas for the 5 slim-MCP tools ─────────────────────────

const SearchSchema = {
  query: z.string().optional().describe("Search keywords matched against tool names and descriptions"),
  server: z.string().optional().describe("Filter by server id (e.g. \"neon\", \"chittyos\")"),
  category: z.string().optional().describe("Filter by category (ecosystem, code, search, reasoning, desktop, documents, communication)"),
  limit: z.number().optional().describe("Max results to return (default 20)"),
};

const ExecuteSchema = {
  tool: z.string().describe("Namespaced tool name from search results (e.g. \"neon/list_projects\")"),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments to pass to the tool"),
};

const CastSchema = {
  intent: z.string().describe("Natural language description of what you want accomplished"),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments to pass to the resolved tool (if known)"),
  confirm: z.boolean().optional().describe("If true, return the execution plan without running it (default: false)"),
};

// ── McpAgent: proxies 5 slim-MCP tools from ch1tty gateway ──────

export class ChittyMcpAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "chittyagent-ch1tty",
    version: "3.0.0",
  });

  private upstream: UpstreamSession | null = null;

  // Lazy upstream connection — creates or reuses session
  private async getUpstream(): Promise<UpstreamSession> {
    if (this.upstream) {
      // Test if session is still alive with a lightweight call
      try {
        const { data } = await mcpFetch(this.upstream.url, {
          jsonrpc: "2.0",
          method: "tools/list",
          id: Date.now(),
        }, this.upstream.token, this.upstream.sessionId);
        const result = data as { result?: unknown; error?: unknown };
        if (result?.result) return this.upstream;
      } catch { /* session dead, reconnect */ }
    }

    const url = this.env.CH1TTY_UPSTREAM || "https://ch1tty.chitty.cc/mcp";
    const token = this.env.CH1TTY_MCP_TOKEN || "";
    const session = await initUpstream(url, token);
    if (!session) {
      throw new Error(`Failed to connect to upstream ${url} (token: ${token.length} chars)`);
    }
    this.upstream = session;
    return session;
  }

  async init() {
    const self = this;

    const proxy = async (toolName: string, args: Record<string, unknown>) => {
      try {
        const session = await self.getUpstream();
        return await callUpstreamTool(session, toolName, args);
      } catch (e: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(e)}` }],
          isError: true as const,
        };
      }
    };

    this.server.tool(
      "search",
      "Search the tool registry. Returns matching tool names, descriptions, and input schemas. Use before execute.",
      SearchSchema,
      async (args) => proxy("ch1tty/search", args),
    );

    this.server.tool(
      "execute",
      "Execute a tool by its namespaced name (serverId/toolName). Use search to discover available tools first.",
      ExecuteSchema,
      async (args) => proxy("ch1tty/execute", args),
    );

    this.server.tool(
      "status",
      "Gateway status — connected servers, tool counts, cache ages",
      async () => proxy("ch1tty/status", {}),
    );

    this.server.tool(
      "reload",
      "Hot-reload servers.json without restarting the gateway",
      async () => proxy("ch1tty/reload", {}),
    );

    this.server.tool(
      "cast",
      "Describe what you want done in natural language. Ch1tty searches its full surface, resolves intent, and executes the best tool match.",
      CastSchema,
      async (args) => proxy("ch1tty/cast", args),
    );

    // Diagnostics — doesn't need upstream
    this.server.tool("gateway_status", "Returns gateway health, tests upstream connection, and reports any errors", async () => {
      const upstreamUrl = self.env.CH1TTY_UPSTREAM || "https://ch1tty.chitty.cc/mcp";
      const hasToken = !!self.env.CH1TTY_MCP_TOKEN;
      let connectTest: string;
      let connectError: string | null = null;

      try {
        const session = await self.getUpstream();
        connectTest = "ok";
      } catch (e: unknown) {
        connectTest = "failed";
        connectError = String(e);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "ok",
            service: "chittyagent-ch1tty",
            upstreamUrl,
            hasToken,
            tokenLength: self.env.CH1TTY_MCP_TOKEN?.length || 0,
            upstreamConnected: !!self.upstream,
            upstreamSessionId: self.upstream?.sessionId || null,
            connectTest,
            connectError,
          }, null, 2),
        }],
      };
    });
  }
}

// ── Non-MCP routes ───────────────────────────────────────────────

const DefaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "chittyagent-ch1tty",
        version: env.SERVICE_VERSION || "3.0.0",
      });
    }

    if (url.pathname === "/api/v1/status") {
      return Response.json({
        status: "ok",
        service: "chittyagent-ch1tty",
        version: env.SERVICE_VERSION || "3.0.0",
        upstream: env.CH1TTY_UPSTREAM || "https://ch1tty.chitty.cc/mcp",
        transport: "streamable-http",
        auth: "oauth2.1",
        hasToken: !!(env.CH1TTY_MCP_TOKEN),
        tokenLength: env.CH1TTY_MCP_TOKEN?.length || 0,
      });
    }

    if (url.pathname === "/api/v1/upstream-test") {
      const upstreamUrl = env.CH1TTY_UPSTREAM || "https://ch1tty.chitty.cc/mcp";
      const token = env.CH1TTY_MCP_TOKEN || "";
      try {
        const session = await initUpstream(upstreamUrl, token);
        if (!session) {
          return Response.json({ error: "initUpstream returned null", hasToken: !!token, tokenLen: token.length, upstreamUrl });
        }
        const { data } = await mcpFetch(session.url, { jsonrpc: "2.0", method: "tools/list", id: 2 }, session.token, session.sessionId);
        const toolsResult = data as { result?: { tools?: Array<{ name: string }> } };
        const tools = toolsResult?.result?.tools || [];
        return Response.json({ ok: true, sessionId: session.sessionId, toolCount: tools.length, tools: tools.map((t: { name: string }) => t.name) });
      } catch (e: unknown) {
        return Response.json({ error: String(e), hasToken: !!token, tokenLen: token.length, upstreamUrl }, { status: 500 });
      }
    }

    if (url.pathname === "/oauth/approve") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: oauthReq.clientId,
        metadata: { label: oauthReq.clientId },
        scope: oauthReq.scope,
        props: { clientId: oauthReq.clientId },
      });
      return Response.redirect(redirectTo, 302);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response("Not Found", { status: 404 });
  },
};

export default new OAuthProvider({
  apiRoute: ["/mcp", "/sse"],
  apiHandler: ChittyMcpAgent.serve("/mcp"),
  defaultHandler: DefaultHandler,
  authorizeEndpoint: "/oauth/approve",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
});
