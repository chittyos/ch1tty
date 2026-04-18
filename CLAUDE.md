---
uri: chittycanon://docs/tech/procedure/ch1tty-dev-guide
namespace: chittycanon://docs/tech
type: procedure
version: 4.1.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
certifier: chittycanon://core/services/chittycertify
title: "Ch1tty Development Guide"
visibility: PUBLIC
---

# CLAUDE.md — Ch1tty

## What This Is

Ch1tty is a **sibling** of ChittyOS — not a ChittyOS-internal service. It's one MCP surface that brings ChittyOS (and any other MCP source) through a single interface. The surface has **no single interaction modality** — the same endpoint serves LLM chat frontends, agent runtimes, and server-to-server backends. Whether it behaves agentically is decided by the consumer on the other end; ch1tty itself just exposes the 5 slim-MCP meta-tools (`search`, `execute`, `status`, `reload`, `cast`) plus the resources/prompts passthrough and lets the caller drive.

The meta-tools + SessionCoordinator + cast's intent resolution + (planned) brain backend make the surface *agent-capable*: discover → reason → execute over the full aggregated registry, keeping client context minimal. Plain MCP clients use the same tools without any reasoning loop.

Aggregation covers MCP servers of every shape: local stdio children, remote HTTP endpoints, ChittyOS services (via their own MCP surfaces), and arbitrary third-party MCP sources — all through the same `Backend` interface.

Dual transport: local clients connect via **stdio**, remote clients via **Streamable HTTP** at `/mcp`.

### Architectural Guardrail (Do Not Drift)

Treat Ch1tty as an orchestrator viewport, not a backend catalog.

- Public MCP surface stays fixed at exactly 5 tools:
  - `ch1tty/search`
  - `ch1tty/execute`
  - `ch1tty/status`
  - `ch1tty/reload`
  - `ch1tty/cast`
- Session/fractal behavior is handled by SessionCoordinator + SessionTracker behind the meta-tools.
- Backend namespace sprawl is controlled by config profiles; never expand public surface to include backend tools directly.

## Commands

```bash
npm run build   # Compile TypeScript → dist/
npm start       # Run the gateway (stdio mode)
npm run dev     # Watch mode for development
```

## Architecture

- **Entry**: `src/index.ts` — wires stdio + optional HTTP transport to the aggregator
- **Aggregator**: `src/aggregator.ts` — slim-MCP surface: search/execute/status/reload/cast meta-tools, internal tool registry, backend routing
- **HTTP Server**: `src/http-server.ts` — Streamable HTTP MCP transport on `/mcp`, health on `/health`, bearer auth
- **ChildManager**: `src/child-manager.ts` — `Backend` for local stdio child processes
- **RemoteProxy**: `src/remote-proxy.ts` — `Backend` for remote HTTP MCP endpoints
- **Config**: `servers.json` — declarative server registry, no code changes needed to add servers
- **Types**: `src/types.ts` — `Backend` interface, shared types

## Slim-MCP Pattern

Ch1tty exposes exactly 5 tools to clients:

| Tool | Purpose |
|------|---------|
| `ch1tty/search` | Query the internal tool registry by keyword, server, or category |
| `ch1tty/execute` | Invoke any discovered tool by namespaced name + args |
| `ch1tty/status` | Gateway status — servers, tool counts, uptime |
| `ch1tty/reload` | Hot-reload `servers.json` without restart |
| `ch1tty/cast` | Natural language intent → tool resolution → execution (sub-meta to master-meta) |

`cast` is the wizard layer: describe what you want, Ch1tty searches its own registry, scores matches against your intent + session context, and executes the best fit. Use `confirm: true` to preview the plan before firing. v1 uses keyword scoring + coordinator affinity; v2 will delegate to a brain backend (Alchemist/Ollama) for semantic resolution and multi-step chaining.

The full backend tool registry (100+ tools across all servers) is never exposed in `tools/list`. Clients search on-demand, keeping context cost at ~5 tool definitions regardless of how many backends are connected.

## Key Patterns

- Internal tool names are namespaced: `serverId/toolName`
- Resources and prompts are passthrough (low cardinality, fine to expose directly)
- Local servers spawn lazily on first tool call
- Auth tokens retrieved via `chitty-mcp-token` CLI (execFileSync — no shell injection)
- Tool registry cached 5 minutes, auth tokens cached 11 hours
- All child stderr piped to gateway stderr with `[ch1tty:serverId]` prefix
- Graceful shutdown: SIGINT/SIGTERM → close all children → exit
- Config supports `_comment` entries for inline documentation in servers.json

## Config Override

Set `CH1TTY_CONFIG` env var to use a custom servers.json path.

### Strict Orchestrator Profile

To run a clean orchestrator mode (minimal backend overlap), use:

```bash
CH1TTY_CONFIG=./servers.orchestrator.json npm start
```

`servers.orchestrator.json` is the canonical low-noise profile for production-oriented orchestration.

