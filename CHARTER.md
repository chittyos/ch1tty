---
uri: chittycanon://docs/tech/policy/ch1tty-charter
namespace: chittycanon://docs/tech
type: policy
version: 3.0.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "Ch1tty Charter"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# CHARTER.md — Ch1tty

**Canonical URI**: `chittycanon://core/services/ch1tty`

## Service Identity

| Field | Value |
|-------|-------|
| Name | Ch1tty |
| ID | ch1tty |
| Tier | 2 (Platform) |
| Domain | Infrastructure / MCP Gateway |
| Status | Active |

## Purpose

Universal MCP gateway with slim-MCP surface. Aggregates all MCP servers behind 4 tools: `search`, `execute`, `status`, `reload`. Clients discover and invoke capabilities on-demand instead of loading 100+ tool definitions into context.

Dual transport: stdio for local clients, Streamable HTTP for remote clients.

## API Contract

Ch1tty exposes the standard MCP protocol over stdio and HTTP:

### tools/list
Returns exactly 4 meta-tools: `ch1tty/search`, `ch1tty/execute`, `ch1tty/status`, `ch1tty/reload`.

### tools/call
- `ch1tty/search` — query internal tool registry by keyword, server, category
- `ch1tty/execute` — invoke any backend tool by namespaced name
- `ch1tty/status` — gateway status snapshot
- `ch1tty/reload` — hot-reload servers.json

### resources/list, resources/read
Passthrough — returns union of all backend resources, namespaced as `{serverId}://{originalUri}`.

### prompts/list, prompts/get
Passthrough — returns union of all backend prompts, namespaced as `{serverId}/{promptName}`.

## Dependencies

### Upstream (Ch1tty depends on)
- `connect.chitty.cc/mcp` — ChittyConnect MCP surface (`chittycanon://core/services/chittyconnect`)
- `chitty-mcp-token` — Auth token helper (1Password-backed, via `chittycanon://core/services/auth`)
- Local MCP servers (filesystem, context7, sequential-thinking, etc.)
- Cloudflare MCP endpoints (builds, autorag)

### Downstream (depends on Ch1tty)
- Claude Code (via `.mcp.json`)
- Claude Desktop (via `claude_desktop_config.json`)
- Claude web / ChatGPT / Cloudflare Agents (via Streamable HTTP at `/mcp`)
- Codex (via `config.toml`)
- Any MCP-compatible AI client

## Scope Boundaries

### In Scope
- Slim-MCP surface: search + execute + status + reload
- Internal tool registry with caching
- Aggregating resources and prompts from all backends
- Managing child process lifecycle
- Proxying HTTP MCP calls with auth
- Dual transport: stdio + Streamable HTTP
- Config path interpolation (~ and env vars)

### Out of Scope
- Tool composition or chaining
- OAuth authorization server (handled by cloud Worker)
- Pattern learning from usage
