# packages/

Shared code between the gateway (current `src/`, future `apps/gateway/src/`) and the focused MCP servers under `apps/`.

## Packages

| Directory | Status | Contents |
|---|---|---|
| `shared-types/` | **seeded** | `Backend` interface, `ServerConfig`, `ToolCallResult`, `ContentItem`, `AggregatedTool`, `ServerStatus`, and related shared types — canonical definitions that `src-stdio/types.ts` will import from here once workspaces are wired up |
| `shared-logger/` | planned | `log` singleton currently in `src/logger.ts` |
| `shared-mcp/` | planned | Streamable HTTP transport glue, bearer-auth helper |

## Migration plan

This directory seeds the monorepo shape without requiring the full `src/` → `apps/gateway/src/` move in the same commit. Follow-up PRs will:

1. **Wire `shared-types`** — add `"workspaces": ["packages/*", "apps/*"]` to root `package.json`, add `@ch1tty/shared-types: "workspace:*"` to each app's deps, flip `src-stdio/types.ts` to re-export from `@ch1tty/shared-types`.
2. **Seed `shared-logger`** — extract `log` singleton and wire imports.
3. **Seed `shared-mcp`** — extract Streamable HTTP transport + bearer auth helper.
4. **Move gateway to `apps/gateway/src/`** — last step after all shared packages are wired.

## Building shared-types

```bash
cd packages/shared-types
npm install   # installs typescript devDep
npm run build # tsc → dist/
```
