# CHITTY.md — Ch1tty

## Architecture Summary

Ch1tty is a Node.js MCP server that acts as a gateway/aggregator. It presents itself as a single stdio MCP server to AI clients while internally routing to multiple backends:

- **Local backends**: Spawned as child processes via `StdioClientTransport` (Serena, filesystem, desktop-commander, etc.)
- **Remote backends**: Reached via HTTP POST with JSON-RPC (mcp.chitty.cc, Cloudflare MCP endpoints)

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Language | TypeScript (ES2022, Node16 modules) |
| MCP SDK | `@modelcontextprotocol/sdk` v1.22.0 |
| Auth | `chitty-mcp-token` (1Password CLI wrapper) |
| Config | `servers.json` (declarative) |

## Ecosystem Position

```
AI Client (Claude/Codex)
    │ stdio
    ▼
  Ch1tty ─── aggregates ──► Local MCP servers (stdio children)
    │                        └ Serena, filesystem, desktop-commander, ...
    │
    └──── proxies ──────────► Remote MCP endpoints (HTTP)
                              └ mcp.chitty.cc, Cloudflare, ...
```

## Consumers

- Claude Code sessions
- Claude Desktop
- OpenAI Codex
- Any future MCP-compatible client

## Certification

| Check | Status |
|-------|--------|
| CLAUDE.md | Present |
| CHARTER.md | Present |
| CHITTY.md | Present |
| Health endpoint | N/A (stdio server) |
| Registry entry | Pending |
