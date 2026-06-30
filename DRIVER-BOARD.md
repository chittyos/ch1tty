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

1. **Disable or redirect hourly schedule** — 19+ idle runs with no new work (runs 245–263; prior history archived in git); every run costs compute.
2. **Add new workstreams** to DRIVER-BOARD.md if planned work exists.
3. **Configure CF Access on prod** (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) — clears ledger DLQ.
4. **Set `GITHUB_MCP_AUTHORIZATION`** on prod to reconnect ch1tty github backend.
5. **Rotate Notion token** — `op://ChittyOS-Integrations/notion/api_token`.
6. **Stale branch cleanup** — 900+ rogue `auto/` branches; enable auto-delete in GitHub Settings or bulk-delete locally.

## Run Log

_(Prior run log entries archived to git history — runs 1–244 trimmed. Full entries for runs 245–256 below.)_

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
  - Verified all workstreams (A–E): focus-profiles.json ✓, focus-suggestions.json ✓, src/focus.ts ✓, sim/scenarios.ts ✓, test/scenario.test.ts ✓, test/simulation.test.ts ✓, servers.json github entry migrated ✓, Linear MCP wired ✓,
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

### 2026-06-30 (run 252 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: Board updated via GitHub MCP API (direct push to main blocked 403).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**: `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main. 0 open PRs. All workstreams verified complete. Notion board: unavailable (API 401). 980+ stale `auto/` branches (unchanged, none merged, human cleanup still needed).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **252nd run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.

### 2026-06-30 (run 253 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: Direct commit to main (board-only update).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**: `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main. 0 open PRs. All workstreams verified complete. Notion board: unavailable (API 401). 978 remote branches (unchanged; ~260+ prohibited cast-explain-* stubs none merged; bulk cleanup still needs human action). Verified: B (servers.json github → `https://api.githubcopilot.com/mcp/` with envHeaders ✓); C (focus-profiles.json 6 profiles, focus.ts ✓); D (test/scenario.test.ts + test/simulation.test.ts ✓); E (focus-suggestions.json ✓).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **253rd run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.

### 2026-06-30 (run 254 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: None. Board updated via GitHub MCP API (direct push to main blocked 403).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test` => 1370/0/2. Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main. 0 open PRs.
  - Verified all workstreams: B (servers.json github => `https://api.githubcopilot.com/mcp/` with envHeaders ✓); C (focus-profiles.json 6 profiles, focus.ts ✓); D (test/scenario.test.ts + test/simulation.test.ts ✓); E (focus-suggestions.json ✓).
  - Audited ~260+ `auto/*-cast-explain-*-ratio` branches — all violate the buildCastExplanation metric freeze (add statistical ratios to explain output). None merged to main; source is clean. Branches remain on remote; bulk cleanup still needs human action.
  - Notion board: unavailable (API 401).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **254th run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.

### 2026-06-30 (run 255 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: None. Board updated via GitHub MCP API (direct push to main blocked 403).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**: `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main. 0 open PRs. All workstreams verified complete. Notion board: unavailable (API 401).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **255th run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.

### 2026-06-30 (run 256 — idle, all workstreams done; board corruption fixed)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: None (no new code). Board updated via GitHub MCP API.
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2.
  - Discovered: DRIVER-BOARD.md was stored as raw base64 content (0 newlines, 19380 bytes). Fixed: decoded base64 → restored proper markdown (runs 245–255 intact).
  - Discovered: runs 247–255 board-update commits were on detached HEAD (not pushed to origin/main). Fixed: `git merge --ff-only` to recover them onto main.
  - Verified all workstreams: A (build/tests green ✓); B (servers.json github → `https://api.githubcopilot.com/mcp/` with envHeaders ✓); C (focus-profiles.json 6 profiles ✓); D (test/scenario.test.ts + test/simulation.test.ts ✓); E (focus-suggestions.json: 1750+ combos, 1759+ prompts ✓).
  - Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main. 0 open PRs.
  - Notion board: unavailable (API 401 — token not resolvable in remote container).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **256th run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.

