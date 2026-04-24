---
uri: chittycanon://docs/tech/architecture/ch1tty
namespace: chittycanon://docs/tech
type: architecture
version: 4.1.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "Ch1tty Architecture"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# CHITTY.md — Ch1tty

## Identity

Ch1tty is a **sibling** of ChittyOS — a peer that registers with the ChittyOS registry, not a ChittyOS-internal service. Its role is to bring all of ChittyOS (and any other MCP source it's registered against) through **one MCP surface** with no assumed interaction modality. The same endpoint serves:

- **LLM chat frontends** (Claude.ai, ChatGPT, Claude Desktop, Claude Code) — where the reasoning loop on the other end turns `search` + `execute` + `cast` into a discover-reason-execute agent pattern
- **Agent runtimes** (CF Agents, autonomous agents, daemons) — same meta-tools, agentic by virtue of the consumer
- **Server-to-server integrations** — plain MCP over Streamable HTTP; no LLM needed, the client just uses the typed surface

The 5 slim-MCP meta-tools (`search`, `execute`, `status`, `reload`, `cast`), the session coordinator, and (planned) the brain backend make the surface *agent-capable*. They do not require the consumer to be an agent — that's determined at the other end of the connection.

## Service Identity

| Field | Value |
|-------|-------|
| Canonical URI | `chittycanon://core/services/ch1tty` |
| Tier | 2 (Platform) |
| Domain | `ch1tty.chitty.cc` / local stdio |
| Certification | CERTIFIED (ChittyCertify) |

## Architecture Summary

Ch1tty is a Node.js MCP server that acts as a slim-MCP gateway. It exposes 5 tools (`search`, `execute`, `status`, `reload`, `cast`) while internally maintaining a full registry of 100+ tools across multiple backends via the `Backend` interface:

- **Local backends** (`ChildManager`): Spawned as child processes via `StdioClientTransport`
- **Remote backends** (`RemoteProxy`): Reached via `StreamableHTTPClientTransport`

Both implement the same `Backend` interface — the aggregator routes via `Map<serverId, Backend>`.

Dual transport: **stdio** (always active) + **Streamable HTTP** on `/mcp` (enabled via `CH1TTY_PORT`).

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Language | TypeScript (ES2022, Node16 modules) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Auth | `chitty-mcp-token` (1Password CLI wrapper) |
| Config | `servers.json` (declarative, with path interpolation) |

## Ecosystem Position

```
AI Client (Claude Code / Codex)
    │ stdio
    ▼
  Ch1tty ─── search ──► Internal tool registry (cached)
    │         execute ─► Backend routing
    │         cast ────► intent → search → execute (sub-meta)
    │
    ├── ChildManager ──► Local MCP servers (stdio children)
    │                    └ neon, context7, thinking, fs, playwright
    │
    └── RemoteProxy ───► Remote MCP endpoints (HTTP)
                         └ mcp-portal.chitty.cc, mcp.cloudflare.com,
                           browser.mcp.cloudflare.com, ...

Remote AI Client (Claude web / ChatGPT / CF Agents)
    │ Streamable HTTP (/mcp)
    ▼
  Ch1tty (same aggregator, same 5 tools)
```

## Consumers

- Claude Code sessions (stdio)
- Claude Desktop (stdio)
- Claude web / ChatGPT / Cloudflare Agents (HTTP)
- OpenAI Codex (stdio)
- Any MCP-compatible client

## Sibling Relationship with ChittyOS

Ch1tty and ChittyOS are **siblings**, not parent/child. ChittyOS is an ecosystem of services at `*.chitty.cc` (ChittyID, ChittyAuth, ChittyRegister, chittyagent-tasks, etc.); ch1tty is a peer system that exposes MCP surfaces — to itself, to ChittyOS, and to any other MCP ecosystem. Ch1tty registers **with** the ChittyOS registry (`register.chitty.cc`) like any other external participant; it is not *of* ChittyOS.

Per memory `project_fractal_architecture.md` — "Ch1tty IS the system fractalized" — and `project_ch1tty_user_mirror.md` — ch1tty is a mirror to its user, co-evolving on its own axis.

## Split Architecture

Ch1tty's own surface family follows the `github.com/cloudflare/mcp-server-cloudflare` split pattern:

| Role | Ch1tty surface | Endpoint |
|------|----------------|----------|
| Code-Mode (broad) | **Ch1tty gateway** (this repo's `src/`, future `apps/gateway/`) | `ch1tty.chitty.cc/mcp` — 5 slim-MCP meta-tools over the full backend registry |
| Focused per-domain (typed) | `apps/*-mcp` (ch1tty-owned) | Purpose-built MCP surfaces. First populated: `apps/tasks-mcp/` wrapping the ChittyOS service at `chittyentity/workers/chittyagent-tasks`. Planned: `ledger-mcp`, `session-coordinator-mcp`, `evidence-mcp`, each wrapping or adapting a ChittyOS domain |

The `apps/*-mcp` servers are **ch1tty's own focused surfaces**, not ChittyOS services. Some adapt ChittyOS domain concerns (tasks, ledger, evidence) into typed MCP tools; others may expose non-ChittyOS sources. The canonical service (e.g. `chittyagent-tasks`) lives in its own ChittyOS repo; ch1tty's focused server is a peer MCP translator.

Clients pick based on need: cross-domain / intent-driven work goes through the ch1tty gateway; typed single-domain integrations can dial the focused surface directly.

The pattern is **fractal** (memory: `project_fractal_architecture.md`) — each focused server itself exposes a slim-MCP viewport over its sub-primitives, so the Code-Mode-over-focused-surfaces shape repeats at every layer. See `apps/README.md` for the current + planned roster.

## Alchemical Self-Composition (The Intelligent MCP)

Ch1tty is **greater than the sum of its registered backends**. Through the **Alchemist** daemon + **ContextConsciousness** memory layer (both living in ChittyConnect), ch1tty observes how its backends are composed in practice and can **spawn new MCP services from its existing ones** — making the `apps/*-mcp` roster an emergent output of use, not a static plan:

1. **ContextConsciousness** records persistent patterns — which tools are invoked in sequence, which cross-backend workflows recur, which intents keep resolving through cast to the same composite path, which sessions keep reaching across the same ~3 backends
2. **Alchemist** performs contextual routing/transformation over that pattern store — scoring when a recurring composite has coalesced into a distinct concern worth its own surface
3. **Spawn** — a new focused MCP server materializes under `apps/*-mcp`, wrapping the composite as typed tools. What was an emergent cross-backend pattern becomes a first-class surface that `search` + `execute` can route to directly

This is **ongoing intelligent design and decisioning** — ch1tty's topology evolves from use, not from upfront architectural decree. The fractal property makes this natural: the Code-Mode-over-focused-servers shape can replicate at any scale, so ch1tty grows new sub-surfaces without changing its 5-meta-tool public contract.

Cross-references:
- `project_alchemist_integration.md` — 3-layer cast pipeline (keyword → Ollama → Alchemist contextual routing)
- `project_ch1tty_user_mirror.md` — "fission when the relationship outgrows the container" (spawn = fission)
- `project_session_coordinator_vision.md` — session coordinator stages the memories/patterns that inform alchemy
- `feedback_governance_looseness.md` — governance defines environment, patterns emerge; coordinator pays attention, doesn't control

The "intelligent" in *intelligent MCP* refers to this capability, not to ch1tty being an LLM. Ch1tty itself doesn't reason — its intelligence is in the structure: a registered backend topology + a pattern-memory layer + an alchemical router that together decide, over time, what deserves to become its own surface.

## Certification

| Check | Status |
|-------|--------|
| CLAUDE.md | Present |
| CHARTER.md | Present |
| CHITTY.md | Present |
| Health endpoint | Available (CH1TTY_PORT) |
| Registry entry | Ready (register.json) |
