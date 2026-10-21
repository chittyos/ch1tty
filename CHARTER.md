---
uri: chittycanon://docs/tech/policy/ch1tty-charter
namespace: chittycanon://docs/tech
type: policy
version: 4.1.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "Ch1tty Charter"
certifier: chittycanon://core/foundation/mychitty-vault
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
| Category | Infrastructure / MCP Gateway |
| Domain | `ch1tty.chitty.cc` |
| Status | Active |

> **Runtime note**: This repo owns both the local stdio gateway and the Cloudflare Worker at `ch1tty.chitty.cc` (`wrangler.jsonc`). The Worker embeds its remote-server registry in `src/config-data.ts`; keep that projection reconciled with `servers.json`.

## Purpose

Universal MCP gateway with slim-MCP surface. Aggregates all MCP servers behind 5 tools: `search`, `execute`, `status`, `reload`, `cast`. Clients discover and invoke capabilities on-demand instead of loading 100+ tool definitions into context. `cast` is the wizard layer — intent in, execution out.

Dual transport: stdio for local clients, Streamable HTTP for remote clients.

## API Contract

Ch1tty exposes the standard MCP protocol over stdio and HTTP:

### tools/list
Returns exactly 5 meta-tools: `ch1tty/search`, `ch1tty/execute`, `ch1tty/status`, `ch1tty/reload`, `ch1tty/cast`.

### tools/call
- `ch1tty/search` — query internal tool registry by keyword, server, category
- `ch1tty/execute` — invoke any backend tool by namespaced name
- `ch1tty/status` — gateway status snapshot
- `ch1tty/reload` — hot-reload servers.json
- `ch1tty/cast` — natural language intent → tool resolution → execution (sub-meta calling master-meta)

### resources/list, resources/read
Passthrough — returns union of all backend resources, namespaced as `{serverId}://{originalUri}`.

### prompts/list, prompts/get
Passthrough — returns union of all backend prompts, namespaced as `{serverId}/{promptName}`.

## Dependencies

### Upstream (Ch1tty depends on)
- `mcp-portal.chitty.cc/mcp` — ChittyOS ecosystem MCP portal (`chittycanon://core/services/chittyconnect`), CF Access-protected
- `chitty-mcp-token` — Auth token helper (1Password-backed, via `chittycanon://core/services/auth`)
- Local MCP servers (filesystem, context7, sequential-thinking, etc.)
- Cloudflare MCP endpoints (`mcp.cloudflare.com`, `autorag.mcp.cloudflare.com`, `browser.mcp.cloudflare.com`)
- ChittyScrape (`https://agent.chitty.cc/scrape/mcp`) — read-only portal/snapshot execution using the shared ChittyMCP bearer

### Downstream (depends on Ch1tty)
- Claude Code (via `.mcp.json`)
- Claude Desktop (via `claude_desktop_config.json`)
- Claude web / ChatGPT / Cloudflare Agents (via Streamable HTTP at `/mcp`)
- Codex (via `config.toml`)
- Any MCP-compatible AI client

## Scope Boundaries

### In Scope
- Slim-MCP surface: search + execute + status + reload + cast
- Internal tool registry with caching
- Aggregating resources and prompts from all backends
- Managing child process lifecycle
- Proxying HTTP MCP calls with auth
- Dual transport: stdio + Streamable HTTP
- Config path interpolation (~ and env vars)

### Out of Scope
- Direct ChittyFinance execution until Ch1tty can propagate a verified Finance actor (or a separately governed Finance automation principal is explicitly provisioned)
- Multi-step tool chaining outside Code Mode / cast composition
- OAuth authorization server (handled by cloud Worker)
- Pattern learning from usage
