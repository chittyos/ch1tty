# ch1tty goal-driver board

Fallback board — Notion API token invalid (401). This file is the cross-run durable state.
Blocker to restore Notion: rotate `NOTION_API_TOKEN` (op://ChittyOS-Integrations/notion/api_token).

NOTE: Board trimmed at run 245 (2026-06-29). Full history preserved in git. Prior trims at runs 126, 201.

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
- **NEW: git divergence** — local main has 50 unpushed code commits (test coverage, Linear MCP, aggregator fix) that are NOT on origin/main. `auto/recover-local-main-run245` branch + PR created in run 245. **Human action: review and merge the recovery PR.**

## Human Actions Required (persistent since run 121)

1. **URGENT: Merge recovery PR** — `auto/recover-local-main-run245` contains 50 real code commits (tests, Linear MCP, aggregator fix, CI coverage) that never reached origin/main. Review and merge.
2. **Disable or redirect hourly schedule** — 245+ idle runs with no new work; every run costs compute.
3. **Add new workstreams** to DRIVER-BOARD.md if planned work exists.
4. **Configure CF Access on prod** (`CHITTY_CF_ACCESS_CLIENT_ID` / `CHITTY_CF_ACCESS_CLIENT_SECRET`) — clears ledger DLQ.
5. **Set `GITHUB_MCP_AUTHORIZATION`** on prod to reconnect ch1tty github backend.
6. **Rotate Notion token** — `op://ChittyOS-Integrations/notion/api_token`.
7. **Stale branch cleanup** — 975+ rogue `auto/` branches; enable auto-delete in GitHub Settings or bulk-delete locally.

## Run Log

_(Prior run log entries archived to git history — runs 1–241 trimmed for readability. Trimmed again at run 245.)_

### 2026-06-29 (idle — runs 242–244)
- **Workstream**: None — all A–E + F–AAAAAAAAA + SEC-FIX + GUARDRAIL-CLEANUP done; no new workstreams defined.
- **Branch/PR**: DRIVER-BOARD.md updated via GitHub MCP API (git push 403 in container).
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total)
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **242nd–244th consecutive idle runs.**

### 2026-06-29 (run 245 — recovery branch created)
- **Workstream**: None (all A–E done) — but discovered critical git divergence: local main has 50 unpushed code commits that are absent from origin/main.
- **Branch/PR**: `auto/recover-local-main-run245` pushed and PR opened. DRIVER-BOARD.md fixed (base64 corruption again) + trimmed + run 245 entry; pushed via GitHub MCP API.
- **Build**: clean (`tsc` exit 0, ch1tty@4.1.0) | **Tests**: 1370 pass / 0 fail / 2 skip (45 suites, 1372 total) — unchanged.
- **Actions**:
  - `npm ci` clean. `npm run build` clean (tsc exit 0). `npm test`: 1370/0/2.
  - Discovered: local main has 50 real code commits (test coverage #126–#176, Linear MCP feat, aggregator fix, CI coverage) not on origin/main. origin/main has 50 board-update commits not on local main. Divergence caused by board updates being pushed via GitHub MCP API while local code commits failed to push (non-fast-forward).
  - Pushed local main to `auto/recover-local-main-run245` (git push succeeded for new branch).
  - Created PR to recover the 50 code commits into main.
  - DRIVER-BOARD.md decoded from base64 (recurring corruption), trimmed, updated with run 245 entry.
  - PushNotification SENT (recovery branch + PR critical for human review).
- **State summary**: A ✅ B ✅ C ✅ D ✅ E ✅. Tests: 1370/0/2. Build: clean. **245th run — first with actionable finding.**
- **Next run**: Idle unless recovery PR is merged and new workstreams added. All guardrails enforced. 1 open PR (recovery).
