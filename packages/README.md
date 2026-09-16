# packages/

Shared code between the gateway (current `src/`, future `apps/gateway/src/`) and the focused MCP servers under `apps/`.

## Packages

| Directory | Status | Contents |
|---|---|---|
| `shared-types/` | **seeded** | `Backend` interface, `ServerConfig`, `ToolCallResult`, `ContentItem`, `AggregatedTool`, `ServerStatus`, and related shared types — canonical definitions that `src-stdio/types.ts` will import from here once workspaces are wired up |
| `shared-logger/` | **seeded** | `Logger` class + `log` singleton from `src-stdio/logger.ts`; `LogLevel` type |
| `shared-mcp/` | planned | Streamable HTTP transport glue, bearer-auth helper |

## Migration plan

This directory seeds the monorepo shape without requiring the full `src/` → `apps/gateway/src/` move in the same commit. Follow-up PRs will:

1. **Wire `shared-types`** — add `"workspaces": ["packages/*", "apps/*"]` to root `package.json`, add `@ch1tty/shared-types: "workspace:*"` to each app's deps, flip `src-stdio/types.ts` to re-export from `@ch1tty/shared-types`.
2. **Wire `shared-logger`** — flip `src-stdio/logger.ts` to re-export from `@ch1tty/shared-logger`.
3. **Seed `shared-mcp`** — extract Streamable HTTP transport + bearer auth helper.
4. **Move gateway to `apps/gateway/src/`** — last step after all shared packages are wired.

## Building packages

```bash
# build shared-types
cd packages/shared-types && npm install && npm run build

# build shared-logger
cd packages/shared-logger && npm install && npm run build
```
