# MCP Host Standard

This document defines the canonical external MCP host pattern across ChittyOS and ch1tty-adjacent surfaces.

## Goal

Give every major client class a predictable entrypoint without forcing each product team to rediscover route, OAuth, and discovery behavior.

The standard is:

- One canonical "smart" aggregate MCP host
- One canonical "dumb" aggregate MCP host
- Optional client-branded aliases that preserve the same semantics
- Cloudflare-managed auth at the edge where possible
- Public discovery docs, protected `/mcp`

## Canonical Matrix

### Smart aggregate

- Host: `mcp.ch1tty.com`
- Semantics: intelligent aggregate MCP
- Behavior: broad discovery, orchestration-friendly, intended to be the "paste this into a connector" primary endpoint
- Current worker owner: `chittyagent-ch1tty`

### Dumb aggregate

- Host: `mcp.chitty.cc`
- Semantics: plain aggregate MCP
- Behavior: direct aggregate surface without the "intelligent MCP" positioning
- Current worker owner: `chittyconnect`
- Auth model: Cloudflare Access Managed OAuth

### Smart ChatGPT alias

- Host: `chatgpt.ch1tty.com`
- Semantics: branded alias for the smart aggregate
- Behavior: same discovery shape as `mcp.ch1tty.com`, client-specific hostname only
- Current worker owner: `chittyagent-ch1tty`

### Dumb ChatGPT alias

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

- `chittyconnect`
  - owns the dumb aggregate semantics at `mcp.chitty.cc`
  - owns the public service catalog used to populate `/.well-known/chitty.json`
- `chittyentity`
  - currently owns the smart aggregate worker surface for `mcp.ch1tty.com` and `chatgpt.ch1tty.com`
- `chittymcp`
  - currently owns the ChatGPT-facing dumb alias worker at `chatgpt.chitty.cc` via `chittymcp-gateway`

### Guardrail

DNS, worker routes, and discovery handlers must be treated as one logical contract. Do not update only one of the three.

Any host rollout or migration must verify:

1. DNS exists and is proxied
2. worker route exists and points to the intended script
3. `/.well-known/chitty.json` returns `200`
4. `/.well-known/mcp.json` returns `200`
5. `/health` returns `200`
6. `/mcp` is reachable under the intended auth model

## Repeated Pattern

For a new canonical or alias host, the repeated pattern is:

1. Create proxied DNS
2. Bind worker route
3. Expose public discovery docs
4. Protect `/mcp`
5. Verify the rewritten discovery payload uses that exact hostname

This keeps ChatGPT, Claude, Claude Code, Codex, mobile clients, and other remote MCP consumers on the same predictable shape.

## What Not To Do

- Do not expose discovery docs only behind Access
- Do not let aliases drift into separate semantics
- Do not make route ownership implicit across repos
- Do not publish a hostname unless DNS, route, and discovery are all present
- Do not add another custom OAuth layer when Cloudflare Managed OAuth already covers the need
