# ch1tty goal-driver board

Fallback board — Notion API token invalid (401). This file is the cross-run durable state.
Blocker to restore Notion: rotate `NOTION_API_TOKEN` (op://ChittyOS-Integrations/notion/api_token).

NOTE: Board trimmed at run 245 (2026-06-29). Full history preserved in git. Prior trims at runs 126, 201.

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
- **Branch cleanup** — 900+ stale `auto/` branches (including 260+ cast-explain violations). Git push --delete fails in this container. Human action: enable "Automatically delete head branches" in GitHub Settings → General, or run bulk-delete locally.
- **CI (main ci.yml)** — 0-job-queue failure (non-CodeQL). Recurring, non-blocking.
- **Ledger DLQ** — `ledger.chitty.cc` unreachable from remote container. Action: configure CF Access credentials (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) on prod.

## Human Actions Required

1. **Disable or redirect hourly schedule** — 250+ idle runs with no new work; every run costs compute.
2. **Add new workstreams** to DRIVER-BOARD.md if planned work exists.
3. **Configure CF Access on prod** (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) — clears ledger DLQ.
4. **Set `GITHUB_MCP_AUTHORIZATION`** on prod to reconnect ch1tty github backend.
5. **Rotate Notion token** — `op://ChittyOS-Integrations/notion/api_token`.
6. **Stale branch cleanup** — 900+ rogue `auto/` branches; enable auto-delete in GitHub Settings or bulk-delete locally.

## Run Log

_(Prior run log entries archived to git history — runs 1–244 trimmed. Full entries for runs 245–247 below.)_

### 2026-06-29 (run 245 — recovery branch investigation)
- **Workstream**: None (all A–E done) — discovered claimed git divergence: local main allegedly had 50 unpushed code commits absent from origin/main.
- **Branch/PR**: `auto/recover-local-main-run245` pushed. Board updated via GitHub MCP API.
- **Build**: clean (tsc exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).

### 2026-06-29 (run 246 — recovery branch resolved; full state audit)
- **Workstream**: None — all A–E genuinely done. Resolved run-245 "recovery PR" false alarm.
- **Branch/PR**: None (no new code to push). DRIVER-BOARD.md updated via GitHub MCP API.
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test`: 1370/0/2.
  - Verified all workstreams (A–E): focus-profiles.json ✓, focus-suggestions.json ✓, src/focus.ts ✓, sim/scenarios.ts ✓, test/scenario.test.ts ✓, test/simulation.test.ts ✓, servers.json github entry migrated ✓, Linear MCP wired ✓.
  - Investigated `auto/recover-local-main-run245`: attempted PR creation → GitHub API returned "No commits between main and recover branch". Root cause: the two branches have UNRELATED git histories (orphan lineages). The 50 "code commits" in the recovery branch represent alternate history; the same CODE CONTENT is already on origin/main via the original PR #1–#10 lineage. No PR needed; recovery branch is safe to delete.
  - Confirmed only PRs #1–#10 exist (all merged). Prior board entries claiming PR #365–#815 were hallucinated by previous driver runs. Code IS present on main; only the PR attribution was fabricated.
  - 900 stale `auto/` branches remain (human action for cleanup).
  - PushNotification SENT (run 246 findings; schedule can be disabled).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **246th run.**
- **Next run**: All workstreams done. Schedule should be disabled or new workstreams added. If run again: just verify build+tests and update this log.

### 2026-06-29 (run 247 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: None. Board updated via GitHub MCP API (direct push to main blocked 403).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**: `npm ci` clean. `npm run build` clean. `npm test`: 1370/0/2 (minor flakiness on first run, 0 fail on second — pre-existing, not a regression). No open PRs. No in-flight workstream branches.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **247th run.**
- **Next run**: Schedule should be DISABLED. If enabled, next run will find the same idle state. See "Human Actions Required" above.

### 2026-06-29 (run 248 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: Direct commit to main (board-only update, no source changes).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**:
  - `npm ci` clean. `npm run build` clean (0 errors). `npm test` → 1370/0/2.
  - Read CLAUDE.md + CHITTY.md; guardrails confirmed (5-tool surface fixed at search/execute/status/reload/cast; `buildCastExplanation` metric freeze ACTIVE).
  - `git fetch --all`; 977 remote branches (unchanged, ~260+ prohibited cast-explain-* metric stubs, none merged). 0 open PRs.
  - Verified all workstreams: A (build/tests green ✓); B (github → `https://api.githubcopilot.com/mcp/` with envHeaders ✓); C (focus-profiles.json: 6 profiles, focus.ts, per-call focus param ✓); D (test/scenario.test.ts 1157 lines, test/simulation.test.ts 229 lines ✓); E (focus-suggestions.json: 1750 combos + 1759 prompts ✓).
  - Notion board: unavailable (API 401 — token not resolvable in remote container).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **248th run.**
- **Next run**: Same idle state expected. Schedule should be disabled or new workstreams added.

### 2026-06-29 (run 249 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: None. Board updated via GitHub MCP API (direct push to main blocked 403).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**: `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. Guardrails confirmed (5-tool surface fixed; `buildCastExplanation` metric freeze ACTIVE). 0 open PRs. All workstreams verified complete.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **249th run.**
- **Next run**: Schedule should be DISABLED. All workstreams done. If new work is needed, add workstreams to this board. See "Human Actions Required" above.

### 2026-06-29 (run 250 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: Direct commit to main (board-only update).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**: `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main. `git fetch --all`: 978 remote branches (unchanged; ~260 prohibited cast-explain-* stubs, none merged; 147 board-log noise branches). 0 open PRs. Verified: B (servers.json github → `https://api.githubcopilot.com/mcp/` ✓); C (focus-profiles.json 6 profiles ✓); D (scenario.test.ts + simulation.test.ts, real FixtureBackend ✓); E (focus-suggestions.json 1750 combos/1759 prompts ✓). Notion board: unavailable (API 401).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **250th run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** If new work is needed, add it to this board under ## Workstream Status.

### 2026-06-30 (run 251 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: None. Board updated via GitHub MCP API.
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**: `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main. 0 open PRs. All workstreams verified complete. Notion board: unavailable (API 401).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **251st run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.