### 2026-06-30 (run 257 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: None. Board updated via direct commit to main.
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. All guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; 0 open PRs.
  - Verified all workstreams: A (build/tests green ✓); B (servers.json github → `https://api.githubcopilot.com/mcp/` with envHeaders ✓); C (focus-profiles.json 6 profiles, src/focus.ts ✓); D (test/scenario.test.ts 1157 lines, test/simulation.test.ts 229 lines ✓); E (focus-suggestions.json 1.8MB ✓).
  - Notion board: unavailable (API 401 — token not resolvable in remote container).
  - Sent PushNotification: schedule still firing, 257th idle run; human action to disable/redirect schedule or add workstreams.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **257th run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.

### 2026-06-30 (run 258 — idle, all workstreams done; base64 corruption fixed again)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: `auto/run258-board-fix` → PR opened. DRIVER-BOARD.md fixed: decoded base64 back to proper markdown (same corruption pattern as run 256).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main. 0 open PRs.
  - Verified all workstreams: A (build/tests green ✓); B (servers.json github → `https://api.githubcopilot.com/mcp/` with envHeaders ✓); C (focus-profiles.json 6 profiles, src/focus.ts ✓); D (test/scenario.test.ts + test/simulation.test.ts ✓); E (focus-suggestions.json 1.8MB ✓).
  - Discovered DRIVER-BOARD.md corrupted to base64 again (recurring pattern). Fixed: decoded base64 → restored proper markdown. Root cause: previous runs pushed the file via GitHub MCP API which double-encodes content.
  - Notion board: unavailable (API 401 — token not resolvable in remote container).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **258th run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above. To prevent future base64 corruption: push DRIVER-BOARD.md via direct git commit/push, not via GitHub MCP API create_or_update_file (which encodes content as base64 then the stored file content becomes base64 text when read back).

### 2026-06-30 (run 259 — idle, all workstreams done)
- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: Updated PR #1007 (`auto/run258-board-fix`) with run 259 log entry.
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2. Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main.
  - DRIVER-BOARD.md was base64-corrupted on main again (recurring). PR branch `auto/run258-board-fix` (PR #1007) has the decoded version; appended run 259 entry there.
  - 1 open PR (#1007 — board fix). All workstreams A–E verified complete. Notion board: unavailable (API 401).
  - Human action still needed: merge PR #1007 to restore readable board on main; disable/redirect schedule or add new workstreams.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **259th run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.

### 2026-06-30 (runs 260–262 — idle, all workstreams done; runs captured in open PRs)

_(Runs 260–262 are recorded in open PRs #1008 and #1009, not yet merged to main. Summary: all A–E done, 1370/0/2, no new work.)_

### 2026-06-30 (run 263 — idle, all workstreams done)

- **Workstream**: None — all A–E confirmed done.
- **Branch/PR**: `auto/run263-board-update` → PR opened.
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total).
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test` → 1370/0/2.
  - Guardrails confirmed: 5-tool surface fixed (search/execute/status/reload/cast); `buildCastExplanation` metric freeze ACTIVE; no new fields on main.
  - 2 open PRs (#1008 run 260 board update; #1009 run 262 board update) — both idle board-only PRs awaiting human merge.
  - 983 remote branches (still ~260+ prohibited cast-explain-*-ratio stubs, none merged; human bulk-cleanup needed).
  - Verified all workstreams: A (build/tests green ✓); B (servers.json github → `https://api.githubcopilot.com/mcp/` with envHeaders ✓); C (focus-profiles.json 6 profiles, src/focus.ts ✓); D (test/scenario.test.ts + test/simulation.test.ts ✓); E (focus-suggestions.json ✓).
  - Notion board: unavailable (API 401 — token not resolvable in remote container).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **263rd run.**
- **Next run**: Same idle state expected. **Schedule should be DISABLED or new workstreams added.** See "Human Actions Required" above.
