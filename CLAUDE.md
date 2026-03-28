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
- **HTTP Server**: `src/http-server.ts` — HTTP server: `/health`, `/api/v1/status`, `/mcp` (Streamable HTTP MCP)
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
CH1TTY_MCP_TOKEN=secret123 CH1TTY_PORT=9099 npm start  # with auth
```

Endpoints on `0.0.0.0:{port}`:
- `GET /health` — `{"status":"ok","service":"ch1tty","version":"2.1.0"}`
- `GET /api/v1/status` — Full gateway status snapshot
- `POST /mcp` — **Streamable HTTP MCP endpoint** for remote clients

The `/mcp` endpoint speaks the MCP Streamable HTTP transport protocol. Any MCP client can connect:
- Claude web/desktop via remote MCP server config
- ChatGPT via Apps & Connectors
- Cloudflare Agents via `addMcpServer("ch1tty", "https://ch1tty.chitty.cc/mcp")`
- MCP Inspector for testing

Auth: if `CH1TTY_MCP_TOKEN` is set, requests must include `Authorization: Bearer <token>`.

This is the key value prop — local-only servers (Neon, Playwright, filesystem) become accessible to remote AI clients through ch1tty's MCP surface.

## Registration

Registration payload is in `register.json`. Submit to `register.chitty.cc`:

```bash
CHITTY_REGISTER_TOKEN=... ./scripts/register.sh
```
