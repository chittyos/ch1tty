![ChittyOS](https://img.shields.io/badge/ChittyOS-service-6366F1?style=flat-square)
![Tier](https://img.shields.io/badge/tier-2%20platform-3730A3?style=flat-square)

# Ch1tty

> The intelligent MCP — one surface that aggregates ChittyOS and beyond, *and grows new MCP services from its existing ones* through alchemical composition.

Ch1tty is a **sibling** of ChittyOS, not one of its services. It registers with the ChittyOS registry like any other peer and brings ChittyOS (plus non-ChittyOS MCP sources) through a single slim-MCP surface: `search`, `execute`, `status`, `reload`, `cast`. The surface has **no single interaction modality** — the same endpoint serves LLM chat frontends, agent runtimes, service-to-service backends, and any other MCP client. The meta-tools + session coordinator + cast's intent resolution make the surface *agentic when a reasoning consumer is on the other end*, but the same API works as a plain MCP endpoint for programmatic callers.

Ch1tty is **greater than the sum of its backends**. Through the Alchemist daemon + ContextConsciousness memory (in ChittyConnect), it watches how its registered services are composed in practice and can spawn new MCP services from existing ones — promoting recurring cross-backend patterns into their own focused surfaces under `apps/*-mcp`. See CHITTY.md for the self-composition mechanism.

## Canonical Contract

Ch1tty is a **fractal viewport orchestrator**, not a flat tool dump.

- Core surface is fixed to 5 meta-tools only:
  - `ch1tty/search`
  - `ch1tty/execute`
  - `ch1tty/status`
  - `ch1tty/reload`
  - `ch1tty/cast`
- Session coordination and affinity live behind this surface (SessionCoordinator + SessionTracker).
- Backend namespaces are internal implementation details and are only accessed via `search` + `execute`.

If the runtime exposes raw backend tools directly, the deployment is out of contract.

## Strict Orchestrator Profile

Use the strict profile to run a clean orchestrator lane with minimal backend overlap:

```bash
CH1TTY_CONFIG=./servers.orchestrator.json npm start
```

This profile keeps only the intended orchestration backends enabled and reduces namespace drift.

Ch1tty aggregates all MCP servers behind 5 tools: `search`, `execute`, `status`, `reload`, `cast`. The full tool registry (100+ tools across local stdio children and remote HTTP endpoints) stays internal — clients discover capabilities via search, invoke them via execute, and can use cast as the intent-to-execution wizard layer, keeping context windows minimal.

**Dual transport**: stdio for local clients, Streamable HTTP (`/mcp`) for remote clients.

## MCP Host Standard

The canonical external MCP host pattern and alias rules live in [docs/MCP_HOST_STANDARD.md](./docs/MCP_HOST_STANDARD.md).
