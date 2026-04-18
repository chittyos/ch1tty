---
uri: chittycanon://docs/tech/architecture/ch1tty
namespace: chittycanon://docs/tech
type: architecture
version: 4.1.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "Ch1tty Architecture"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# CHITTY.md — Ch1tty

## Service Identity

| Field | Value |
|-------|-------|
| Canonical URI | `chittycanon://core/services/ch1tty` |
| Tier | 2 (Platform) |
| Domain | `ch1tty.com` / local stdio |
| Certification | CERTIFIED (ChittyCertify) |

## Architecture Summary

Ch1tty is a Node.js MCP server that acts as a slim-MCP gateway. It exposes 5 tools (`search`, `execute`, `status`, `reload`, `cast`) while internally maintaining a full registry of 100+ tools across multiple backends via the `Backend` interface:

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
    │         cast ────► intent → search → execute (sub-meta)
    │
    ├── ChildManager ──► Local MCP servers (stdio children)
    │                    └ neon, context7, thinking, fs, playwright
    │
    └── RemoteProxy ───► Remote MCP endpoints (HTTP)
                         └ mcp-portal.chitty.cc, mcp.cloudflare.com,
                           browser.mcp.cloudflare.com, ...

Remote AI Client (Claude web / ChatGPT / CF Agents)
    │ Streamable HTTP (/mcp)
    ▼
  Ch1tty (same aggregator, same 5 tools)
```

## Consumers

- Claude Code sessions (stdio)
- Claude Desktop (stdio)
- Claude web / ChatGPT / Cloudflare Agents (HTTP)
- OpenAI Codex (stdio)
- Any MCP-compatible client

## Split Architecture

Ch1tty + its peer domain servers follow the `github.com/cloudflare/mcp-server-cloudflare` split pattern:

| Role | ChittyOS instance | Surface |
|------|-------------------|---------|
| Code-Mode (broad) | **Ch1tty** | `ch1tty.chitty.cc/mcp` — 5 slim-MCP meta-tools over the full backend registry |
| Focused per-domain (typed) | `apps/*-mcp` (planned), starting with `tasks.chitty.cc/mcp` | Purpose-built tools per product — `tasks`, later `ledger`, `session-coordinator`, `evidence`, etc. |

Clients pick based on need: cross-domain / intent-driven work goes through ch1tty; typed single-domain integrations can dial the focused server directly.

The pattern is **fractal** (memory: `project_fractal_architecture.md`) — each focused server itself exposes a slim-MCP viewport over its sub-primitives, so the Code-Mode-over-focused-servers shape repeats at every layer. See `apps/README.md` for the planned roster.

## Certification

| Check | Status |
|-------|--------|
| CLAUDE.md | Present |
| CHARTER.md | Present |
| CHITTY.md | Present |
| Health endpoint | Available (CH1TTY_PORT) |
| Registry entry | Ready (register.json) |
