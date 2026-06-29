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
- **Branch cleanup** — 975+ rogue `auto/` branches (260 cast-explain violations). Git push --delete fails in this container. Human action: enable "Automatically delete head branches" in GitHub Settings → General, or run bulk-delete locally.
- **CI (main ci.yml)** — 0-job-queue failure (non-CodeQL). Recurring, non-blocking.

## Human Actions Required (persistent since run 121)

1. **Disable or redirect hourly schedule** — 234+ idle runs with no new work; every run costs compute.
2. **Add new workstreams** to DRIVER-BOARD.md if planned work exists.
3. **Configure CF Access on prod** (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) — clears ledger DLQ.
4. **Set `GITHUB_MCP_AUTHORIZATION`** on prod to reconnect ch1tty github backend.
5. **Rotate Notion token** — `op://ChittyOS-Integrations/notion/api_token`.
6. **Stale branch cleanup** — 975+ rogue `auto/` branches; enable auto-delete in GitHub Settings or bulk-delete locally.

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
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) - unchanged from runs 196–200
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **201st consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. All guardrails enforced.

### 2026-06-27–28 (idle — runs 202–205)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: direct commits to main via GitHub MCP API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip — unchanged.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **202nd–205th consecutive idle runs.**

### 2026-06-28 (idle — run 206; first successful PushNotification)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: none (board update only via GitHub MCP API; git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**: PushNotification SENT (first successful notification; prior runs reported unavailable). Notified user of 206-run idle streak.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **206th consecutive idle run.**

### 2026-06-28 (idle — runs 207–210)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: board updates only via GitHub MCP API (git push 403/non-fast-forward in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip — unchanged from all prior runs.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **207th–210th consecutive idle runs.**
- **Blockers**: Notion 401. Ch1tty MCP unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset. 975 stale branches.

### 2026-06-28 (idle — run 211)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: board update only via GitHub MCP API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **211th consecutive idle run.**
- **Next run**: Idle unless new workstreams added to DRIVER-BOARD.md. **All work done — disable the hourly schedule or add new workstreams.**

### 2026-06-28 (idle — runs 212–213)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md pushed via GitHub MCP API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **212th–213th consecutive idle runs.**

### 2026-06-28 (idle — runs 217–226)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API each run (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **217th–226th consecutive idle runs.**
- **Notable**: Run 219 fixed base64 corruption in board. Run 225 skipped PushNotification (no new info since run 206). 0 open PRs.

### 2026-06-28 (idle — run 227)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean, `npm run build` clean (tsc exit 0), `npm test`: 1370 pass / 0 fail / 2 skip — unchanged from all prior runs.
  - `git fetch --all`: 975+ remote `auto/` branches (all unmerged, all pre-existing). 0 open PRs confirmed.
  - All workstreams A–E confirmed DONE. `buildCastExplanation` freeze ACTIVE (0 violations in source or open PRs).
  - Notion: 401. Ch1tty MCP: unavailable. ch1tty github backend: GITHUB_MCP_AUTHORIZATION unset.
  - PushNotification: SENT (21 runs since last notification on run 206 — reminder to disable schedule or add workstreams).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **227th consecutive idle run.**
- **Next run**: Idle. **Human action needed: disable hourly schedule or add new workstreams to DRIVER-BOARD.md.**

### 2026-06-29 (idle — run 228)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API (git push 403 in container)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **228th consecutive idle run.**
- **Next run**: Idle. No PushNotification sent (run 227 notified 1h ago — no new info). Human action still needed: disable hourly schedule or add new workstreams.

### 2026-06-29 (idle — run 229)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md fixed (base64 corruption again) + run 229 log appended; pushed via GitHub MCP API (git push 403 in container).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) — unchanged.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **229th consecutive idle run.**
- **Next run**: Idle. No PushNotification sent (no new information beyond run 227's notification). Human action still needed: disable hourly schedule or add new workstreams to DRIVER-BOARD.md.

### 2026-06-29 (idle — run 230)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API (git push 403 in container).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) — unchanged.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **230th consecutive idle run.**
- **Next run**: Idle. No PushNotification sent (no new information beyond run 227's notification). Human action still needed: disable hourly schedule or add new workstreams to DRIVER-BOARD.md.

### 2026-06-29 (idle — run 231)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API (git push 403 in container).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) — unchanged from all prior runs.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **231st consecutive idle run.**
- **Next run**: Idle. No PushNotification sent (run 227 notified; no new information). Human action still needed: disable hourly schedule or add new workstreams to DRIVER-BOARD.md.

### 2026-06-29 (idle — run 232)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API (git push 403 in container).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) — unchanged.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **232nd consecutive idle run.**
- **Next run**: Idle. No PushNotification sent (run 227 was last notification; no new information). Human action still needed: disable hourly schedule or add new workstreams to DRIVER-BOARD.md.

### 2026-06-29 (idle — run 233)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API (git push 403 in container).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) — unchanged.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **233rd consecutive idle run.**
- **Next run**: Idle. No PushNotification sent (run 227 was last notification; no new information). Human action still needed: disable hourly schedule or add new workstreams to DRIVER-BOARD.md.

### 2026-06-29 (idle — run 234)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API (git push 403 in container).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) — unchanged.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **234th consecutive idle run.**
- **Actions**: PushNotification SENT (7 runs since run 227 notification — repeating reminder to disable schedule or add workstreams).
- **Next run**: Idle. Human action still needed: disable hourly schedule or add new workstreams to DRIVER-BOARD.md.
