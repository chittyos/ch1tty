---
uri: chittycanon://docs/tech/architecture/ch1tty
namespace: chittycanon://docs/tech
type: architecture
version: 3.0.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "Ch1tty Architecture"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# CHITTY.md — Ch1tty

## Architecture Summary

Ch1tty is a Node.js MCP server that acts as a slim-MCP gateway. It exposes 4 tools (`search`, `execute`, `status`, `reload`) while internally maintaining a full registry of 100+ tools across multiple backends via the `Backend` interface:

- **Local backends** (`ChildManager`): Spawned as child processes via `StdioClientTransport`
- **Remote backends** (`RemoteProxy`): Reached via `StreamableHTTPClientTransport`

Both implement the same `Backend` interface — the aggregator routes via `Map<serverId, Backend>`.

Dual transport: **stdio** (always active) + **Streamable HTTP** on `/mcp` (enabled via `CH1TTY_PORT`).

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
AI Client (Claude Code / Codex)
    │ stdio
    ▼
  Ch1tty ─── search ──► Internal tool registry (cached)
    │         execute ─► Backend routing
    │
    ├── ChildManager ──► Local MCP servers (stdio children)
    │                    └ neon, context7, thinking, fs, playwright
    │
    └── RemoteProxy ───► Remote MCP endpoints (HTTP)
                         └ connect.chitty.cc, Cloudflare, ...

Remote AI Client (Claude web / ChatGPT / CF Agents)
    │ Streamable HTTP (/mcp)
    ▼
  Ch1tty (same aggregator, same 4 tools)
```

## Consumers

- Claude Code sessions (stdio)
- Claude Desktop (stdio)
- Claude web / ChatGPT / Cloudflare Agents (HTTP)
- OpenAI Codex (stdio)
- Any MCP-compatible client

## Certification

| Check | Status |
|-------|--------|
| CLAUDE.md | Present |
| CHARTER.md | Present |
| CHITTY.md | Present |
| Health endpoint | Available (CH1TTY_PORT) |
| Registry entry | Ready (register.json) |
