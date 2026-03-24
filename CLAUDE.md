---
uri: chittycanon://docs/tech/procedure/ch1tty-dev-guide
namespace: chittycanon://docs/tech
type: procedure
version: 2.0.0
status: ACTIVE
title: "Ch1tty Development Guide"
visibility: PUBLIC
---

# CLAUDE.md — Ch1tty

## What This Is

Ch1tty is the ChittyOS universal MCP gateway. It aggregates all MCP servers (local stdio children + remote HTTP endpoints) behind a single stdio MCP server. AI clients connect to Ch1tty once instead of configuring 10+ individual servers.

## Commands

```bash
npm run build   # Compile TypeScript → dist/
npm start       # Run the gateway (stdio mode)
npm run dev     # Watch mode for development
```

## Architecture

- **Entry**: `src/index.ts` — creates `Server`, wires all MCP handlers, connects `StdioServerTransport`
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
