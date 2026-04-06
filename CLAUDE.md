---
uri: chittycanon://docs/tech/procedure/ch1tty-dev-guide
namespace: chittycanon://docs/tech
type: procedure
version: 2.1.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
certifier: chittycanon://core/services/chittycertify
title: "Ch1tty Development Guide"
visibility: PUBLIC
---

# CLAUDE.md — Ch1tty

## What This Is

Ch1tty is the ChittyOS universal MCP gateway. It aggregates all MCP servers (local stdio children + remote HTTP endpoints) behind a single interface. Local clients connect via stdio, remote clients connect via Streamable HTTP at `/mcp`. This lets AI clients (Claude Code, Claude web, ChatGPT, CF Agents) access all backends — including local-only servers like Neon that can't run on Cloudflare Workers.

## Commands

```bash
npm run build   # Compile TypeScript → dist/
npm start       # Run the gateway (stdio mode)
npm run dev     # Watch mode for development
```

## Architecture

- **Entry**: `src/index.ts` — starts stdio transport + optional HTTP server, wires to aggregator
- **MCP Server**: `src/mcp-server.ts` — shared factory creating configured `Server` instances for any transport
- **HTTP Server**: `src/http-server.ts` — Express-based: OAuth routes, `/health`, `/api/v1/status`, `/mcp` (Streamable HTTP MCP)
- **Auth Provider**: `src/auth-provider.ts` — OAuth 2.1 provider: in-memory client store, PKCE, token issuance/verification
- **Alchemist**: `src/alchemist.ts` — meta-intelligence: tool surface analysis, combo detection, prompt generation, goal recipes
- **Aggregator**: `src/aggregator.ts` — routes namespaced calls to the correct `Backend` via `Map<serverId, Backend>`
- **ChildManager**: `src/child-manager.ts` — implements `Backend` for local stdio child processes
- **RemoteProxy**: `src/remote-proxy.ts` — implements `Backend` for HTTP MCP endpoints (connect.chitty.cc, Cloudflare, etc.)
- **Config**: `servers.json` — declarative server registry, no code changes needed to add servers
- **Types**: `src/types.ts` — `Backend` interface, shared types (`ToolEntry`, `ToolCallResult`, `BackendStatus`)

## Key Patterns

- Tool names are namespaced: `chittyos/chitty_memory_persist`, `thinking/sequentialthinking`
- Resources are namespaced: `serverId://originalUri`
- Prompts are namespaced: `serverId/promptName`
- Local servers spawn lazily on first tool call
- Auth tokens retrieved via `chitty-mcp-token` CLI (execFileSync, not exec — no shell injection)
- Tool lists cached 5 minutes, auth tokens cached 11 hours
- All child stderr piped to gateway stderr with `[ch1tty:serverId]` prefix
- Graceful shutdown: SIGINT/SIGTERM → close all children → exit
- Config supports `_comment` entries for inline documentation in servers.json

## Meta-Tools

Built-in tools under the `ch1tty/` namespace:

- `ch1tty/status` — Returns gateway uptime, connected servers, tool counts, cache ages
- `ch1tty/reload` — Hot-reloads `servers.json` without restarting the gateway
- `ch1tty/alchemist_discover` — Scan all backends, map tool capabilities, categories, and server groupings
- `ch1tty/alchemist_combos` — Detect composable tool chains, cross-backend pipelines, and workflow patterns
- `ch1tty/alchemist_prompts` — Generate optimized prompt strings tailored to the current tool surface
- `ch1tty/alchemist_suggest` — Given a goal, returns a recipe: which tools, what order, what prompts
- `ch1tty/task_list` / `task_create` / `task_get` / `task_update` — canonical task management bridge to Chitty task service

## Config Override

Set `CH1TTY_CONFIG` env var to use a custom servers.json path.

## Config Path Interpolation

Paths in `command`, `args`, and `endpoint` fields support:
- `~/` expands to the user's home directory
- `${VAR}` or `$VAR` expands to environment variable values

This makes `servers.json` portable across machines.

## Adding a Server

Add an entry to `servers.json`:
```json
{
  "id": "myserver",
  "name": "My Server",
  "type": "remote",
  "access": "readwrite",
  "category": "ecosystem",
  "endpoint": "https://example.com/mcp",
  "authTokenKey": "my-token-key",
  "lazy": true
}
```

No code changes required. Or call `ch1tty/reload` to pick up changes without restarting.

## HTTP Server & Remote MCP

Set `CH1TTY_PORT` (or `CH1TTY_HEALTH_PORT`) to enable the HTTP server:

```bash
CH1TTY_PORT=9099 npm start
CH1TTY_MCP_TOKEN=secret123 CH1TTY_PORT=9099 CH1TTY_PUBLIC_URL=https://ch1tty.chitty.cc npm start
```

### Endpoints on `0.0.0.0:{port}`

**OAuth 2.1 (RFC 8414 / RFC 9728 / RFC 7591):**
- `GET /.well-known/oauth-authorization-server` — Authorization server metadata
- `GET /.well-known/oauth-protected-resource/mcp` — Protected resource metadata
- `GET /authorize` — OAuth authorization endpoint (PKCE required)
- `POST /token` — Token exchange (auth code → access token)
- `POST /register` — Dynamic client registration
- `POST /revoke` — Token revocation

**Gateway:**
- `GET /health` — `{"status":"ok","service":"ch1tty","version":"2.1.0"}`
- `GET /api/v1/status` — Full gateway status snapshot
- `GET/POST /api/v1/tasks` — OAuth-protected canonical task list/create bridge
- `GET/PATCH /api/v1/tasks/:taskId` — OAuth-protected canonical task get/update bridge
- `* /mcp` — **Streamable HTTP MCP endpoint** (OAuth bearer-protected)

### MCP Client Access

The `/mcp` endpoint speaks the MCP Streamable HTTP transport protocol with OAuth 2.1 auth. Clients auto-discover auth via the well-known endpoints:
- Claude web/desktop — add as remote MCP server, OAuth flow handled automatically
- `npx add-mcp https://ch1tty.chitty.cc/mcp` — one-command install for any supported client
- ChatGPT via Apps & Connectors
- Cloudflare Agents via `addMcpServer("ch1tty", "https://ch1tty.chitty.cc/mcp")`
- MCP Inspector for testing

### Auth

OAuth 2.1 with PKCE (authorization code grant). Clients register dynamically via `/register`, then complete the standard OAuth flow. If `CH1TTY_MCP_TOKEN` is set, the `/authorize` page requires the token as a gateway approval secret. If unset, authorization auto-approves.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `CH1TTY_PORT` | HTTP server port |
| `CH1TTY_MCP_TOKEN` | Gateway secret (gates OAuth authorize + legacy bearer) |
| `CH1TTY_PUBLIC_URL` | Public-facing URL for OAuth metadata (e.g. `https://ch1tty.chitty.cc`) |
| `CHITTY_TASK_TOKEN` | Bearer token for canonical Chitty task management API |
| `CH1TTY_TASK_BASE_URL` | Override canonical task API base URL (default `https://api.chitty.cc/api/context/tasks`) |

This is the key value prop — local-only servers (Neon, Playwright, filesystem) become accessible to remote AI clients through ch1tty's MCP surface.

## Registration

Registration payload is in `register.json`. Submit to `register.chitty.cc`:

```bash
CHITTY_REGISTER_TOKEN=... ./scripts/register.sh
```
