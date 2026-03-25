---
uri: chittycanon://docs/tech/architecture/ch1tty
namespace: chittycanon://docs/tech
type: architecture
version: 2.0.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "Ch1tty Architecture"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# CHITTY.md — Ch1tty

## Architecture Summary

Ch1tty is a Node.js MCP server that acts as a gateway/aggregator. It presents itself as a single stdio MCP server to AI clients while internally routing to multiple backends via the `Backend` interface:

- **Local backends** (`ChildManager`): Spawned as child processes via `StdioClientTransport`
- **Remote backends** (`RemoteProxy`): Reached via `StreamableHTTPClientTransport` (connect.chitty.cc, Cloudflare MCP endpoints)

Both implement the same `Backend` interface — the aggregator routes via `Map<serverId, Backend>`.

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Language | TypeScript (ES2022, Node16 modules) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Auth | `chitty-mcp-token` (1Password CLI wrapper) |
| Config | `servers.json` (declarative, with path interpolation) |

## Ecosystem Position

```
AI Client (Claude/Codex)
    │ stdio
    ▼
  Ch1tty ─── aggregates ──► Local MCP servers (stdio children)
    │                        └ neon, context7, thinking, fs, playwright
    │
    └──── proxies ──────────► Remote MCP endpoints (HTTP)
                              └ connect.chitty.cc, Cloudflare, ...
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
| Health endpoint | Optional (CH1TTY_HEALTH_PORT) |
| Registry entry | Ready (register.json) |
