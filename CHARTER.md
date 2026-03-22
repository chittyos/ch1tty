# CHARTER.md — Ch1tty

## Service Identity

| Field | Value |
|-------|-------|
| Name | Ch1tty |
| ID | ch1tty |
| Tier | 2 (Platform) |
| Domain | Infrastructure / MCP Gateway |
| Status | Active |

## Purpose

Universal MCP gateway that aggregates all MCP servers into a single stdio connection. Replaces per-client multi-server configuration with one unified entry point.

## API Contract

Ch1tty exposes the standard MCP protocol over stdio:

### tools/list
Returns the union of all backend tools, namespaced as `{serverId}/{toolName}`.

### tools/call
Routes `{serverId}/{toolName}` calls to the appropriate backend (local child process or remote HTTP endpoint).

## Dependencies

### Upstream (Ch1tty depends on)
- `mcp.chitty.cc` — Remote MCP gateway (ChittyMCP)
- `chitty-mcp-token` — Auth token helper (1Password-backed)
- Local MCP servers (Serena, filesystem, desktop-commander, etc.)
- Cloudflare MCP endpoints (builds, autorag)

### Downstream (depends on Ch1tty)
- Claude Code (via `.mcp.json`)
- Claude Desktop (via `claude_desktop_config.json`)
- Codex (via `config.toml`)
- Any MCP-compatible AI client

## Scope Boundaries

### In Scope
- Aggregating tool lists from multiple backends
- Routing tool calls by namespace prefix
- Managing child process lifecycle
- Proxying HTTP MCP calls with auth
- Caching tool lists and auth tokens
- Aggregating resources and prompts from all backends
- Meta-tools for gateway introspection (status, reload)
- Config path interpolation (~ and env vars)

### Out of Scope
- Tool composition or chaining
- Context-aware routing
- Pattern learning from usage
