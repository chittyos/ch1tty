# apps/

Each subdirectory here is a **focused per-domain MCP server** in the ChittyOS ecosystem — one product/domain per server, purpose-built, typed tools.

This mirrors `github.com/cloudflare/mcp-server-cloudflare`'s structure: 15 focused servers (workers-bindings, browser-rendering, autorag, etc.) + one broad **Code Mode** surface. Ch1tty (`src/` in this repo, not yet under `apps/gateway/`) plays the Code-Mode role — the slim-MCP viewport that aggregates all of these.

## Current + planned focused servers

| Directory | Status | Hostname | Role |
|---|---|---|---|
| `tasks-mcp/` | planned (coordinated via `chittyentity/workers/chittyagent-tasks`) | `tasks.chitty.cc/mcp` | Inter-agent task queue |
| `ledger-mcp/` | planned | `ledger.chitty.cc/mcp` | Canonical append-only ledger |
| `session-coordinator-mcp/` | planned | `session.chitty.cc/mcp` | Cross-channel session state |
| `evidence-mcp/` | planned | `evidence.chitty.cc/mcp` | Document ingest + canonical URIs |

## Rule

> **New ChittyOS MCP capability → new focused server under `apps/`, registered as a backend in `servers.json`; never inline code in the ch1tty gateway.**

The gateway's public surface is fixed at the 5 slim-MCP meta-tools (`search`, `execute`, `status`, `reload`, `cast`). Domain features are discovered through `search` and invoked through `execute` against the appropriate focused server.

Cross-domain / intent-driven clients connect to `ch1tty.chitty.cc/mcp`; typed single-domain integrations can dial the focused server directly.
