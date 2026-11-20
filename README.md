![ChittyOS](https://img.shields.io/badge/ChittyOS-service-6366F1?style=flat-square)
![Tier](https://img.shields.io/badge/tier-2%20platform-3730A3?style=flat-square)

# Ch1tty

> The intelligent MCP — one surface that aggregates ChittyOS and beyond, *and grows new MCP services from its existing ones* through alchemical composition.

Ch1tty is a **sibling** of ChittyOS, not one of its services. It registers with the ChittyOS registry like any other peer and brings ChittyOS (plus non-ChittyOS MCP sources) through a single slim-MCP surface: `search`, `execute`, `status`, `reload`, `cast`. The surface has **no single interaction modality** — the same endpoint serves LLM chat frontends, agent runtimes, service-to-service backends, and any other MCP client. The meta-tools + session coordinator + cast's intent resolution make the surface *agentic when a reasoning consumer is on the other end*, but the same API works as a plain MCP endpoint for programmatic callers.

Ch1tty is **greater than the sum of its backends**. Through the Alchemist daemon + ContextConsciousness memory (in ChittyConnect), it watches how its registered services are composed in practice and can spawn new MCP services from existing ones — promoting recurring cross-backend patterns into their own focused surfaces under `apps/*-mcp`. See CHITTY.md for the self-composition mechanism.

## Memory authority

Ch1tty may use provider-native memory features as runtime-local projections or caches. Those stores are not canonical ChittyOS memory and must not become an independent source of truth. Canonical cross-session semantic/episodic memory is owned by ChittyConnect MemoryCloude; Ch1tty discovers or invokes that capability through the ecosystem surface when canonical memory is required.

The Worker currently exposes Cloudflare Agent Memory-backed `memory_recall`, `memory_ingest`, and `memory_summary` operations. Treat them as Ch1tty-runtime-local until they are explicitly proxied to the canonical MemoryCloude API.

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

## Development and focused app installs

Use Node.js 22 for the root workspace. Focused apps under `apps/` are also tested on Node.js 20. Each app keeps its own lockfile for an independent dependency install within a full repository checkout. Its build uses the root TypeScript type definitions and built shared packages; some app tests also exercise gateway source from the checkout.

For example, build and test the tasks app with its own locked dependencies:

```bash
# From the repository root:
npm ci
npm run build --workspace=packages/shared-types --workspace=packages/shared-logger --workspace=packages/shared-mcp

cd apps/tasks-mcp
npm ci --workspaces=false --install-links
npm run build
npm test
npm audit --omit=dev --workspaces=false
```

Use both install flags when installing or refreshing an app lockfile. `--workspaces=false` selects that app's lockfile, and `--install-links` installs the local shared package into the app so both resolve the same app-local MCP SDK. Rebuild the shared packages and reinstall the focused app after changing shared-package source. CI checks this installation path for all five apps on Node.js 20 and 22, and audits each app lockfile separately.
