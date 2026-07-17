# ch1tty goal-driver board

Fallback board — Notion API token invalid (401). This file is the cross-run durable state.
Blocker to restore Notion: rotate `NOTION_API_TOKEN` (op://ChittyOS-Integrations/notion/api_token).

NOTE: Board trimmed at run 610 (2026-07-17). Full history preserved in git. Prior trims at runs 126, 201, 245, 349, 411, 484.

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

## Human Actions Required

1. **Disable or redirect hourly schedule** — 610+ idle runs with no new work; every run costs compute.
2. **Add new workstreams** to DRIVER-BOARD.md if planned work exists.
3. **Configure CF Access on prod** (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) — clears ledger DLQ.
4. **Set `GITHUB_MCP_AUTHORIZATION`** on prod to reconnect ch1tty GitHub backend.
5. **Rotate Notion token** — `op://ChittyOS-Integrations/notion/api_token`.
6. **Stale branch cleanup** — 940+ rogue `auto/` branches; enable auto-delete in GitHub Settings or bulk-delete locally.

## Run Log

_(Prior run log entries archived to git history — runs 1–609 trimmed at run 610. Full history in git log.)_

### 2026-07-17 (run 611 — idle, all workstreams done)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done)
- **Branch/PR**: none
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `git pull origin main`; HEAD at 1f65225 (run 610). Fast-forwarded 5 commits.
  - `npm ci` clean. `npm run build` clean (tsc exit 0). `npm test`: 1370/0/2 (~54s).
  - 0 open PRs. State identical to run 610.
  - Guardrails confirmed: 5-tool surface; `buildCastExplanation` metric freeze ACTIVE.
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **611th run.**
- **Next run**: Same idle state expected. **DISABLE THE SCHEDULE** or add new workstreams.

### 2026-07-17 (run 610 — idle, all workstreams done; board trimmed)
- **Workstream**: None (all A–E + GUARDRAIL-CLEANUP done)
- **Branch/PR**: none (direct commit to main — 0 open PRs)
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **Actions**:
  - `git checkout -B main origin/main`; HEAD at 78447af (run 609). No divergence.
  - `npm ci` clean. `npm run build` clean (tsc exit 0). `npm test`: 1370/0/2 (~52s).
  - `git fetch --all`; 0 open PRs. 940+ stale `auto/` branches remain (human cleanup still pending).
  - Guardrails confirmed: 5-tool surface; `buildCastExplanation` metric freeze ACTIVE. 0 violations on main.
  - All workstreams: A ✓ B ✓ C ✓ D ✓ E ✓.
  - DRIVER-BOARD.md trimmed: runs 1–609 archived to git history (file was 1509 lines; trimmed at this run).
  - PushNotification: NOT sent (notification sent at run 609 today 2026-07-17; state unchanged).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **610th run.** 0 open PRs.
- **Next run**: Same idle state expected. **DISABLE THE SCHEDULE** or add new workstreams to this board.
