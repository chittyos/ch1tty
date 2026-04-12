---
uri: chittycanon://docs/tech/procedure/ch1tty-dev-guide
namespace: chittycanon://docs/tech
type: procedure
version: 4.1.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
certifier: chittycanon://core/services/chittycertify
title: "Ch1tty Development Guide"
visibility: PUBLIC
---

# CLAUDE.md — Ch1tty

## What This Is

Ch1tty is the ChittyOS universal MCP gateway. It aggregates all MCP servers (local stdio children + remote HTTP endpoints) behind a **slim-MCP surface**: just 4 tools (`search`, `execute`, `status`, `reload`). Clients discover capabilities via `search` and invoke them via `execute` — the full tool registry stays internal, keeping context windows minimal.

Dual transport: local clients connect via **stdio**, remote clients via **Streamable HTTP** at `/mcp`.

## Commands

```bash
npm run build   # Compile TypeScript → dist/
npm start       # Run the gateway (stdio mode)
npm run dev     # Watch mode for development
```

## Architecture

- **Entry**: `src/index.ts` — wires stdio + optional HTTP transport to the aggregator
- **Aggregator**: `src/aggregator.ts` — slim-MCP surface: search/execute/status/reload/cast meta-tools, internal tool registry, backend routing
- **HTTP Server**: `src/http-server.ts` — Streamable HTTP MCP transport on `/mcp`, health on `/health`, bearer auth
- **ChildManager**: `src/child-manager.ts` — `Backend` for local stdio child processes
- **RemoteProxy**: `src/remote-proxy.ts` — `Backend` for remote HTTP MCP endpoints
- **Config**: `servers.json` — declarative server registry, no code changes needed to add servers
- **Types**: `src/types.ts` — `Backend` interface, shared types

## Slim-MCP Pattern

Ch1tty exposes exactly 5 tools to clients:

| Tool | Purpose |
|------|---------|
| `ch1tty/search` | Query the internal tool registry by keyword, server, or category |
| `ch1tty/execute` | Invoke any discovered tool by namespaced name + args |
| `ch1tty/status` | Gateway status — servers, tool counts, uptime |
| `ch1tty/reload` | Hot-reload `servers.json` without restart |
| `ch1tty/cast` | Natural language intent → tool resolution → execution (sub-meta to master-meta) |

`cast` is the wizard layer: describe what you want, Ch1tty searches its own registry, scores matches against your intent + session context, and executes the best fit. Use `confirm: true` to preview the plan before firing. v1 uses keyword scoring + coordinator affinity; v2 will delegate to a brain backend (Alchemist/Ollama) for semantic resolution and multi-step chaining.

The full backend tool registry (100+ tools across all servers) is never exposed in `tools/list`. Clients search on-demand, keeping context cost at ~5 tool definitions regardless of how many backends are connected.

## Key Patterns

- Internal tool names are namespaced: `serverId/toolName`
- Resources and prompts are passthrough (low cardinality, fine to expose directly)
- Local servers spawn lazily on first tool call
- Auth tokens retrieved via `chitty-mcp-token` CLI (execFileSync — no shell injection)
- Tool registry cached 5 minutes, auth tokens cached 11 hours
- All child stderr piped to gateway stderr with `[ch1tty:serverId]` prefix
- Graceful shutdown: SIGINT/SIGTERM → close all children → exit
- Config supports `_comment` entries for inline documentation in servers.json

## Config Override

Set `CH1TTY_CONFIG` env var to use a custom servers.json path.

## Config Path Interpolation

Paths in `command`, `args`, and `endpoint` fields support:
- `~/` expands to the user's home directory
- `${VAR}` or `$VAR` expands to environment variable values

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

No code changes required. Call `ch1tty/reload` to pick up changes without restarting.

## HTTP Server

Set `CH1TTY_PORT` to enable the HTTP server with MCP transport:

```bash
CH1TTY_PORT=9099 CH1TTY_MCP_TOKEN=secret123 npm start
```

Endpoints on `0.0.0.0:{port}`:
- `GET /health` — `{"status":"ok","service":"ch1tty","version":"4.1.0"}`
- `GET /api/v1/status` — Full gateway status snapshot
- `* /mcp` — **Streamable HTTP MCP endpoint** (bearer token required if `CH1TTY_MCP_TOKEN` is set)

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `CH1TTY_PORT` | HTTP server port (enables HTTP transport) |
| `CH1TTY_MCP_TOKEN` | Bearer token for `/mcp` endpoint auth |
| `CH1TTY_CONFIG` | Custom servers.json path |
| `CH1TTY_ACCESS` | Filter servers by access level (read/write/readwrite) |
| `CH1TTY_CATEGORY` | Filter servers by category |

## Registration

Registration payload is in `register.json`. Submit to `register.chitty.cc`:

```bash
CHITTY_REGISTER_TOKEN=... ./scripts/register.sh
```
