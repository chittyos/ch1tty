# ch1tty goal-driver board

Fallback board — Notion API token invalid (401). This file is the cross-run durable state.
Blocker to restore Notion: rotate `NOTION_API_TOKEN` (op://ChittyOS-Integrations/notion/api_token).

NOTE: Board trimmed at run 201 (2026-06-27). Full history preserved in git. Prior trim at run 126.

## Workstream Status

All workstreams are DONE as of 2026-06-15 to 2026-06-20. Build clean, tests green, guardrails enforced.

- [x] **SEC-FIX 1-3** — Dependabot high-severity vulns (hono, ws, undici, esbuild). PRs #773/#777/#781 ✅ MERGED.
- [x] **A** — Gateway up/refreshed/tested. Build clean, 5 meta-tools confirmed. DONE.
- [x] **B** — GitHub MCP migration: `servers.json` github → `https://api.githubcopilot.com/mcp/` with envHeaders. DONE.
- [x] **C** — Focus-profile layer: `focus-profiles.json` (6 profiles), CH1TTY_FOCUS, per-call focus param, status reporting, tests. DONE.
- [x] **D** — Scenario testing + simulation: `test/scenario.test.ts`, `test/simulation.test.ts`, `sim/scenarios.ts` harness. DONE.
- [x] **E** — Alchemist catalog: `focus-suggestions.json` — 372/372 tools at 6/6, 100% coverage (run 91). DONE.
- [x] **F–AAAAAAAAA** — Observability improvements: cast/search/execute/status latency, session context, focus fields, explanation fields, chain execution, catalog stats, session TTL, dryRun, scope, topTools, ledger health, IQR/entropy/kurtosis/etc. ~150 PRs #365–#619. All ✅ MERGED.
- [x] **GUARDRAIL-CLEANUP** — Reverted 800+ rogue `auto/*-cast-explain-*-ratio` branches that violated the `buildCastExplanation` metric freeze. Source clean. 0 violations in open PRs.

## Guardrail: buildCastExplanation metric freeze

**ACTIVE.** Every field that belongs in `cast explain` is already there. No new statistical fields, ratios, percentile cross-comparisons, or observability metrics may be added to `buildCastExplanation`. Any PR adding such a field MUST be rejected. See CLAUDE.md § *Architectural Guardrail*.

## Blockers

- **Notion API token** — Invalid (401). Human action: rotate `NOTION_API_TOKEN` in 1Password (`op://ChittyOS-Integrations/notion/api_token`).
- **Ledger DLQ** — Entries present: `ledger.chitty.cc` unreachable from remote container. Replay code merged (PR #815). Action: configure CF Access credentials (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) on prod.
- **ch1tty github backend** — `GITHUB_MCP_AUTHORIZATION` unset on prod. Set env var to reconnect the `github` backend in `servers.json`.
- **Branch cleanup** — 973 rogue `auto/` branches (260 cast-explain violations). Git push --delete fails in this container. Human action: enable "Automatically delete head branches" in GitHub Settings → General, or run bulk-delete locally.
- **CI (main ci.yml)** — 0-jobs queue failure (non-CodeQL). Recurring, non-blocking.

## Human Actions Required (persistent since run 121)

1. **Disable or redirect hourly schedule** — 209+ idle runs with no new work; every run costs compute.
2. **Add new workstreams** to DRIVER-BOARD.md if planned work exists.
3. **Configure CF Access on prod** (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) — clears ledger DLQ.
4. **Set `GITHUB_MCP_AUTHORIZATION`** on prod to reconnect ch1tty github backend.
5. **Rotate Notion token** — `op://ChittyOS-Integrations/notion/api_token`.
6. **Stale branch cleanup** — 973 rogue `auto/` branches; enable auto-delete in GitHub Settings or bulk-delete locally.

## Run Log

_(Prior run log entries archived to git history — runs 1–195 trimmed for readability. Trimmed again at run 201.)_

### 2026-06-27 (idle — runs 196–200; all workstreams done)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams.
- **Branch/PR**: direct commits to main (run log only; no source changes)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **196th–200th consecutive idle runs.**
- **Blockers**: Notion 401. Ledger DLQ (CF Access on prod). Ch1tty MCP unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset. Branch delete: 403. Ollama unreachable (non-blocking).

### 2026-06-27 (idle — run 201; board trimmed)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: direct commit to main (board trim + run log; no source changes)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) — unchanged from runs 196–200
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged.
  - `git fetch --all`: 967+ remote branches (800+ rogue `auto/*-cast-explain-*-ratio`); 0 open PRs; guardrail enforced.
  - All workstreams A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP confirmed DONE (201st consecutive idle run).
  - `buildCastExplanation` metric freeze ACTIVE — source clean; 0 open PRs from prohibited branches.
  - **Board trimmed**: DRIVER-BOARD.md was 164KB / 1601 lines (grown from 260 lines at run-126 trim); reduced to ~90 lines. Full history in git.
  - Notion: 401. Ch1tty MCP: unavailable. GitHub MCP (session tools): connected. ch1tty github backend (servers.json): unavailable.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **201st consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. All guardrails enforced.

### 2026-06-27 (idle — run 202)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: direct commit to main via GitHub API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged.
  - `git fetch --all`: 967+ remote branches; 0 open PRs; guardrail enforced.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE, source clean.
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **202nd consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. Disable hourly schedule if no new work planned.

### 2026-06-27 (idle — run 203)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: direct commit to main via GitHub API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged.
  - `git fetch --all`: 967+ remote branches; 0 open PRs; guardrail enforced.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE, source clean.
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **203rd consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. **Strongly recommend disabling the hourly schedule — all work is done.**

### 2026-06-28 (idle — run 204)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: direct commit to main via GitHub API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged.
  - `git fetch --all`: 967+ remote branches; 0 open PRs; guardrail enforced.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE, source clean.
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **204th consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. **All work done — disable the hourly schedule or add new workstreams.**

### 2026-06-28 (idle — run 205)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: direct commit to main via GitHub MCP API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE, source clean.
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **205th consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. **Strongly recommend disabling the hourly schedule — all work is done and every run is idle.**

### 2026-06-28 (idle — run 206; first successful PushNotification)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: none (board update only via GitHub MCP API; git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean (node_modules from cache), `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged from runs 196–205.
  - `git fetch --all`: 967+ remote branches; 0 open PRs; guardrail enforced.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE, source clean.
  - PushNotification: SENT (first successful notification; prior runs reported unavailable). Notified user of 206-run idle streak.
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **206th consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. **All work done — disable the hourly schedule or add new workstreams to DRIVER-BOARD.md.**

### 2026-06-28 (idle — run 207)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: board update only via GitHub MCP API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged from all prior runs.
  - `git fetch --all`: 975 remote branches; 0 open PRs; guardrail enforced.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE, source clean.
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **207th consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. **All work done — disable the hourly schedule or add new workstreams.**

### 2026-06-28 (idle — run 208)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: board update only via GitHub MCP API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged from all prior runs.
  - `git fetch --all`: 975+ remote branches; 0 open PRs; guardrail enforced.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE, source clean.
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **208th consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. **All work done — add new workstreams or disable the schedule.**

### 2026-06-28 (idle — run 209)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: board update only via GitHub MCP API (git push non-fast-forward in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370/0/2 — unchanged from all prior runs.
  - `git fetch --all`: 973 remote branches (260 cast-explain violations, 34 idle-log branches); 0 open PRs; guardrail enforced.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE, source clean, 0 open PRs.
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **209th consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. **All work done — disable the hourly schedule or add new workstreams.**