## Config Path Interpolation

Paths in `command`, `args`, and `endpoint` fields support:
- `~/` expands to the user's home directory
- `${VAR}` or `$VAR` expands to environment variable values

## Adding a Server

Add an entry to `servers.json`:
```json
{
  "id": "myserver",
  "name": "My Server",
  "type": "remote",
  "access": "readwrite",
  "category": "ecosystem",
  "endpoint": "https://example.com/mcp",
  "authTokenKey": "my-token-key",
  "headers": {
    "X-Custom-Header": "literal-value",
    "X-Interpolated": "${MY_ENV_VAR}"
  },
  "envHeaders": {
    "CF-Access-Client-Id": "CF_ACCESS_CLIENT_ID",
    "CF-Access-Client-Secret": "CF_ACCESS_CLIENT_SECRET"
  },
  "lazy": true
}
```

- `headers` — literal header values; `${VAR}` / `$VAR` patterns are interpolated from `process.env` at load time (throws if unset).
- `envHeaders` — maps header name → env var name; value is read from `process.env[name]` at connect time.
- Precedence: explicit `Authorization` in `headers`/`envHeaders` wins over the `authTokenKey`-derived bearer token. If `authTokenKey` is set and token retrieval fails, the connection is refused (no silent fallback to unauthenticated).

No code changes required. Call `ch1tty/reload` to pick up changes without restarting.

## Sibling Relationship with ChittyOS

Ch1tty and ChittyOS are **siblings**, not parent/child. ChittyOS is an ecosystem of services at `*.chitty.cc`; ch1tty is a peer system that registers with the ChittyOS registry like any other external participant. Ch1tty aggregates ChittyOS services alongside non-ChittyOS MCP backends — the gateway treats all sources equivalently through the `Backend` interface.

## Split Architecture (Code-Mode + Focused Servers)

Ch1tty's **own** surface family mirrors the `github.com/cloudflare/mcp-server-cloudflare` pattern:

- **Ch1tty gateway** plays the **Code-Mode** role — one broad slim-MCP surface at `ch1tty.chitty.cc/mcp` with exactly 5 meta-tools, aggregating every registered backend (ChittyOS services + any other MCP source). Used for cross-domain, intent-driven, discover-then-invoke work.
- **`apps/*-mcp`** holds ch1tty's own focused per-domain MCP surfaces — one concern per server, purpose-built typed tools. Many adapt a ChittyOS domain (e.g. `apps/tasks-mcp/` wraps `chittyentity/workers/chittyagent-tasks`, the canonical tasks service, as an MCP surface); others may wrap non-ChittyOS sources. The canonical backend service lives in its own repo; ch1tty's focused surface is a peer MCP translator.
- **`packages/`** holds shared code between the gateway and the focused surfaces (Backend interface, logger, transport glue).

**Rule (binding):** New MCP surface ch1tty wants to expose → new focused server under `apps/`, registered as a backend in `servers.json`; never inline domain logic in the ch1tty gateway. Canonical domain state stays in its home service (e.g. chittyagent-tasks, ChittyLedger) — ch1tty only surfaces it via MCP. See `apps/README.md` for the planned server roster.

## HTTP Server

Set `CH1TTY_PORT` to enable the HTTP server with MCP transport:

```bash
CH1TTY_PORT=9099 CH1TTY_MCP_TOKEN=secret123 npm start
```

Endpoints on `{bindAddress}:{port}`:
- `GET /health` — `{"status":"ok","service":"ch1tty","version":"<VERSION>"}` (VERSION sourced from `src/utils.ts`, not hardcoded in docs)
- `GET /api/v1/status` — Full gateway status snapshot. Returns 500 + `{"error":"internal"}` on server-side failure (never a fake-ok envelope).
- `GET /api/v1/sessions` — Active MCP session list (bearer-auth if configured)
- `* /mcp` — **Streamable HTTP MCP endpoint** (bearer token required if `CH1TTY_MCP_TOKEN` is set)

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `CH1TTY_PORT` | HTTP server port (enables HTTP transport) |
| `CH1TTY_MCP_TOKEN` | Bearer token for `/mcp` + `/api/v1/sessions` auth |
| `CH1TTY_ALLOW_UNAUTH` | Set to `1` to allow starting HTTP server on non-loopback without a token (emits loud warning). Without this flag, the server refuses to bind. |
| `CH1TTY_CONFIG` | Custom servers.json path |
| `CH1TTY_ACCESS` | Filter servers by access level (read/write/readwrite) |
| `CH1TTY_CATEGORY` | Filter servers by category |
| `CH1TTY_LEDGER_DLQ` | Override the ledger dead-letter WAL path (default `~/.ch1tty/ledger.dlq.jsonl`) |

## Registration

Registration payload is in `register.json`. Submit to `register.chitty.cc`:

```bash
CHITTY_REGISTER_TOKEN=... ./scripts/register.sh
```
