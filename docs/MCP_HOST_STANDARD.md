# MCP Host Standard

This document defines the canonical external MCP host pattern across ChittyOS and ch1tty-adjacent surfaces.

## Goal

Give every major client class a predictable entrypoint without forcing each product team to rediscover route, OAuth, and discovery behavior.

The standard is:

- One canonical "smart" aggregate MCP host
- One canonical Cloudflare-managed native MCP Portal host
- Optional client-branded aliases that preserve the same semantics
- Cloudflare-managed auth at the edge where possible
- Public discovery docs, protected `/mcp`

## Canonical Matrix

### Smart aggregate

- Host: `mcp.ch1tty.com`
- Semantics: intelligent aggregate MCP
- Behavior: broad discovery, orchestration-friendly, intended to be the "paste this into a connector" primary endpoint
- Current worker owner: `chittyagent-ch1tty`

### Managed aggregate (native Cloudflare MCP Portal)

- Host: `mcp.chitty.cc`
- Semantics: Cloudflare-managed native MCP Portal (`chitty-mcp`)
- Behavior: Cloudflare-owned federation of registered upstream tools/prompts under `/mcp`; not a custom Worker route or per-service proxy namespace
- Runtime owner: Cloudflare One MCP Portals; ChittyRegister/ChittyRegistry retain governed registration and catalog ownership
- Auth model: Cloudflare Access Managed OAuth

### Smart ChatGPT alias

- Host: `chatgpt.ch1tty.com`
- Semantics: branded alias for the smart aggregate
- Behavior: same discovery shape as `mcp.ch1tty.com`, client-specific hostname only
- Current worker owner: `chittyagent-ch1tty`

### Native-portal ChatGPT alias (separate route)

- Host: `chatgpt.chitty.cc`
- Semantics: branded alias for the dumb aggregate
- Behavior: same discovery shape as `mcp.chitty.cc`, client-specific hostname only
- Current worker owner: `chittymcp-gateway`

## Discovery Contract

Every public MCP hostname in this family must serve:

- `GET /.well-known/chitty.json`
- `GET /.well-known/mcp.json`
- `GET /health`

If the host uses OAuth, it must also serve the relevant OAuth discovery documents, either from origin or via Cloudflare Access:

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource/<resource>` or the Cloudflare equivalent

Minimum contract:

- discovery documents are public
- `/mcp` is the authenticated transport
- the `mcp_base` in `chitty.json` matches the hostname actually used by the client
- the MCP card `url` points to `https://<host>/mcp`

## Auth Standard

Preferred standard for internet-facing remote MCP:

- Cloudflare Access Managed OAuth owns OAuth
- origin worker behaves like a plain MCP transport behind Access
- `/.well-known/*` required for discovery are public
- `/mcp` remains protected

Do not stack a custom origin OAuth flow in front of Cloudflare Access unless there is a concrete reason. That creates connector breakage and duplicates responsibilities Cloudflare already handles.

## Client Alias Rule

Do not create a new host per client by default.

Use this order:

1. Canonical host first
2. Branded alias only when a client, marketplace, or operator workflow benefits from a dedicated hostname
3. Alias must preserve the same semantics as its canonical host

Examples:

- `chatgpt.ch1tty.com` is an alias for the smart aggregate, not a separate product
- `chatgpt.chitty.cc` is an alias for the dumb aggregate, not a separate product

If equivalent Claude, Codex, or OpenClaw aliases are ever introduced, they should follow the same rule: alias only, no semantic drift.

## Ownership Model

The public host contract spans multiple repos today. That is acceptable only if ownership is explicit.

### Current ownership

- **Cloudflare One MCP Portals**
  - owns native portal `chitty-mcp` at `mcp.chitty.cc`, its Access, OAuth, server membership and tool/prompt projections
  - retains sole route/DNS ownership for the host, via proxied CNAME `gateway.agents.cloudflare.com`
- **ChittyRegister / ChittyRegistry**
  - own governed registration and canonical service catalog; historical Worker manifests are not authoritative
- `chittyconnect`
  - brokers runtime authorization/secret insertion, not the managed portal's HTTP routes
- `chittyentity`
  - currently owns the smart aggregate worker surface for `mcp.ch1tty.com` and `chatgpt.ch1tty.com`
- `chittymcp`
  - owns legacy service-binding aggregation at `mcp-aggregator.chitty.cc`, not `mcp.chitty.cc`
  - maintains the separate ChatGPT-facing dumb-alias worker projection `chittymcp-gateway` (verify current deployed ownership independently)

### Guardrail

DNS, managed portal configurations, Access, Worker routes, and discovery handlers must be treated as one logical contract. For `mcp.chitty.cc`, the native Cloudflare portal supersedes any historical Worker claim. Do not recreate `mcp.chitty.cc/*` Worker routes.

Any host rollout or migration must verify:

1. DNS exists and is proxied
2. worker route exists and points to the intended script
3. `/.well-known/chitty.json` returns `200`
4. `/.well-known/mcp.json` returns `200`
5. `/health` returns `200`
6. `/mcp` is reachable under the intended auth model
7. Managed portal `chitty-mcp` has sole hostname ownership and its upstream mappings are current
8. MCP Inspector authorizes and invokes a real tool; `Ready` sync status alone is not an end-to-end proof

## Repeated Pattern

For a new canonical or alias host, the repeated pattern is:

1. Classify a host as a Cloudflare-managed portal or a custom Worker (never both)
2. For managed portal hosts, create the native MCP Portal with Access and a proxied CNAME to `gateway.agents.cloudflare.com`, not a Worker route
3. For custom Worker hosts, bind a Worker route on its own hostname
4. Expose host-appropriate public discovery and protect `/mcp`
5. Verify hostname-matched metadata and complete an authenticated MCP Inspector tool call

This keeps ChatGPT, Claude, Claude Code, Codex, mobile clients, and other remote MCP consumers on the same predictable shape.

## What Not To Do

- Do not expose discovery docs only behind Access
- Do not let aliases drift into separate semantics
- Do not make route ownership implicit across repos
- Do not publish a hostname unless DNS, route, and discovery are all present
- Do not add another custom OAuth layer when Cloudflare Managed OAuth already covers the need

## Managed versus internal aggregate — reconciler safeguard (2026-10-11)

**Public:** `https://mcp.chitty.cc/mcp` is native Cloudflare portal `chitty-mcp`.
Cloudflare owns OAuth, Access, upstream membership, and tool/prompt exposure.
This host does not expose legacy `/{service}/mcp` or `/v0.1/servers` routes.

**Legacy internal:** `https://mcp-aggregator.chitty.cc/mcp` is the separate
`chittymcp` service-binding Worker. It may be retained for internal
compatibility but never owns the native portal's hostname. Its OAuth and
liveness must be validated separately.

**Role portals:** `dev.chitty.cc`, `chode.chitty.cc`, `cf.chitty.cc`,
`msg.chitty.cc`, `portal.gws.chitty.cc`, `apify.portal.chitty.cc`,
and `vm.ch1tty.com` are distinct native Cloudflare MCP portal projections.
Do not blindly copy membership or authorization between role portals.
