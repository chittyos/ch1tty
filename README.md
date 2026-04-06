![ChittyOS](https://img.shields.io/badge/ChittyOS-service-6366F1?style=flat-square)
![Tier](https://img.shields.io/badge/tier-2%20platform-3730A3?style=flat-square)

# Ch1tty

> ChittyOS Universal MCP Gateway — slim-MCP: search + execute.

Ch1tty aggregates all MCP servers behind 4 tools: `search`, `execute`, `status`, `reload`. The full tool registry (100+ tools across local stdio children and remote HTTP endpoints) stays internal — clients discover capabilities via search and invoke them via execute, keeping context windows minimal.

**Dual transport**: stdio for local clients, Streamable HTTP (`/mcp`) for remote clients.
