# ch1tty goal-driver board

Fallback board — Notion API token invalid (401). This file is the cross-run durable state.
Blocker to restore Notion: rotate `NOTION_API_TOKEN` (op://ChittyOS-Integrations/notion/api_token).

NOTE: Board trimmed at run 723 (2026-07-22). Full history preserved in git. Prior trims at runs 126, 201, 245, 349, 411, 484, 610.

## Workstream Status

All workstreams are DONE. Build clean, tests green, guardrails enforced.

- [x] **A** — Gateway up/refreshed/tested. Build clean, 5 meta-tools confirmed. DONE.
- [x] **B** — GitHub MCP migration: `servers.json` github → `https://api.githubcopilot.com/mcp/` with envHeaders. DONE.
- [x] **C** — Focus-profile layer: `focus-profiles.json` (6 profiles), CH1TTY_FOCUS, per-call focus param, status reporting, tests. DONE.
- [x] **D** — Scenario testing + simulation: `test/scenario.test.ts`, `test/simulation.test.ts`, `sim/scenarios.ts` harness. DONE.
- [x] **E** — Alchemist catalog: `focus-suggestions.json` (6 focus profiles, full tool coverage). DONE.
- [x] **Linear MCP** — `servers.json` + focus profiles + suggestions wired. DONE.
- [x] **GUARDRAIL-CLEANUP** — 900+ rogue `auto/*-cast-explain-*-ratio` branches violating the metric freeze are stale (content never merged). Source clean; 0 violations on main.

## Guardrail: buildCastExplanation metric freeze

**ACTIVE.** Every field that belongs in `cast explain` is already there. No new statistical fields, ratios, percentile cross-comparisons, or observability metrics may be added to `buildCastExplanation`. Any PR adding such a field MUST be rejected. See CLAUDE.md § *Architectural Guardrail*.

## Blockers

- **Notion API token** — Invalid (401). Human action: rotate `NOTION_API_TOKEN` in 1Password (`op://ChittyOS-Integrations/notion/api_token`).
- **ch1tty github backend** — `GITHUB_MCP_AUTHORIZATION` unset on prod. Set env var to reconnect the `github` backend in `servers.json`.
- **Branch cleanup** — 940+ stale `auto/` branches (including 260+ cast-explain violations). Git push --delete fails in this container. Human action: enable "Automatically delete head branches" in GitHub Settings → General, or run bulk-delete locally.
- **CI (main ci.yml)** — 0-job-queue failure (non-CodeQL). Recurring, non-blocking.
- **Ledger DLQ** — `ledger.chitty.cc` unreachable from remote container. Action: configure CF Access credentials (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) on prod.

## Candidate Workstream F (McpAgent Phases 2–4) — Awaiting Human Decision

PR #1047 (merged run 642) completed Phases 0+1 of the Cloudflare McpAgent migration:
- Phase 0: deps aligned (agents ^0.17.4, MCP SDK 1.29, zod v4, wrangler compat date)
- Phase 1: `Ch1ttyCore` extracted; `/mcp2` McpAgent endpoint added; 9 tools registered (search, execute, code, cast, provision, status, memory_recall, memory_ingest, memory_summary)

**Phases 2–4 (unscheduled):**
- Phase 2: Code Mode — wire `openApiMcpServer`-based typed API surface for `ch1tty/code` so clients get schema-validated tool calls instead of raw code strings
- Phase 3: OAuth cutover — migrate `/mcp` auth from bearer token to proper OAuth 2.0 via `@cloudflare/workers-oauth-provider`; unify auth with `/mcp2`
- Phase 4: Legacy decommission — deprecate and remove the legacy JSON-RPC DO at `/mcp`, making `/mcp2` the canonical endpoint

**Human action**: Add workstream F to enable Phase 2 work in the next run, or leave blank if phases 2–4 are not yet prioritized.

Note: `ch1tty/reload` is intentionally absent from `/mcp2` — hot-reload is a stdio/process-lifetime concern, not a Durable Object one.

## Human Actions Required

1. **Disable or redirect hourly schedule** — 640+ idle runs with no new work; every run costs compute.
2. **Add workstream F** (McpAgent Phases 2–4) to DRIVER-BOARD.md to give the driver new work to advance.
3. **Configure CF Access on prod** (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) — clears ledger DLQ.
4. **Set `GITHUB_MCP_AUTHORIZATION`** on prod to reconnect ch1tty GitHub backend.
5. **Rotate Notion token** — `op://ChittyOS-Integrations/notion/api_token`.
6. **Stale branch cleanup** — 940+ rogue `auto/` branches; enable auto-delete in GitHub Settings or bulk-delete locally.

## Run Log

_(Prior run log entries archived to git history — runs 1–609 trimmed at run 610, runs 610–722 trimmed at run 723. Full history in git log.)_

**Runs 610–711 (2026-07-17–21):** All idle. A–E done. 1370 pass/0 fail/2 skip. No open PRs.

**Run 712 (2026-07-21):** PR #1054 (Dependabot body-parser + hono bump) merged; PR #1055 (fast-uri override, superseded) closed.

**Run 712 addendum:** PR #1056 (auto/security-apps-fast-uri-fix) merged — fast-uri GHSA-4c8g-83qw-93j6 HIGH remediated. 5 HIGH vulns to 0.

**Runs 713–721 (2026-07-21–22):** PR #1057 (sharp override) + PR #1058 (@hono/node-server >=2.0.5) merged. npm audit: 0 vulnerabilities. Tests: 1370 to 1373 pass.

**Run 722 (2026-07-22):** Idle. 0 open PRs. 0 vulns. All A–E confirmed done.

### 2026-07-22 (run 723 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done; workstream F still awaiting human decision)
- **Branch/PR**: none (direct commit to main — run log + board trim)
- **Build**: clean (tsc exit 0, ch1tty@4.1.0) | **Tests**: 1373 pass / 0 fail / 2 skip (45 suites, 1375 total)
- **Actions**:
  - Synced to origin/main HEAD b9a8ad0 (run 722). Up to date.
  - npm ci clean. npm run build clean (tsc exit 0). npm test: 1373/0/2 (1375 total, ~40s).
  - 0 open PRs (GitHub MCP confirmed empty).
  - Verified all workstreams: A (build+tests green); B (github -> api.githubcopilot.com/mcp/ envHeaders); C (focus-profiles.json 6 profiles); D (scenario.test.ts + simulation.test.ts); E (focus-suggestions.json 1750 combos).
  - npm audit: 0 vulnerabilities (all resolved in runs 718-721).
  - Guardrails confirmed: 5-tool stdio surface (search/execute/status/reload/cast); buildCastExplanation metric freeze ACTIVE. 0 violations on main.
  - DRIVER-BOARD.md trimmed at this run (runs 610-722 archived to git history; file was 1405 lines).
  - Notion API token still invalid (401); board lives in DRIVER-BOARD.md.
- **State summary**: A DONE B DONE C DONE D DONE E DONE. Tests: 1373/0/2. Build: clean. npm audit: 0 vulns. **723rd run.**
- **Human-action items** (unchanged — 723rd iteration):
  1. Disable or redirect hourly schedule — 723+ consecutive runs; all defined workstreams exhausted.
  2. Add workstream F (McpAgent Phases 2-4) to this board to give the driver new work.
  3. Stale branch cleanup — 1000+ remote auto/ branches. Enable "Automatically delete head branches" in GitHub Settings or run bulk-delete locally.
  4. Configure CF Access on prod — clears ledger DLQ entries.
  5. Set GITHUB_MCP_AUTHORIZATION on prod to reconnect GitHub MCP backend.
  6. Rotate Notion token — op://ChittyOS-Integrations/notion/api_token.
- **Next run**: All workstreams done; no open PRs; 0 vulns. Same idle state expected. DISABLE THE SCHEDULE or define workstream F.
- **PushNotification**: NOT sent (nothing new since runs 720-721 security notification; state unchanged).

### 2026-07-22 (run 724 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done; workstream F still awaiting human decision)
- **Branch/PR**: none (direct commit to main — run log only)
- **Build**: clean (tsc exit 0, ch1tty@4.1.0) | **Tests**: 1373 pass / 0 fail / 2 skip (1375 total)
- **Actions**:
  - npm ci clean. npm run build clean. npm test: 1373/0/2.
  - 0 open PRs. npm audit: 0 vulnerabilities.
  - Inspected `auto/C-ops-focus-profile` branch (65 commits ahead of origin/main). Found regressions: removes valid `linear` (in servers.json) from code+governance profiles and `cloudflare-builds` (also in servers.json) from ops profile. test/focus.test.ts:100-101 would fail. Branch should NOT be merged; confirmed stale.
  - Guardrails confirmed: 5-tool surface intact; buildCastExplanation metric freeze ACTIVE.
  - Notion token still invalid (401); board in DRIVER-BOARD.md.
- **State summary**: A DONE B DONE C DONE D DONE E DONE. Tests: 1373/0/2. Build: clean. 0 vulns. **724th run.**
- **Human-action items** (unchanged — 724th iteration):
  1. Disable or redirect hourly schedule — 724+ consecutive runs; all defined workstreams exhausted.
  2. Add workstream F (McpAgent Phases 2-4) to this board to give the driver new work.
  3. Stale branch cleanup — 1000+ remote auto/ branches (including C-ops-focus-profile w/ regressions). Enable "Automatically delete head branches" in GitHub Settings or run bulk-delete locally.
  4. Configure CF Access on prod — clears ledger DLQ.
  5. Set GITHUB_MCP_AUTHORIZATION on prod to reconnect GitHub MCP backend.
  6. Rotate Notion token — op://ChittyOS-Integrations/notion/api_token.
- **Next run**: No open PRs; 0 vulns; all workstreams done. Idle. DISABLE THE SCHEDULE or add workstream F.
- **PushNotification**: NOT sent (state unchanged since runs 720-721).

### 2026-07-22 (run 725 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done; workstream F still awaiting human decision)
- **Branch/PR**: none (direct commit to main — run log only)
- **Build**: clean (tsc exit 0, ch1tty@4.1.0) | **Tests**: 1373 pass / 0 fail / 2 skip (1375 total)
- **Actions**:
  - npm ci clean. npm run build clean. npm test: 1373/0/2.
  - 0 open PRs. npm audit: 0 vulnerabilities.
  - Guardrails confirmed: 5-tool surface intact; buildCastExplanation metric freeze ACTIVE.
  - Notion token still invalid (401); board in DRIVER-BOARD.md.
- **State summary**: A DONE B DONE C DONE D DONE E DONE. Tests: 1373/0/2. Build: clean. 0 vulns. **725th run.**
- **Human-action items** (unchanged — 725th iteration):
  1. Disable or redirect hourly schedule — 725+ consecutive runs; all defined workstreams exhausted.
  2. Add workstream F (McpAgent Phases 2-4) to this board to give the driver new work.
  3. Stale branch cleanup — 1000+ remote auto/ branches. Enable "Automatically delete head branches" in GitHub Settings or run bulk-delete locally.
  4. Configure CF Access on prod — clears ledger DLQ.
  5. Set GITHUB_MCP_AUTHORIZATION on prod to reconnect GitHub MCP backend.
  6. Rotate Notion token — op://ChittyOS-Integrations/notion/api_token.
- **Next run**: No open PRs; 0 vulns; all workstreams done. Idle. DISABLE THE SCHEDULE or add workstream F.
- **PushNotification**: NOT sent (state unchanged since runs 720-721).

### 2026-07-22 (run 727 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done; workstream F still awaiting human decision)
- **Branch/PR**: none (direct commit to main — run log only)
- **Build**: clean (tsc exit 0, ch1tty@4.1.0) | **Tests**: 1373 pass / 0 fail / 2 skip (1375 total)
- **Actions**:
  - Reset local main to origin/main HEAD (run 726 @ 22985a4) — local had diverged 50 stale board-log commits behind; both sides were idle board logs only.
  - npm ci clean. npm run build clean (tsc exit 0). npm test: 1373/0/2 (1375 total, ~50s).
  - 0 open PRs (GitHub MCP confirmed). npm audit: 0 vulnerabilities.
  - Guardrails confirmed: 5-tool surface (search/execute/status/reload/cast) intact; buildCastExplanation metric freeze ACTIVE.
  - Notion token still invalid (401); board in DRIVER-BOARD.md.
- **State summary**: A DONE B DONE C DONE D DONE E DONE. Tests: 1373/0/2. Build: clean. 0 vulns. **727th run.**
- **Human-action items** (unchanged — 727th iteration):
  1. Disable or redirect hourly schedule — 727+ consecutive runs; all defined workstreams exhausted.
  2. Add workstream F (McpAgent Phases 2-4) to this board to give the driver new work.
  3. Stale branch cleanup — 1000+ remote auto/ branches. Enable "Automatically delete head branches" in GitHub Settings or bulk-delete locally.
  4. Configure CF Access on prod — clears ledger DLQ.
  5. Set GITHUB_MCP_AUTHORIZATION on prod to reconnect GitHub MCP backend.
  6. Rotate Notion token — op://ChittyOS-Integrations/notion/api_token.
- **Next run**: No open PRs; 0 vulns; all workstreams done. Idle. DISABLE THE SCHEDULE or add workstream F.
- **PushNotification**: NOT sent (state unchanged; prior notification sent at runs 720-721).

### 2026-07-22 (run 728 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done; workstream F still awaiting human decision)
- **Branch/PR**: none (direct commit to main — run log only)
- **Build**: clean (tsc exit 0, ch1tty@4.1.0) | **Tests**: 1373 pass / 0 fail / 2 skip (1375 total)
- **Actions**:
  - Reset local main to origin/main HEAD (run 727 @ cc054d6) — local had diverged 50 stale board-log commits; both sides idle.
  - npm ci clean. npm run build clean (tsc exit 0). npm test: 1373/0/2 (1375 total, ~42s).
  - 0 open PRs (GitHub MCP confirmed). npm audit: 0 vulnerabilities.
  - Guardrails confirmed: 5-tool surface (search/execute/status/reload/cast) intact; buildCastExplanation metric freeze ACTIVE; servers.json github entry uses api.githubcopilot.com/mcp/; focus-profiles.json 6 profiles present.
  - Notion token still invalid (401); board in DRIVER-BOARD.md.
- **State summary**: A DONE B DONE C DONE D DONE E DONE. Tests: 1373/0/2. Build: clean. 0 vulns. **728th run.**
- **Human-action items** (unchanged — 728th iteration):
  1. Disable or redirect hourly schedule — 728+ consecutive runs; all defined workstreams exhausted.
  2. Add workstream F (McpAgent Phases 2-4) to this board to give the driver new work.
  3. Stale branch cleanup — 1000+ remote auto/ branches. Enable "Automatically delete head branches" in GitHub Settings or bulk-delete locally.
  4. Configure CF Access on prod — clears ledger DLQ.
  5. Set GITHUB_MCP_AUTHORIZATION on prod to reconnect GitHub MCP backend.
  6. Rotate Notion token — op://ChittyOS-Integrations/notion/api_token.
- **Next run**: No open PRs; 0 vulns; all workstreams done. Idle. DISABLE THE SCHEDULE or add workstream F.
- **PushNotification**: NOT sent (state unchanged; prior notification sent at runs 720-721).

### 2026-07-22 (run 729 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done; workstream F still awaiting human decision)
- **Branch/PR**: none (direct commit to main — run log only)
- **Build**: clean (tsc exit 0, ch1tty@4.1.0) | **Tests**: 1373 pass / 0 fail / 2 skip (1375 total)
- **Actions**:
  - Reset local main to origin/main HEAD (7a412ed). npm ci clean. npm run build clean (tsc exit 0). npm test: 1373/0/2 (1375 total, ~37s).
  - 0 open PRs (GitHub MCP confirmed). npm audit: 0 vulnerabilities.
  - Guardrails confirmed: 5-tool surface (search/execute/status/reload/cast) intact; buildCastExplanation metric freeze ACTIVE.
  - Notion token still invalid (401); board in DRIVER-BOARD.md.
- **State summary**: A DONE B DONE C DONE D DONE E DONE. Tests: 1373/0/2. Build: clean. 0 vulns. **729th run.**
- **Human-action items** (unchanged — 729th iteration):
  1. Disable or redirect hourly schedule — 729+ consecutive runs; all defined workstreams exhausted.
  2. Add workstream F (McpAgent Phases 2-4) to this board to give the driver new work.
  3. Stale branch cleanup — 1000+ remote auto/ branches. Enable "Automatically delete head branches" in GitHub Settings or bulk-delete locally.
  4. Configure CF Access on prod — clears ledger DLQ.
  5. Set GITHUB_MCP_AUTHORIZATION on prod to reconnect GitHub MCP backend.
  6. Rotate Notion token — op://ChittyOS-Integrations/notion/api_token.
- **Next run**: No open PRs; 0 vulns; all workstreams done. Idle. DISABLE THE SCHEDULE or add workstream F.
- **PushNotification**: NOT sent (state unchanged).
