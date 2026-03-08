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

- **Entry**: `src/index.ts` — creates `Server`, wires `ListTools` + `CallTool` handlers, connects `StdioServerTransport`
- **Aggregator**: `src/aggregator.ts` — routes namespaced tool calls (`serverId/toolName`) to the correct backend
- **ChildManager**: `src/child-manager.ts` — spawns/manages local MCP child processes via `StdioClientTransport`
- **RemoteProxy**: `src/remote-proxy.ts` — proxies tool calls to HTTP MCP endpoints (mcp.chitty.cc, Cloudflare, etc.)
- **Config**: `servers.json` — declarative server registry, no code changes needed to add servers

## Key Patterns

- Tool names are namespaced: `remote/chitty_memory_persist`, `serena/find_symbol`, `thinking/sequentialthinking`
- Local servers spawn lazily on first tool call
- Auth tokens retrieved via `chitty-mcp-token` CLI (execFileSync, not exec — no shell injection)
- Tool lists cached 5 minutes, auth tokens cached 11 hours
- All child stderr piped to gateway stderr with `[ch1tty:serverId]` prefix
- Graceful shutdown: SIGINT/SIGTERM → close all children → exit

## Config Override

Set `CH1TTY_CONFIG` env var to use a custom servers.json path.

## Adding a Server

Add an entry to `servers.json`:
```json
{
  "id": "myserver",
  "name": "My Server",
  "type": "local",
  "command": "node",
  "args": ["/path/to/server.js"],
  "lazy": true
}
```

No code changes required.
