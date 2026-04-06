---
uri: chittycanon://docs/tech/architecture/ch1tty
namespace: chittycanon://docs/tech
type: architecture
version: 3.0.0
status: ACTIVE
registered_with: chittycanon://core/services/canon
title: "Ch1tty Architecture"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# CHITTY.md — Ch1tty

> `chittycanon://core/services/ch1tty` | Tier 0 (Core Engine) | `ch1tty.com`

## What It Is

Ch1tty is an intelligent middleware agent — a custom Ollama model that sits between users and all capabilities. Not a proxy. Not a router. Meta — it chooses which strategy to use.

## Architecture

### Two Layers

```
Custom Ollama Model (the intelligence)
    │
    │  Makes meta-decisions:
    │  "Use orchestrator? Go direct? Fan out? Queue? Build new strategy?"
    │
    ▼
Node.js MCP Aggregator (the plumbing)
    │
    │  Executes the decision:
    │  Routes to backends, manages connections, enforces policies
    │
    ├── Local backends (stdio children): neon, playwright, fs, context7
    ├── Remote backends (HTTP): connect.chitty.cc, Cloudflare MCP
    ├── Cloud substrates: Claude, Gemini, GPT, Codex
    └── Internal organs: orchestrator, alchemist, gateway, daemon
```

### Stack

| Component | Technology |
|-----------|-----------|
| Intelligence | Custom Ollama model (meta-routing, strategy selection) |
| MCP Runtime | Node.js + `@modelcontextprotocol/sdk` |
| Cloud Gateway | `chittyagent-ch1tty` (Cloudflare Worker, OAuth 2.1, McpAgent) |
| Auth | `chitty-mcp-token` (1Password CLI wrapper) |
| State | Neon (Hyperdrive) + KV (orchestrator state) |
| Config | `servers.json` (declarative backend registry) |
| Telemetry | chittytrack (tail consumers on all workers) |

### Ecosystem Position

```
myCh1tty instances (user agents)
    │
    │  Custom connections route THROUGH Ch1tty's system connections
    │
    ▼
Ch1tty (meta-middleware)
    │
    │  Strategy selection ─── not fixed routing
    │
    ├── Orchestrator path ── when TY-VY-RY evaluation needed
    ├── Direct path ──────── simple trusted request, skip overhead
    ├── Fan-out path ─────── parallel to multiple substrates
    ├── Queue path ────────── batch for cron cycle
    ├── Alchemist path ───── unknown territory, learn first
    ├── Direct-connect ────── recommend myCh1tty bypass Ch1tty
    └── New strategy ─────── Alchemist proposes, Ch1tty adopts
```

### Bidirectional Relationship with myCh1tty

```
Normal:    myCh1tty → Ch1tty → capability
Direct:    myCh1tty ──────────→ capability  (Ch1tty recommended it)
Callback:  Ch1tty → myCh1tty → response     (Ch1tty needs user context)
```

Ch1tty and myCh1tty are peer in capability, hierarchical in role. Ch1tty can be a client of myCh1tty when it needs user-specific context that it shouldn't store centrally.

## Three Learning Modes

### 1. System Learning (Non-identifiable, Aggregate)

| Signal | Action |
|--------|--------|
| Tool X fails 30% globally | Fix or retire tool X |
| Nobody uses tool Y | Deprecation candidate |
| Common request shape, no tool | Build new system connection |
| Route Z slow globally | Optimize routing |

Fed by: Alchemist (system mode) analyzing chittytrack telemetry.
Output: New system connections, retirements, optimizations available to ALL users.

### 2. User Preference Learning (Bounded, Schema-Defined)

| Field | Example |
|-------|---------|
| Tool preferences | "Prefers Claude for code, Gemini for search" |
| Industry | "Legal / PropTech" |
| Code preferences | "TypeScript, 2-space, ESM, strict mode" |
| Active connections | "Notion, GitHub, Neon, Mercury enabled" |
| Behavioral patterns | "CST timezone, works 9-5" |
| Interaction style | "Terse responses, no emojis" |

These are fields Ch1tty decided to track. A defined schema.
Like Spotify tracking genre preferences within genres it already knows.

### 3. What Ch1tty Does NOT Learn (myCh1tty's domain)

- Custom connection behavior (user's API auth quirks)
- Custom semantics ("deploy" means Cloudflare for this user)
- Custom workflows (5-stage lease pipeline)
- Custom error recovery (retry this format on failure)
- Unbounded pattern discovery

## Internal Organs

| Organ | What it does for Ch1tty |
|-------|------------------------|
| **Orchestrator** | TY-VY-RY evaluation when Ch1tty selects the orchestrator strategy. Registry management. Channel protocol. Lifecycle engine. |
| **Alchemist (System)** | Watches aggregate telemetry, proposes new system connections, detects failures/redundancies, builds new strategies for Ch1tty to adopt. |
| **Gateway** (`chittyagent-ch1tty`) | Cloud-facing MCP interface. OAuth 2.1. Policy enforcement for non-local channels. Proxies to Ch1tty on the VM. |
| **Daemon** (`chittymarket-sync`) | Syncs Ch1tty's state to local nodes/channels. Runs per-node. Merges parallel sessions. |
| **Lifecycle Engine** | Entity management. Detects fission/fusion/suspension signals. TY-VY-RY-adjusted thresholds with Alchemy archetypes. |
| **ChittyMarket** | Capability catalog. 108+ artifacts. Zero standalone — all governed by Ch1tty. |

## Consumers

| Consumer | How they reach Ch1tty |
|----------|---------------------|
| myCh1tty instances | Middleware layer — custom connections route through |
| Claude Code | Daemon sync + direct MCP (stdio) |
| Claude Desktop / Mobile / Co-Work | chittyagent-ch1tty gateway (OAuth MCP) |
| Claude Code Remote | Daemon on remote host |
| ChatGPT | chittyagent-chatgpt → Ch1tty |
| Codex / Codex App | MCP or REST adapter |
| Gemini | ChittySeed template + webhooks |
| Homelab nodes (chittymini-01..06) | Daemon per node |
| Future channels | Universal channel protocol (POST /channels/register) |

## Commercial Position

Ch1tty is the **open / free tier**:
- 50+ programmed connections, free / usage-based
- System learning benefits everyone
- Bounded user preferences within defined schema
- Gateway to myCh1tty (paid) when user needs custom connections

## ChittyOS Ecosystem

### Certification
- **Badge**: ChittyCertified Gold
- **Certifier**: ChittyCertify (`chittycanon://core/services/chittycertify`)

### ChittyDNA
- **ChittyID**: Pending formal assignment
- **Entity Type**: Person (P, Synthetic)
- **Lineage**: Root (core engine)

### Dependencies
| Service | Purpose |
|---------|---------|
| ChittyConnect | State, credentials, intelligence APIs |
| ChittyAuth | Service tokens, identity verification |
| ChittyRegister | Service catalog |
| Neon | Persistent state (Hyperdrive) |
| 1Password | Cold credential source |
| chittytrack | Telemetry aggregation |

---
*Architecture Version: 3.0.0 | Last Updated: 2026-04-06*
