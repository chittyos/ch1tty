# ch1tty goal-driver board

Fallback board — Notion API token invalid (401). This file is the cross-run durable state.
Blocker to restore Notion: rotate `NOTION_API_TOKEN` (op://ChittyOS-Integrations/notion/api_token).

NOTE: Board trimmed at run 484 (2026-07-11). Full history preserved in git. Prior trims at runs 126, 201, 245, 349, 411.

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
- **Branch cleanup** — 1000+ stale `auto/` branches (including 260+ cast-explain violations). Git push --delete fails in this container. Human action: enable "Automatically delete head branches" in GitHub Settings → General, or run bulk-delete locally.
- **CI (main ci.yml)** — 0-job-queue failure (non-CodeQL). Recurring, non-blocking.
- **Ledger DLQ** — `ledger.chitty.cc` unreachable from remote container. Action: configure CF Access credentials (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) on prod.

## Human Actions Required

1. **Disable or redirect hourly schedule** — 484+ idle runs with no new work; every run costs compute.
2. **Add new workstreams** to DRIVER-BOARD.md if planned work exists.
3. **Configure CF Access on prod** (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) — clears ledger DLQ.
4. **Set `GITHUB_MCP_AUTHORIZATION`** on prod to reconnect ch1tty GitHub backend.
5. **Rotate Notion token** — `op://ChittyOS-Integrations/notion/api_token`.
6. **Stale branch cleanup** — 1000+ rogue `auto/` branches; enable auto-delete in GitHub Settings or bulk-delete locally.

## Run Log

_(Prior run log entries archived to git history — runs 1–478 trimmed at run 484. Full history in git log.)_

### 2026-07-11 (run 479 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done)
- **Branch/PR**: none (direct commit to main)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test`: 1370/0/2. `npm run sim`: 39/39 / 14/14 / 3/3.
  - Guardrails confirmed: 5-tool surface; `buildCastExplanation` metric freeze ACTIVE.
  - 0 open PRs. 1000+ stale `auto/` branches remain.
  - All workstreams: A ✓ B ✓ C ✓ D ✓ E ✓.
  - PushNotification: NOT sent (state unchanged).
- **Workstream state**: A✅ B✅ C✅ D✅ E✅

### 2026-07-11 (run 480 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done)
- **Branch/PR**: none (direct commit to main)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean. `npm run build` clean. `npm test`: 1370/0/2. `npm run sim`: 39/39 / 14/14 / 3/3 (86ms).
  - Guardrails confirmed: 5-tool surface; `buildCastExplanation` metric freeze ACTIVE.
  - 0 open PRs. 1000+ stale `auto/` branches remain.
  - All workstreams: A ✓ B ✓ C ✓ D ✓ E ✓.
  - PushNotification: NOT sent (state unchanged).
- **Workstream state**: A✅ B✅ C✅ D✅ E✅

### 2026-07-11 (run 482 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done)
- **Branch/PR**: none (direct commit to main)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean. `npm run build` clean (tsc exit 0). `npm test`: 1370/0/2. `npm run sim`: 39/39 / 14/14 / 3/3 (94ms).
  - Guardrails confirmed: 5-tool surface fixed; `buildCastExplanation` metric freeze ACTIVE.
  - 0 open PRs. 1000+ stale `auto/` branches remain.
  - All workstreams: A ✓ B ✓ C ✓ D ✓ E ✓.
  - PushNotification: NOT sent (state unchanged).
- **Workstream state**: A✅ B✅ C✅ D✅ E✅

### 2026-07-11 (run 483 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done)
- **Branch/PR**: none (direct commit to main)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean. `npm run build` clean (tsc exit 0). `npm test`: 1370/0/2. `npm run sim`: 39/39 / 14/14 / 3/3 (90ms).
  - Guardrails confirmed: 5-tool surface fixed; `buildCastExplanation` metric freeze ACTIVE.
  - 0 open PRs. 1000+ stale `auto/` branches remain.
  - All workstreams: A ✓ B ✓ C ✓ D ✓ E ✓.
  - PushNotification: NOT sent (state unchanged).
- **Workstream state**: A✅ B✅ C✅ D✅ E✅

### 2026-07-11 (run 484 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done)
- **Branch/PR**: none (direct commit to main)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `npm ci` clean. `npm run build` clean (tsc exit 0). `npm test`: 1370/0/2 (all pass, no regressions).
  - Read CLAUDE.md + CHITTY.md; guardrails confirmed (5-tool surface fixed; `buildCastExplanation` metric freeze ACTIVE).
  - `git fetch --all`. Local main was 50 commits behind origin/main (detached HEAD from prior session); reset to origin/main. GitHub MCP: 0 open PRs. 937 stale `auto/` branches remain (260+ prohibited cast-explain metric violation branches; human cleanup still pending).
  - Verified all workstreams: A ✓ B (github → `https://api.githubcopilot.com/mcp/` ✓) C (focus-profiles.json 6 profiles ✓) D (scenario.test.ts + simulation.test.ts ✓) E (focus-suggestions.json 1750 combos / 1759 prompts across 6 profiles ✓).
  - `npm run sim` → 39/39 resolution scenarios pass, 14/14 out-of-focus reachability probes pass, 3/3 failure scenarios pass. Total cast time 91.13ms.
  - Board trimmed at this run (484) — prior entries runs 1–478 archived to git history.
  - Notion board: unavailable (API 401). DRIVER-BOARD.md is durable board.
  - PushNotification: SENT (run 484; ~24 runs since last notification at run 460; 484 consecutive idle runs — **DISABLE SCHEDULE** action still pending from human).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. Sim: 39/39. **484th run.**
- **Next run**: Same idle state expected. **DISABLE THE SCHEDULE** or add new workstreams to this board.
