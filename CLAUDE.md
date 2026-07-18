---
uri: chittycanon://docs/tech/procedure/ch1tty-dev-guide
namespace: chittycanon://docs/tech
type: procedure
version: 4.1.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
certifier: chittycanon://core/foundation/mychitty-vault
title: "Ch1tty Development Guide"
visibility: PUBLIC
---

# CLAUDE.md — Ch1tty

## What This Is

Ch1tty is a **sibling** of ChittyOS — not a ChittyOS-internal service. It's one MCP surface that brings ChittyOS (and any other MCP source) through a single interface. The surface has **no single interaction modality** — the same endpoint serves LLM chat frontends, agent runtimes, and server-to-server backends. Whether it behaves agentically is decided by the consumer on the other end; ch1tty itself just exposes the 5 slim-MCP meta-tools (`search`, `execute`, `status`, `reload`, `cast`) plus the resources/prompts passthrough and lets the caller drive.

The meta-tools + SessionCoordinator + cast's intent resolution + (planned) brain backend make the surface *agent-capable*: discover → reason → execute over the full aggregated registry, keeping client context minimal. Plain MCP clients use the same tools without any reasoning loop.

Aggregation covers MCP servers of every shape: local stdio children, remote HTTP endpoints, ChittyOS services (via their own MCP surfaces), and arbitrary third-party MCP sources — all through the same `Backend` interface.

Ch1tty is **the intelligent MCP**: through the Alchemist daemon + ContextConsciousness memory (in ChittyConnect), it observes how its backends are composed in practice and can spawn new MCP services from existing ones — promoting recurring cross-backend patterns into their own focused surfaces under `apps/*-mcp`. The intelligence is structural (topology + pattern memory + alchemical router), not an embedded LLM. See CHITTY.md § *Alchemical Self-Composition*.

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
- **`buildCastExplanation` metric freeze**: Do NOT add new statistical fields, ratios, percentile cross-comparisons, or observability metrics to `cast explain`. The `verbosity` param (`low`/`medium`/`full`) was added to manage the existing 120+ fields. Every field that belongs in `explain` is already there. Any PR adding a new metric/ratio/statistical measure to `buildCastExplanation` MUST be rejected.

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

## Focus Profiles (Soft Lens)

A **focus profile** is a named bundle (`finance`, `governance`, `design`, …) that biases the registry toward one direction without hiding anything — a lens, not a gate. Profiles are data-driven in `focus-profiles.json` at repo root (loaded + validated like `servers.json`); each maps a name to relevant `categories` and/or `servers` plus an additive `boost` (default 0.5).

It does **not** add a 6th public tool. Selection works two ways:
- **Process default**: `CH1TTY_FOCUS=finance npm start`
- **Per-call**: a `focus` parameter on `ch1tty/search` and `ch1tty/cast` overrides the default for that call; `focus: "none"` (or `""`) explicitly disables focus.

When active, in-focus tools are additively boosted and re-sorted to the top of `search` and `cast` results (both the keyword fallback and brain routes); out-of-focus tools stay present and reachable. `ch1tty/status` reports the active focus + available profiles. Profiles may reference disabled/future server ids — they simply don't match until those servers exist.

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
- `GET /health` — `{"status":"ok","service":"ch1tty","version":"<VERSION>"}` (always 200; process-level ping only)
- `GET /api/v1/health` — Liveness probe (no auth required). Returns **200** if `systemHealth.status` is `ok` or `warn`; **503** if `degraded` (ledger DLQ backlog; brain circuit open is `warn` not `degraded`). Normal body: `{"status":"ok|warn|degraded","service":"ch1tty","systemHealth":{...}}`. **ok body** additionally includes `ledgerOk: true` when `systemHealth.ledgerStatus === 'ok'` (ledger fully clean; symmetric to `ledgerWarn`). **warn body** additionally includes `brainCircuitOpen: true` when `systemHealth.brainDegraded === true` (Ollama/embedding circuit open) and `ledgerWarn: true` when `systemHealth.ledgerStatus === 'warn'` (drops/flushErrors present but no DLQ backlog); either or both may appear together. **503 body** additionally includes `ledgerDlq: { entryCount: N }` so callers can see the backlog depth without a separate `/api/v1/status` call. On internal snapshot failure: **503** with `{"status":"degraded","service":"ch1tty","error":"internal"}` (no `systemHealth` or `ledgerDlq` fields).
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
| `CH1TTY_FOCUS` | Default focus profile name — a soft lens that biases `search`/`cast` ranking toward in-focus tools (e.g. `finance`, `governance`, `design`). Never hides out-of-focus tools. Per-call `focus` param on `search`/`cast` overrides it (`"none"` disables). |
| `CH1TTY_FOCUS_PROFILES` | Custom focus-profiles.json path (default `focus-profiles.json` at repo root) |
| `CH1TTY_LEDGER_DLQ` | Override the ledger dead-letter WAL path (default `~/.ch1tty/ledger.dlq.jsonl`) |
| `CH1TTY_SPAWN_TIMEOUT_MS` | Override the local child-process spawn+connect timeout (default 30000ms). Lower it in test environments to avoid 30s waits when backends are unavailable. |
| `CH1TTY_REMOTE_TIMEOUT_MS` | Override all remote proxy timeouts (connect: 15s, list: 15s, call: 120s) to the given value in milliseconds. Lower it in test environments to avoid long waits when remote backends are slow or hanging. |
| `CH1TTY_OLLAMA_CIRCUIT_THRESHOLD` | Consecutive failures before OllamaBrain circuit opens (default 3). |
| `CH1TTY_OLLAMA_CIRCUIT_COOLDOWN_MS` | How long OllamaBrain circuit stays open before a half-open probe (default 60000ms). |
| `CH1TTY_SESSION_TTL_MS` | Inactive session TTL in ms — sessions that have had no tool calls for this duration are auto-evicted from memory (default 3600000 = 1h). Set to 0 to disable eviction. |
| `CH1TTY_SESSION_EVICT_INTERVAL_MS` | How often the eviction sweep runs (default 300000 = 5min). Ignored when TTL is 0. |

## Registration

Registration payload is in `register.json`. Submit to `register.chitty.cc`:

```bash
CHITTY_REGISTER_TOKEN=... ./scripts/register.sh
```
