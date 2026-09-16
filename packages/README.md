# packages/

Shared code between the gateway (current `src/`, future `apps/gateway/src/`) and the focused MCP servers under `apps/`.

## Planned packages

| Directory | Status | Contents |
|---|---|---|
| `shared-types/` | seeded (PR #1305) | `Backend` interface, `ServerConfig`, `ToolCallResult`, branded IDs (`ServerId`, `IsoTimestamp`, `McpSessionId`) |
| `shared-logger/` | seeded | `Logger` class + `log` singleton from `src-stdio/logger.ts`; `LogLevel` type |
| `shared-mcp/` | planned | Streamable HTTP transport glue, bearer-auth helper |

This seeds the monorepo shape without requiring the full `src/` → `apps/gateway/src/` move in the same commit. Follow-up PRs will migrate modules as each focused server is added.

## Installation

```bash
# build shared-logger
cd packages/shared-logger && npm install && npm run build
```

After packages/shared-types and packages/shared-logger are on main, a follow-up PR will wire npm workspaces and update gateway + apps to import from these packages.
