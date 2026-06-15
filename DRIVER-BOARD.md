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
- [x **QQ** — ch1tty/execute dryRun sessionContext (PR #436). DONE.
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
- [x] **AAAAA** — cast explanation.focusDecisive: boolean — true when winner would not have won without focus boost. PR #475 ✅ MERGED (run 147, 2026-06-15). 8 new tests, 1369/0/2. DONE.
- [x] **BBBBB** — cast latencyBreakdown.registryMs — registry fetch time isolated from scoringMs. PR #477 ✅ MERGED (4949c21, run 147, 2026-06-15). Codex P2 fix: times only getRegistry(), not allSettled wrapper. 8 new tests, 1377/0/2. DONE.
- [x] **CCCCC** — cast explanation.focusMargin: number — raw score gap between winner and runner-up in focus-biased space (winnerScore - runnerUpScore). PR #478 ✅ MERGED (7d2d572, run 148, 2026-06-15). 8 new tests, 1385/0/2. DONE.
- [x] **DDDDD** — /api/v1/health warn body: brainCircuitOpen: true when systemHealth.brainDegraded — surfaces brain circuit state in the 200 warn response without a separate /api/v1/status call. PR #480 ✅ MERGED (3f4e107, run 150, 2026-06-15). 8 new tests, 1393/0/2. DONE.
- [x] **EEEEE** — /api/v1/health warn body: ledgerWarn: true when systemHealth.ledgerStatus === 'warn' — symmetric to brainCircuitOpen; distinguishes ledger-drops/flushErrors warn from brain-circuit warn. PR #481 ✅ MERGED (c04f708, run 150, 2026-06-15). 8 new tests, 1401/0/2. DONE.
- [x] **FFFFF** — cast explanation.focusBias: number — fraction of winner-runner-up margin attributable to focus boost (winnerFocusBoost / focusMargin). Absent when focusMargin === 0 (division-by-zero guard), no runner-up, focus inactive, or no_match. PR #483 ✅ MERGED (b697884, run 151, 2026-06-15). 8 new tests, 1409/0/2. DONE.
- [x] **GGGGG** — cast explanation.focusConfidence: number — focusBias clamped to [0,1]. Same presence conditions as focusBias. Unlike focusBias (can exceed 1), focusConfidence is always [0,1] — a clean percentage of focus attribution. PR #485 ✅ MERGED (1e9407a, run 152, 2026-06-15). 8 new tests, 1417/0/2. DONE.
- [x] **HHHHH** — cast explanation.winnerServer: string — server ID of the winning tool (segment before "/" in namespaced name, e.g. "neon" from "neon/query_database"). Absent on no_match. Present regardless of focus. Lets operators identify which backend resolved the intent without parsing the tool name. PR #486 ✅ MERGED (1e07a00, run 153, 2026-06-15). 8 new tests, 1425/0/2. DONE.
- [x] **IIIII** — cast explanation.focusRank: number — 1-based rank the winning tool would hold if focus boost were removed. focusRank===1 → winner led pre-focus; focusRank===2 → focus promoted from 2nd; etc. Absent when no focus or no_match. Consistent with focusDecisive. PR #488 ✅ MERGED (43d413f, run 154, 2026-06-15). 8 new tests, 1433/0/2. DONE.
- [x] **JJJJJ** — cast explanation.unfocusedWinner: string — namespaced tool that would have won without the active focus boost (pre-focus rank-1 tool). Present only when focus active, winner exists, and pre-focus leader differs from winner. Absent when no focus, no_match, or winner already led pre-focus (focusRank===1). PR #489 ✅ MERGED (0bed3cd, run 155, 2026-06-15). 8 new tests, 1441/0/2. DONE.
- [x] **KKKKK** — cast explanation.focusRankDelta: number — number of positions focus promoted the winning tool in pre-focus ranking (focusRank - 1). Present whenever focusRank is present (focus active + winner exists). 0 = winner already led pre-focus; N = promoted N positions. PR #490 ✅ MERGED (2a92665, run 156, 2026-06-15). 8 new tests, 1449/0/2. DONE.
- [x] **LLLLL** — cast explanation.winnerScoreBase: number — winner's pre-focus base score (winnerScore - winnerFocusBoost). Identity: winnerScoreBase + winnerFocusBoost = winnerScore always. Present when focus active + winner exists. PR #493 ✅ MERGED (0426ef5, run 157, 2026-06-15). 8 new tests, 1457/0/2. DONE. (PR #498 closed run 158 — stale duplicate; #493 had already merged in a parallel session.)
- [x] **MMMMM** — cast explanation.candidatesInFocusCount: number — count of scored candidates whose server or category matches the active focus profile. Present when focus active + winner exists (same conditions as winnerFocusBoost). PR #494 ✅ MERGED (75155c5, 2026-06-15). 8 new tests, 1465/0/2. DONE.
- [x] **NNNNN** — cast explanation.inFocusFraction: number — fraction of scored candidates that are in-focus (candidatesInFocusCount / candidateCount), [0,1]. Same presence conditions as candidatesInFocusCount; absent when candidateCount === 0. PR #495 ✅ MERGED (df640e0, 2026-06-15). 8 new tests, 1473/0/2. DONE.
- [x] **OOOOO** — /api/v1/health ok body: ledgerOk: true when systemHealth.ledgerStatus === 'ok' — symmetric to ledgerWarn. PR #496 ✅ MERGED (a64d80c, 2026-06-15). 8 new tests, 1481/0/2. DONE.
- [x] **PPPPP** — cast explanation.topOutOfFocusScore: number — highest relevance score among out-of-focus candidates. Present when focus active, winner exists, and at least one out-of-focus candidate exists. PR #497 ✅ MERGED (4ec2ee8, 2026-06-15). 8 new tests, 1489/0/2. DONE.
- [x] **QQQQQ** — cast explanation.outOfFocusWinnerGap: number — score gap between winner and best out-of-focus candidate (winnerScore - topOutOfFocusScore). Present under same conditions as topOutOfFocusScore. PR #499 ✅ MERGED (ac28f50, 2026-06-15, parallel session). 8 new tests, 1497/0/2. DONE. (PR #501 closed run 158 — stale duplicate with different impl; parallel session's #499 merged first.)
- [x] **RRRRR** — cast explanation.focusRankPercentile: number — normalized pre-focus rank (focusRank / candidateCount), [0,1]. Identity: focusRankPercentile * candidateCount === focusRank. PR #502 ✅ MERGED (a8381be, run 158, 2026-06-15). 8 new tests, 1505/0/2. DONE.
- [x] **SSSSS** — cast explanation.inFocusTopScore: number — highest relevance score among in-focus candidates. Present when focus active, winner exists, at least one in-focus candidate scored > 0.1. PR #500 ✅ MERGED (9a4f42c, run 159b, 2026-06-15). 8 new tests, 1513/0/2. DONE.
- [x] **TTTTT** — cast explanation.runnerUpServer: string — server ID of runner-up tool (segment before "/" in namespaced name). Present when winner + runner-up exist. Absent on no_match or single candidate. PR #503 ✅ MERGED (de9f281, run 160, 2026-06-15). 8 new tests, 1521/0/2. DONE.
- [x] **UUUUU** — cast explanation.winnerCategory: string — server category of winning tool (e.g. "ecosystem", "code", "communication"). Parallels winnerServer. Present when winner exists. Absent on no_match. PR #505 ✅ MERGED (542a151, run 159d/160, 2026-06-15). 8 new tests, 1529/0/2. DONE.
- [x] **VVVVV** — cast explanation.inFocusWinnerGap: number — score margin by which the out-of-focus winner beat the best in-focus candidate (winnerScore - inFocusTopScore). Present when focus active, winner out-of-focus, at least one in-focus candidate. PR #506 ✅ MERGED (7da94b4, run 159d, 2026-06-15). 8 new tests, 1537/0/2. DONE.
- [x] **WWWWW** — cast explanation.runnerUpCategory: string — category of the runner-up tool's server. Present when runner-up exists. Absent on no_match or single candidate. PR #507 ✅ MERGED (5aa83b9, run 159d, 2026-06-15). 8 new tests, 1545/0/2. DONE.
- [x] **XXXXX** — cast explanation.candidateScoreSpread: number — score range across all candidates (winnerScore - lowestCandidateScore). Present when >= 2 candidates. PR #508 ✅ MERGED (f6292a5, run 159d, 2026-06-15). 8 new tests, 1553/0/2. DONE.
- [x] **YYYYY** — cast explanation.topCandidatesMeanScore: number — mean score of topCandidates pool. Present when winner exists. PR #509 ✅ MERGED (bb2ccc0, 2026-06-15). 8 new tests, 1561/0/2. DONE.
- [x] **ZZZZZ** — cast explanation.outOfFocusCandidatesCount: number — complement of candidatesInFocusCount; identity: candidatesInFocusCount + outOfFocusCandidatesCount === candidateCount. PR #510 ✅ MERGED (295f920, 2026-06-15). 8 new tests, 1569/0/2. DONE.
- [x] **AAAAAA** — cast explanation.winnerScoreRatio: number — winnerScore / runnerUpScore. Multiplicative complement to focusMargin. Present when runner-up exists and runnerUpScore > 0. PR #511 ✅ MERGED (217dc63, 2026-06-15). 8 new tests, 1577/0/2. DONE.
- [ ] **BBBBBB** — cast explanation.lowestCandidateScore: number — score of the weakest candidate in the full pool. Identity: winnerScore - lowestCandidateScore === candidateScoreSpread. Present when >= 2 candidates. PR #512 CI running (2026-06-15).

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
- **Next run priority**:
  1. Plan AAAAA: candidates — (a) `/api/v1/health` warn body: surface `brainCircuitOpen: true` in 200 response when `systemHealth.status === 'warn'`; (b) `explanation.focusDecisive: boolean`; (c) cast `latencyBreakdown.registryMs`.

### 2026-06-15 (run 147)
- **Workstream**: AAAAA merged + BBBBB opened then merged
- **Branch/PR**: `auto/BBBBB-cast-latency-registry-ms` → PR #477 ✅ MERGED
- **Build**: clean | **Tests**: 1377/0/2

### 2026-06-15 (run 148)
- **Workstream**: CCCCC — `cast explanation.focusMargin: number`
- **Branch/PR**: `auto/CCCCC-cast-explain-focus-margin` → PR #478 ✅ MERGED (7d2d572)
- **Build**: clean | **Tests**: 1385/0/2

### 2026-06-15 (run 149)
- **Workstream**: DDDDD — `/api/v1/health` warn body brainCircuitOpen
- **Branch/PR**: PR #480 ✅ MERGED (3f4e107)
- **Build**: clean | **Tests**: 1393/0/2

### 2026-06-15 (run 150)
- **Workstream**: EEEEE — `/api/v1/health` warn body ledgerWarn
- **Branch/PR**: PR #481 ✅ MERGED (c04f708)
- **Build**: clean | **Tests**: 1401/0/2

### 2026-06-15 (run 151)
- **Workstream**: FFFFF — `cast explanation.focusBias: number`
- **Branch/PR**: PR #483 ✅ MERGED (b697884)
- **Build**: clean | **Tests**: 1409/0/2

### 2026-06-15 (run 152)
- **Workstream**: GGGGG — `cast explanation.focusConfidence: number`
- **Branch/PR**: PR #485 ✅ MERGED (1e9407a)
- **Build**: clean | **Tests**: 1417/0/2

### 2026-06-15 (run 153)
- **Workstream**: HHHHH — `cast explanation.winnerServer: string`
- **Branch/PR**: PR #486 ✅ MERGED (1e07a00)
- **Build**: clean | **Tests**: 1425/0/2

### 2026-06-15 (run 154)
- **Workstream**: IIIII — `cast explanation.focusRank: number`
- **Branch/PR**: PR #488 ✅ MERGED (43d413f)
- **Build**: clean | **Tests**: 1433/0/2

### 2026-06-15 (run 155)
- **Workstream**: JJJJJ — `cast explanation.unfocusedWinner: string`
- **Branch/PR**: PR #489 ✅ MERGED (0bed3cd)
- **Build**: clean | **Tests**: 1441/0/2

### 2026-06-15 (run 156)
- **Workstream**: KKKKK — `cast explanation.focusRankDelta: number`
- **Branch/PR**: PR #490 ✅ MERGED (2a92665)
- **Build**: clean | **Tests**: 1449/0/2

### 2026-06-15 (runs 157–158b — parallel sessions)
- LLLLL PR #493 ✅ (0426ef5), MMMMM PR #494 ✅ (75155c5), NNNNN PR #495 ✅ (df640e0)
- OOOOO PR #496 ✅ (a64d80c), PPPPP PR #497 ✅ (4ec2ee8)
- QQQQQ PR #499 ✅ (ac28f50), RRRRR PR #502 ✅ (a8381be)
- Tests: 1457→1505/0/2 across these merges

### 2026-06-15 (run 159b)
- **Workstream**: SSSSS — `cast explanation.inFocusTopScore: number`
- **Branch/PR**: PR #500 ✅ MERGED (9a4f42c)
- **Build**: clean | **Tests**: 1513/0/2

### 2026-06-15 (run 159c)
- **Workstream**: TTTTT — `cast explanation.runnerUpServer: string`
- **Branch/PR**: PR #503 ✅ MERGED (de9f281)
- **Build**: clean | **Tests**: 1521/0/2

### 2026-06-15 (run 160 — parallel session)
- **Workstream**: UUUUU — `cast explanation.winnerCategory: string`
- **Branch/PR**: `auto/UUUUU-cast-explain-winner-category` → PR #505 ✅ MERGED (542a151)
- **Build**: clean | **Tests**: 1529/0/2 (+8 UUUUU from 1521 TTTTT baseline)
- **What was done**:
  - Startup: npm ci clean, build clean, 1513/0/2 on main (SSSSS=9a4f42c). Board read from DRIVER-BOARD.md (Notion 401 — recurring). SSSSS confirmed done. TTTTT (PR #503) open with clean mergeable state.
  - Merged PR #503 (TTTTT runnerUpServer) squash → de9f281. Pulled main.
  - UUUUU: `src/aggregator.ts` `buildCastExplanation` — added `winnerCategory: best.category` alongside `winnerServer` and `winnerScore` inside `best !== undefined` guard. Tool description updated to document `winnerCategory`.
  - `test/uuuuu-cast-explain-winner-category.test.ts`: 8 new tests (present, non-empty string, reflects server config category, absent on no_match, present single candidate, present without focus, present with focus, description).
  - PR #505 merged (542a151). CodeRabbit + Codex rate-limited (recurring — no action).
- **Blockers (unchanged)**: Notion 401, ledger DLQ, CI 0-jobs (non-CodeQL, recurring).

### 2026-06-15 (run 159d — this session, VVVVV)
- **Workstream**: VVVVV — `cast explanation.inFocusWinnerGap: number`
- **Branch/PR**: `auto/VVVVV-cast-explain-in-focus-winner-gap` → PR TBD
- **Build**: clean | **Tests**: 1537/0/2 (+8 VVVVV from 1529 UUUUU baseline)
- **What was done**:
  - UUUUU (PR #505) confirmed merged at 542a151. TTTTT (#503) also confirmed merged.
  - VVVVV: `src/aggregator.ts` `buildCastExplanation` — added `inFocusWinnerGap: best!.score - inFocusTopScore` inside `!winnerInFocus && inFocusTopScore !== undefined` guard. Tool description updated to document inFocusWinnerGap.
  - `test/vvvvv-cast-explain-in-focus-winner-gap.test.ts`: 8 new tests (present/>=0/identity/absent-in-focus-winner/absent-no_match/absent-no-focus/absent-no-in-focus-candidates/description).
- **Blockers (unchanged)**: Notion 401, ledger DLQ, CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**:
  - Merge VVVVV (PR open) if CI green. Then WWWWW candidates: (a) cast explanation `runnerUpCategory: string` — category of the runner-up tool's server (symmetric to winnerCategory/runnerUpServer); (b) cast explanation `candidateScoreSpread: number` — range of candidate scores (max - min) when >= 2 candidates.
