/**
 * ChittyAgent Ch1tty — OAuth-protected MCP portal gateway
 *
 * Uses Agents SDK McpAgent for MCP transport + @cloudflare/workers-oauth-provider
 * for OAuth 2.1 server. Proxies all tool calls to ch1tty.com/mcp + all
 * chittyentity cloud agents that expose MCP endpoints.
 *
 * Endpoints:
 *   GET  /health           — liveness
 *   GET  /api/v1/status    — service status
 *   *    /mcp              — MCP Streamable HTTP (OAuth-protected)
 *   GET  /authorize        — OAuth authorization
 *   POST /token            — OAuth token exchange
 *   POST /register         — OAuth dynamic client registration
 *
 * @canonical-uri chittycanon://core/services/chittyagent-ch1tty
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { routeAgentRequest } from "agents";
import OAuthProvider, { type OAuthHelpers } from "@cloudflare/workers-oauth-provider";

interface Env {
  MCP_AGENT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
  POLICY_KV: KVNamespace;
  AGENT_ORCHESTRATOR: Fetcher;
  AGENT_ALCHEMIST: Fetcher;
  CH1TTY_UPSTREAM: string;
  SERVICE_NAME: string;
  SERVICE_VERSION: string;
  OAUTH_PROVIDER: OAuthHelpers;
}

// ── Policy engine: server-side hookify for all channels ──────────
// Claude Code has client-side hooks. Every other channel gets
// policy enforcement HERE, at the gateway layer.
// Policies sync from orchestrator hook-registry KV.

interface PolicyRule {
  id: string;
  name: string;
  enabled: boolean;
  event: string;    // "tool_call" | "tool_result" | "prompt"
  action: string;   // "block" | "suggest" | "log"
  pattern: string;  // regex to match against tool name or content
  body: string;     // message to return on block
}

async function loadPolicies(kv: KVNamespace): Promise<PolicyRule[]> {
  try {
    const raw = await kv.get("gateway:policies", { cacheTtl: 300 });
    if (raw) return JSON.parse(raw);
  } catch { /* best effort */ }
  return [];
}

function evaluatePolicy(
  policies: PolicyRule[],
  toolName: string,
  event: string,
): { allowed: boolean; rule?: PolicyRule } {
  for (const rule of policies) {
    if (!rule.enabled || rule.event !== event) continue;
    try {
      const regex = new RegExp(rule.pattern, "i");
      if (regex.test(toolName)) {
        if (rule.action === "block") {
          return { allowed: false, rule };
        }
      }
    } catch { /* skip invalid regex */ }
  }
  return { allowed: true };
}

// Agents with native MCP endpoints (McpAgent-based)
const AGENT_MCP_UPSTREAMS = [
  { id: "dispute", url: "https://dispute.agent.chitty.cc/mcp" },
  { id: "notes", url: "https://notes.agent.chitty.cc/mcp" },
  { id: "orchestrator", url: "https://orchestrator.agent.chitty.cc/mcp" },
  { id: "ship", url: "https://ship.agent.chitty.cc/mcp" },
  // Comms platform agents (PlatformAgent subclasses, migration 003)
  //   { id: "quo", url: "https://quo.agent.chitty.cc/mcp" },
  //   { id: "twilio", url: "https://twilio.agent.chitty.cc/mcp" },
  //   { id: "bluebubbles", url: "https://bluebubbles.agent.chitty.cc/mcp" },
] as const;

// ── McpAgent: proxies tools from ch1tty + all cloud agents ───────

export class ChittyMcpAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "chittyagent-ch1tty",
    version: "3.0.0",
  });

  private policies: PolicyRule[] = [];

  async init() {
    // Load gateway policies from KV (synced from orchestrator hook-registry)
    this.policies = await loadPolicies(this.env.POLICY_KV);

    // Primary: ch1tty VM aggregator (Neon, Playwright, Filesystem, etc.)
    const upstream = this.env.CH1TTY_UPSTREAM || "https://ch1tty.chitty.cc/mcp";
    try {
      await this.addMcpServer("ch1tty", upstream);
    } catch (e) {
      console.error("Failed to add ch1tty upstream:", e);
    }

    // Cloud agents with native MCP endpoints — best-effort, skip failures
    for (const agent of AGENT_MCP_UPSTREAMS) {
      try {
        await this.addMcpServer(agent.id, agent.url);
      } catch (e) {
        console.error(`Failed to add agent ${agent.id}:`, e);
      }
    }

    // Sync policies from orchestrator registry (background, best-effort)
    this.syncPolicies().catch(() => {});
  }

  // Pull latest policies from orchestrator hook-registry
  private async syncPolicies(): Promise<void> {
    try {
      const res = await this.env.AGENT_ORCHESTRATOR.fetch(
        new Request("https://internal/api/v1/registry/hooks"),
      );
      if (res.ok) {
        const registry = await res.json() as { hooks?: Array<Record<string, unknown>> };
        const hooks = registry.hooks || [];

        // Convert hook-registry entries to gateway policy rules
        const policies: PolicyRule[] = hooks
          .filter((h) => h.enabled && (h.event === "tool_call" || h.event === "stop"))
          .map((h) => ({
            id: h.id as string,
            name: h.name as string,
            enabled: h.enabled as boolean,
            event: "tool_call",
            action: h.action as string,
            pattern: h.pattern as string,
            body: h.body as string,
          }));

        await this.env.POLICY_KV.put("gateway:policies", JSON.stringify(policies));
        this.policies = policies;
      }
    } catch { /* best effort — use cached policies */ }
  }

  // Forward telemetry to Alchemist (fire-and-forget)
  private logToolCall(toolName: string, success: boolean, error?: string): void {
    try {
      this.env.AGENT_ALCHEMIST.fetch(
        new Request("https://internal/api/v1/hook-event", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Agent-From": this.env.SERVICE_NAME },
          body: JSON.stringify({
            hook_type: "GatewayToolCall",
            tool_name: toolName,
            success,
            error,
            session_id: this.name, // DO instance name = session
          }),
        }),
      ).catch(() => {});
    } catch { /* fire and forget */ }
  }
}

// ── Non-MCP routes as ExportedHandler ────────────────────────────

const DefaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "chittyagent-ch1tty",
        version: env.SERVICE_VERSION || "1.0.0",
      });
    }

    if (url.pathname === "/api/v1/status") {
      return Response.json({
        status: "ok",
        service: "chittyagent-ch1tty",
        version: env.SERVICE_VERSION || "2.0.0",
        upstream: env.CH1TTY_UPSTREAM || "https://ch1tty.chitty.cc/mcp",
        agents: AGENT_MCP_UPSTREAMS.map(a => a.id),
        transport: "streamable-http",
        auth: "oauth2.1",
      });
    }

    // OAuth authorization endpoint — auto-approve for MCP clients
    if (url.pathname === "/oauth/approve") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: oauthReq.clientId,
        scope: oauthReq.scope,
        props: {
          clientId: oauthReq.clientId,
        },
      });
      return Response.redirect(redirectTo, 302);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response("Not Found", { status: 404 });
  },
};

// ── OAuth Provider wrapping MCP + default routes ─────────────────

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: ChittyMcpAgent.serve("/mcp"),
  defaultHandler: DefaultHandler,
  authorizeEndpoint: "/oauth/approve",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
});
