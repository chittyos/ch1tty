---
uri: chittycanon://docs/tech/spec/chittyagent-ch1tty
namespace: chittycanon://docs/tech
type: charter
version: 2.0.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "ChittyAgent-Ch1tty Charter"
service: chittyagent-ch1tty
tier: 2
visibility: PUBLIC
---

# ChittyAgent-Ch1tty Charter

## Purpose

OAuth-protected MCP portal gateway. Aggregates the ch1tty VM-based MCP aggregator (Neon, Playwright, Filesystem) with cloud-native chittyentity agents (dispute, notes, orchestrator, ship) into a single MCP endpoint.

## API Contract

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | None | Liveness check |
| `/api/v1/status` | GET | None | Service status with upstream list |
| `/mcp` | POST/GET | OAuth 2.1 | MCP Streamable HTTP — all tools from all upstreams |
| `/authorize` | GET | None | OAuth authorization |
| `/token` | POST | None | OAuth token exchange |
| `/register` | POST | None | Dynamic client registration |

## Upstream MCP Servers

| ID | URL | Tools |
|----|-----|-------|
| `ch1tty` | `ch1tty.com/mcp` | Neon SQL, Playwright, Filesystem, etc. |
| `dispute` | `dispute.agent.chitty.cc/mcp` | 7 dispute tools |
| `notes` | `notes.agent.chitty.cc/mcp` | 6 notes tools |
| `orchestrator` | `orchestrator.agent.chitty.cc/mcp` | 5 provision tools |
| `ship` | `ship.agent.chitty.cc/mcp` | 8 ship tools |

## Dependencies

- `agents@^0.8.7` — Cloudflare Agents SDK with `addMcpServer()`
- `@cloudflare/workers-oauth-provider` — OAuth 2.1 server
- `@modelcontextprotocol/sdk` — MCP protocol

## Scope

- Proxies MCP tool calls transparently — no local tool definitions
- OAuth inbound (from clients), unauthenticated outbound (to upstreams)
- Adding new upstreams = add URL to `AGENT_MCP_UPSTREAMS` array
