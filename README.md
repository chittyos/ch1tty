![ChittyOS](https://img.shields.io/badge/ChittyOS-service-6366F1?style=flat-square)
![Tier](https://img.shields.io/badge/tier-2%20platform-3730A3?style=flat-square)

# Ch1tty

> ChittyOS Universal MCP Gateway — slim-MCP: search, execute, and cast.

Ch1tty aggregates all MCP servers behind 5 tools: `search`, `execute`, `status`, `reload`, `cast`. The full tool registry (100+ tools across local stdio children and remote HTTP endpoints) stays internal — clients discover capabilities via search and invoke them via execute/cast, keeping context windows minimal.

**Dual transport**: stdio for local clients, Streamable HTTP (`/mcp`) for remote clients.

## Canonical Contract

Ch1tty is a fractal orchestrator viewport.

- Fixed public surface: `ch1tty/search`, `ch1tty/execute`, `ch1tty/status`, `ch1tty/reload`, `ch1tty/cast`.
- Session coordination and affinity are internal; backend namespaces are not directly exposed.

## Strict Orchestrator Profile

```bash
CH1TTY_CONFIG=./servers.orchestrator.json npm start
```
