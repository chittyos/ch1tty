---
uri: chittycanon://docs/tech/policy/ch1tty-charter
namespace: chittycanon://docs/tech
type: policy
version: 3.0.0
status: ACTIVE
registered_with: chittycanon://core/services/canon
title: "Ch1tty Charter"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# CHARTER.md — Ch1tty

**Canonical URI**: `chittycanon://core/services/ch1tty`

## Service Identity

| Field | Value |
|-------|-------|
| Name | Ch1tty |
| ID | ch1tty |
| Entity Type | Person (P, Synthetic) |
| Tier | 0 (Core Engine) |
| Domain | Intelligent Middleware Agent |
| Runtime | Custom Ollama model + Node.js MCP aggregator |
| URL | ch1tty.com |
| Status | Active |

## Purpose

Ch1tty is the **intelligent middleware agent** for the ChittyOS ecosystem. It sits between users (and their myCh1tty instances) and all capabilities — tools, MCPs, plugins, services, cloud substrates.

Ch1tty is not a proxy. It is not a router. It is **meta** — it chooses which routing strategy to use, which orchestrator to invoke, or whether to bypass middleware entirely.

Ch1tty is a Person (P, Synthetic) — a custom Ollama model that makes judgment calls, not a config file that follows rules.

## What Ch1tty Does

### 1. Programmed Connections (System)
Maintains 50+ system-level integrations available to all users:
- ChittyOS services (connect, auth, register, etc.)
- Cloud substrates (Claude, Gemini, GPT, Codex)
- External services (Notion, GitHub, Stripe, Mercury, Neon)
- Local MCP backends (filesystem, Playwright, sequential-thinking)

### 2. Meta-Routing (Strategy Selection)
Doesn't route — chooses WHICH routing strategy fits the request:

| Strategy | When Ch1tty uses it |
|----------|-------------------|
| Orchestrator (TY-VY-RY) | Identity/trust matters |
| Direct pass-through | Simple, trusted, go fast |
| Parallel fan-out | Send to multiple substrates, merge results |
| Queue/batch | Not urgent, batch for cron |
| Alchemist-first | Unknown territory, learn before routing |
| Direct connect | Recommend myCh1tty bypass middleware entirely |
| Build new strategy | Alchemist proposes, Ch1tty adopts |

### 3. System Learning (Non-identifiable)
Learns from aggregate, non-identifiable system feedback:
- Tool failure rates across all users → fix/retire
- Usage frequency → prioritize connections
- Request shapes with no tool → build new connections
- Latency/health patterns → optimize globally

### 4. User Preferences (Bounded, System-Defined)
Tracks a defined, bounded set of per-user personalization:
- Tool preferences (prefers Claude for code, Gemini for search)
- Industry (legal, proptech, finance, dev)
- Code preferences (language, style, conventions)
- Active connections (which system connections enabled)
- Behavioral patterns (timezone, work hours)
- Interaction style (terse vs verbose)

These are FIELDS Ch1tty decided to track. A defined schema. Not open-ended learning.

### 5. Gateway Policy Enforcement
Enforces policies for all channels that route through Ch1tty:
- Hook registry rules (synced from orchestrator KV)
- Focal trust gating (RY-plane evaluation)
- Credential scoping (per-user, per-connection)

### 6. myCh1tty Middleware
Serves as middleware for all myCh1tty instances:
- myCh1tty custom connections route THROUGH Ch1tty's system connections
- Ch1tty handles what it knows; myCh1tty handles what it doesn't
- Ch1tty can recommend direct connections (bypass middleware) when warranted
- Ch1tty can be a client OF myCh1tty when it needs user-specific context

## Scope

### IS Responsible For
- All system-level connections (programmed integrations)
- Meta-routing decisions (choosing the strategy, not just the route)
- System learning from aggregate non-identifiable feedback
- Bounded user preference tracking within defined schema
- Gateway policy enforcement for all channels
- Serving as middleware for myCh1tty instances
- MCP aggregation (tools, resources, prompts from all backends)

### IS NOT Responsible For
- Custom user connections (myCh1tty's domain)
- Unbounded user-specific learning (myCh1tty's domain)
- User-specific alchemy/optimization (myCh1tty's domain)
- Storing user credentials long-term (ChittyConnect / 1Password)
- Identity minting (ChittyID / orchestrator)
- Billing (ChittyCorp commercial layer)

## Internal Organs

These are how Ch1tty does its job — not standalone services:

| Component | Role |
|-----------|------|
| Orchestrator | TY-VY-RY evaluation, registry, channels, lifecycle |
| Alchemist | System telemetry → new tools, retirements, strategy proposals |
| Gateway (chittyagent-ch1tty) | Cloud-facing MCP interface, OAuth, policy enforcement |
| Daemon (chittymarket-sync) | Sync to local nodes/channels |
| Lifecycle engine | Entity management, fission/fusion/suspension |
| ChittyMarket | Capability catalog and manifest |

## Dependencies

### Upstream (Ch1tty depends on)
| Service | Purpose |
|---------|---------|
| connect.chitty.cc | ChittyConnect — state, credentials, intelligence APIs |
| Neon (Hyperdrive) | Persistent analytics, task queue, entity state |
| 1Password | Cold credential source |
| Local MCP servers | Neon, Playwright, filesystem, context7 |
| Cloud MCP endpoints | Cloudflare, builds, autorag |

### Downstream (depends on Ch1tty)
| Consumer | Relationship |
|----------|-------------|
| myCh1tty instances | Ch1tty is their middleware layer |
| Claude Code | Via daemon sync + MCP |
| Claude Desktop / Mobile | Via chittyagent-ch1tty gateway |
| ChatGPT | Via chittyagent-chatgpt → Ch1tty |
| Codex / Codex App | Via MCP or REST adapter |
| Gemini | Via ChittySeed template + webhooks |
| Homelab nodes | Via daemon per node |
| Any MCP-compatible client | Via universal channel protocol |

## Commercial Model

Ch1tty is the **free tier** of the ChittyOS product:
- All programmed connections: free / usage-based
- System learning improves everyone's experience
- Bounded user preferences personalize within the schema
- When a user needs CUSTOM connections → myCh1tty (paid tier)

## API Contract

### MCP Protocol (stdio + Streamable HTTP)
- `tools/list` — Union of all backend tools, namespaced `{serverId}/{toolName}`
- `tools/call` — Meta-routed to appropriate backend via strategy selection
- `resources/list` — Union of all backend resources
- `resources/read` — Routed to appropriate backend
- `prompts/list` — Union of all backend prompts
- `prompts/get` — Routed to appropriate backend

### Channel Protocol (REST)
- `POST /api/v1/channels/register` — New channel joins ecosystem
- `GET /api/v1/seed` — ChittySeed template (live, not static)
- `GET /api/v1/channels` — List registered channels

### Registry API (REST)
- `GET /api/v1/registry/{skills|agents|hooks}` — Current indices
- `POST /api/v1/registry/{skills|agents|hooks}` — Register new capability
- `GET /api/v1/lifecycle/{entities|signals}` — Entity state + signals

## Ownership

| Role | Owner |
|------|-------|
| Service Owner | ChittyCorp |
| Technical Lead | [`03-1-USA-8244-P-2603-0-33`](https://agent.chitty.cc/api/v1/entity/03-1-USA-8244-P-2603-0-33) — P, Synthetic: ChittyOS architecture, middleware design, lifecycle engine |
| Foundation Steward | ChittyFoundation (standards, certification) |
| Contact | ch1tty@chitty.cc |

---
*Charter Version: 3.0.0 | Last Updated: 2026-04-06*
