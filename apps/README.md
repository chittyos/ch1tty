# apps/

Each subdirectory here is one of **ch1tty's own focused per-domain MCP surfaces** — purpose-built, typed tools, one concern per server. These are ch1tty-owned code; many adapt a ChittyOS canonical service (e.g. `apps/tasks-mcp/` wraps `chittyentity/workers/chittyagent-tasks`), but the canonical state always lives in the home service's repo, not here.

Ch1tty is a sibling of ChittyOS, not a part of it — its `apps/*-mcp` surfaces are peer MCP translators that let the ch1tty gateway offer ChittyOS domains alongside non-ChittyOS sources through one MCP interface, usable from LLM chat, agent runtimes, or plain server-to-server callers.

This mirrors `github.com/cloudflare/mcp-server-cloudflare`'s structure: 15 focused servers + one broad **Code Mode** surface. The ch1tty gateway (`src/` in this repo, future `apps/gateway/`) plays the Code-Mode role — the slim-MCP viewport that aggregates all of these.

## Current + planned focused servers

| Directory | Status | Hostname | Role |
|---|---|---|---|
| `tasks-mcp/` | scaffolded — REST adapter wrapping `tasks.chitty.cc`; 6 typed tools; `enabled: false` until `CHITTY_TASKS_TOKEN` set | `tasks.chitty.cc/mcp` (future) | Inter-agent task queue |
| `ledger-mcp/` | scaffolded — REST adapter wrapping `ledger.chitty.cc`; 4 typed tools (list_namespaces, list_entries, get_entry, append_entry); `enabled: false` until `CHITTY_LEDGER_TOKEN` set | `ledger.chitty.cc/mcp` (future) | Canonical append-only ledger |
| `session-coordinator-mcp/` | planned | `session.chitty.cc/mcp` | Cross-channel session state |
| `evidence-mcp/` | planned | `evidence.chitty.cc/mcp` | Document ingest + canonical URIs |

## Rule

> **New MCP surface ch1tty wants to expose → new focused server under `apps/`, registered as a backend in `servers.json`; never inline domain logic in the ch1tty gateway. Canonical state stays in the home service; the `apps/*-mcp` entry is just the MCP translation layer.**

The gateway's public surface is fixed at the 5 slim-MCP meta-tools (`search`, `execute`, `status`, `reload`, `cast`). Domain features are discovered through `search` and invoked through `execute` against the appropriate focused server.

Cross-domain / intent-driven clients connect to `ch1tty.chitty.cc/mcp`; typed single-domain integrations can dial the focused server directly.
