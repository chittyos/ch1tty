# ch1tty goal-driver board

Fallback board — Notion API token invalid (401). This file is the cross-run durable state.
Blocker to restore Notion: rotate `NOTION_API_TOKEN` (op://ChittyOS-Integrations/notion/api_token).

NOTE: Previous runs stored this file as base64, causing 2000-byte truncation. Restored as plain text (run 146).

## Workstream Status (A–E: original; F+: ongoing observability improvements)

- [x] **A** — Gateway up/refreshed/tested. Build clean, 5 meta-tools confirmed. DONE.
- [x] **B** — GitHub MCP migration: `servers.json` github → `https://api.githubcopilot.com/mcp/` with envHeaders. DONE.
- [x] **C** — Focus-profile layer: `focus-profiles.json` (6 profiles), CH1TTY_FOCUS, per-call focus param, status reporting, tests. DONE.
- [x] **D** — Scenario testing + simulation: `test/scenario.test.ts`, `test/simulation.test.ts`, `sim/scenarios.ts` harness. DONE.
- [x] **E** — Alchemist catalog: `focus-suggestions.json` — 372/372 tools at 6/6, 100% coverage (run 91). DONE.
- [x] **F** — Cast miss-path focus suggestions (PR #365). DONE.
- [x] **G** — Search focus suggestions (PR #368). DONE.
- [x] **H** — `resolvedFromCatalog` on cast:executed/plan (PR #370). DONE.
- [x] **I** — `chainContinuation` hint on cast:executed/plan (PR #372). DONE.
- [x] **J** — Catalog stats in ch1tty/status (PR #374). DONE.
- [x] **K** — cast `chain: true` auto-chain execution (PR #376). DONE.
- [x] **L** — ch1tty/reload catalog freshness check (PR #378). DONE.
- [x] **M** — cast chain step-output forwarding / previousResult (PR #380). DONE.
- [x] **N** — cast chain_executed summary field (PR #382). DONE.
- [x] **O** — cast dryRun mode (PR #384). DONE.
- [x] **P** — cast explain mode: explanation object (PR #386). DONE.
- [x] **Q** — search explain mode (PR #388). DONE.
- [x] **R** — search inFocusOnly hard filter (PR #390). DONE.
- [x] **S** — Session-sticky focus (PR #392). DONE.
- [x] **T** — ch1tty/status session focus reporting (PR #394). DONE.
- [x] **U** — ch1tty/status per-session topTools (PR #397). DONE.
- [x] **V** — ch1tty/status coordinator-level global topTools (PR #399). DONE.
- [x] **W** — ch1tty/status catalog stats + activeFocusSuggestions (PR #401). DONE.
- [x] **X** — ch1tty/execute dryRun mode (PR #404). DONE.
- [x] **Y** — ch1tty/cast scope parameter (PR #406). DONE.
- [x] **Z** — ch1tty/status short mode (PR #409). DONE.
- [x] **AA** — ch1tty/search offset pagination (PR #411). DONE.
- [x] **BB** — ch1tty/execute per-call timeout (PR #413). DONE.
- [x] **CC** — ch1tty/cast per-call timeout (PR #414). DONE.
- [x] **DD** — Explicit sessionId param on search/execute/cast (PR #415). DONE.
- [x] **EE** — ch1tty/search recentlyUsed enrichment (PR #416). DONE.
- [x] **FF** — ch1tty/search sessionContext field (PR #418). DONE.
- [x] **GG** — ch1tty/search serverName field (PR #419). DONE.
- [x] **HH** — Session TTL eviction (PR #420). DONE.
- [x] **II** — ch1tty/execute sessionContext response (PR #421). DONE.
- [x] **JJ** — ch1tty/cast sessionContext in cast:executed/chain_executed (PR #423). DONE.
- [x] **KK** — ch1tty/cast sessionContext in cast:plan (PR #425). DONE.
- [x] **LL** — ch1tty/cast sessionContext in cast:discovered (PR #427). DONE.
- [x] **MM** — ch1tty/cast sessionContext in cast:no_match (PR #429). DONE.
- [x] **NN** — ch1tty/search minScore filter (PR #431). DONE.
- [x] **OO** — ch1tty/cast sessionContext in cast:resolved (PR #433). DONE.
- [x] **PP** — ch1tty/status coordinator toolsByServer breakdown (PR #434). DONE.
- [x] **QQ** — ch1tty/execute dryRun sessionContext (PR #436). DONE.
- [x] **RR** — Branch coverage sweep (PR #438). DONE.
- [x] **SS** — ch1tty/search minScore in explain output (PR #440). DONE.
- [x] **TT** — ch1tty/search explain in no-query path (PR #442). DONE.
- [x] **UU** — Branch coverage 100% (PR #444). DONE.
- [x] **VV** — ch1tty/search explain filterContext (PR #446). DONE.
- [x] **IIII** — Branch coverage gaps in aggregator/suggestions (PR #407). DONE.
- [x] **KKKK** — Branch coverage gaps in buildCastExplanation (PR #447). DONE.
- [x] **LLLL** — latencyMs in all cast response types (PR #449). DONE.
- [x] **MMMM** — ch1tty/status ledgerDlq shorthand (PR #451). DONE.
- [x] **NNNN** — cast latencyBreakdown scoringMs/executionMs (PR #453). DONE.
- [x] **OOOO** — ch1tty/status ledgerDlq.entries[] (PR #455). DONE.
- [x] **PPPP** — cast latencyBreakdown.brainMs (PR #456). DONE.
- [x] **QQQQ** — ch1tty/execute latencyMs (PR #458). DONE.
- [x] **RRRR** — ch1tty/search latencyMs (PR #460). DONE.
- [x] **SSSS** — cast explanation.brainMs when explain:true (PR #462). DONE.
- [x] **TTTT** — cast explanation.candidateCount (PR #463). DONE.
- [x] **UUUU** — cast explanation.winnerScore (PR #465). DONE.
- [x] **VVVV** — /api/v1/health 503 body ledgerDlq.entryCount (PR #467). DONE.
- [x] **WWWW** — ch1tty/status and ch1tty/reload latencyMs (PR #468). DONE.
- [x] **XXXX** — cast explanation topCandidates[n].inFocus (PR #470). DONE.
- [x] **YYYY** — cast explanation runnerUpScore + runnerUpTool (PR #472). DONE.
- [x] **ZZZZ** — cast explanation.winnerFocusBoost: exact boost applied to winner (0 if out-of-focus, absent if no focus/no_match). PR #473 ✅ MERGED (b16fed8, run 146, 2026-06-15). 7 new tests, 1361/0/2. DONE.

## Blockers

- **Notion API token** — Invalid (401). Human action: `chitty-mcp-token notion` or rotate token in 1Password.
- **Ledger DLQ** — 11+ entries: `ledger.chitty.cc` unreachable from remote container.
- **CI (main ci.yml)** — 0-jobs queue failure (non-CodeQL). Only CodeQL runs on PRs. Recurring pattern, non-blocking.

## Run Log

### 2026-06-14 (run 145 — last before this run)
- **Workstream**: YYYY — `cast explanation.runnerUpScore + runnerUpTool`
- **Branch/PR**: `auto/YYYY-cast-explain-runner-up` → PR #472 ✅ MERGED
- **Build**: clean | **Tests**: 1354/0/2
- **Next**: ZZZZ — `explanation.winnerFocusBoost`

### 2026-06-15 (run 146)
- **Workstream**: ZZZZ — `cast explanation.winnerFocusBoost`
- **Branch/PR**: `auto/ZZZZ-cast-explain-winnerfocusboost` → PR #473 ✅ MERGED (b16fed8)
- **Build**: clean | **Tests**: 1361/0/2 (+7 ZZZZ from 1354 baseline)
- **What was done**:
  - Startup: npm ci clean, build clean, 1354/0/2 (no open PRs). Board restored as plain text (was truncated base64 — recurring issue fixed).
  - Notion 401 confirmed. DRIVER-BOARD.md reconstructed from git history and written as plain text.
  - ZZZZ: `explanation.winnerFocusBoost` in `ch1tty/cast` when `explain:true` and focus active.
    - `src/aggregator.ts`: `buildCastExplanation` return — `winnerFocusBoost: winnerInFocus ? focusBoost : 0` inside focusName spread, only when `best !== undefined`. Tool description updated.
    - `test/zzzz-cast-explain-winnerfocusboost.test.ts`: 7 new tests (in-focus=boost, out-of-focus=0, no focus absent, plan path, consistency, no_match absent, description).
  - All 3 CodeQL checks green. PR #473 squash-merged. Board updated ZZZZ ✅.
- **Blockers (unchanged)**: Notion 401, ledger DLQ, CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**:
  1. Plan AAAAA: candidates — (a) `/api/v1/health` warn body: surface `brainCircuitOpen: true` in 200 response when `systemHealth.status === 'warn'`; (b) `explanation.focusDecisive: boolean` — computed as `winnerScore - winnerFocusBoost < runnerUpScore`; (c) cast `latencyBreakdown.registryMs` — registry fetch time isolated from scoringMs.
