---
uri: chittycanon://docs/tech/arch/chittyagent-ch1tty
namespace: chittycanon://docs/tech
type: architecture
version: 2.0.0
status: CERTIFIED
title: "ChittyAgent-Ch1tty Architecture"
service: chittyagent-ch1tty
---

# ChittyAgent-Ch1tty Architecture

## Stack

- **Runtime**: Cloudflare Workers (Agents SDK)
- **Pattern**: Full Agents SDK — McpAgent with DO-backed SQLite
- **Auth**: OAuth 2.1 via `@cloudflare/workers-oauth-provider`
- **Transport**: MCP Streamable HTTP

## Ecosystem Position

```
Claude.ai / Claude Desktop
  │ OAuth 2.1
  ▼
chittyagent-ch1tty (this worker)
  │ addMcpServer() — HTTP URLs
  ├── ch1tty.com/mcp (VM aggregator)
  │     ├── Neon (stdio)
  │     ├── Playwright (stdio)
  │     └── Filesystem (stdio)
  ├── dispute.agent.chitty.cc/mcp
  ├── notes.agent.chitty.cc/mcp
  ├── orchestrator.agent.chitty.cc/mcp
  └── ship.agent.chitty.cc/mcp
```

## Consumers

- Claude.ai via MCP Portal (`agents-mcp.chitty.cc`)
- Claude Desktop via `mcp-remote`
- Any MCP client supporting OAuth 2.1

## Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `MCP_AGENT` | Durable Object | McpAgent per-session state |
| `OAUTH_KV` | KV | OAuth token/client storage |
