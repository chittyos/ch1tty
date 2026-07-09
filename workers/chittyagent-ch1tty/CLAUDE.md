---
uri: chittycanon://docs/tech/procedure/chittyagent-ch1tty-dev-guide
namespace: chittycanon://docs/tech
type: procedure
version: 1.0.0
status: DRAFT
title: "ChittyAgent MCP Development Guide"
visibility: PUBLIC
---

# CLAUDE.md — ChittyAgent MCP

## What This Is

OAuth-protected MCP portal gateway. Uses the Cloudflare Agents SDK (`McpAgent` + `AgentsOAuthProvider`) to sit between the MCP Portal and ch1tty.

The portal requires OAuth. Ch1tty (the VM-based aggregator) doesn't implement OAuth. This Worker bridges the gap — OAuth in, unauthenticated proxy out.

## Commands

```bash
npm install
npm run dev                          # Local dev server
npx cf deploy --env production # Deploy
```

## Architecture

```
MCP Portal (Claude.ai)
  │ OAuth 2.1
  ▼
chittyagent-ch1tty (this Worker)
  │ Streamable HTTP (unauthenticated)
  ▼
ch1tty.com/mcp (VM aggregator)
  │
  ├── Neon (stdio)
  ├── Playwright (stdio)
  ├── Filesystem (stdio)
  └── ... all backends
```

## Key Patterns

- `McpAgent.addMcpServer()` connects to ch1tty as a remote MCP server
- All tools/resources/prompts are proxied transparently
- `AgentsOAuthProvider` handles `/authorize`, `/token`, `/register`
- No tool definitions in this Worker — everything comes from ch1tty
- Adding new backends = update ch1tty's `servers.json`, not this Worker

## Environment Variables

| Var | Purpose |
|-----|---------|
| `CH1TTY_UPSTREAM` | URL of the ch1tty MCP endpoint (default: `https://ch1tty.com/mcp`) |

## Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `MCP_AGENT` | Durable Object | McpAgent instances (per-session state) |
| `OAUTH_KV` | KV | OAuth token/client storage |
