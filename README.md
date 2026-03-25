![ChittyOS](https://img.shields.io/badge/ChittyOS-service-6366F1?style=flat-square)
![Tier](https://img.shields.io/badge/tier-2%20platform-3730A3?style=flat-square)

# Ch1tty

> ChittyOS Universal MCP Gateway — one stdio server, all backends.

Ch1tty aggregates all MCP servers — local stdio child processes and remote HTTP endpoints — behind a single stdio interface. AI clients connect to Ch1tty once instead of configuring 10+ individual servers. Tool names are namespaced (`serverId/toolName`), local servers spawn lazily on first use, and tool lists are cached for 5 minutes. A built-in `ch1tty/reload` tool hot-reloads `servers.json` without restarting the gateway.

**Domain**: local stdio (no HTTP deployment)
