# packages/

Shared code between the gateway (current `src/`, future `apps/gateway/src/`) and the focused MCP servers under `apps/`.

## Planned packages

| Directory | Status | Contents |
|---|---|---|
| `shared-types/` | planned | `Backend` interface, `ServerConfig`, `ToolCallResult`, branded IDs (`ServerId`, `IsoTimestamp`, `McpSessionId`) |
| `shared-logger/` | planned | `log` singleton currently in `src/logger.ts` |
| `shared-mcp/` | planned | Streamable HTTP transport glue, bearer-auth helper |

This seeds the monorepo shape without requiring the full `src/` → `apps/gateway/src/` move in the same commit. Follow-up PRs will migrate modules as each focused server is added.
