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
- [x] **BBBBBB** — cast explanation.lowestCandidateScore: number — score of the weakest candidate in the full pool. Identity: winnerScore - lowestCandidateScore === candidateScoreSpread. Present when >= 2 candidates. PR #512 ✅ MERGED (5749f4f, 2026-06-15). 9 new tests, 1586/0/2. DONE.
- [x] **CCCCCC** — cast explanation.winnerFocusBoostRatio: number — fraction of winner's total score from focus boost (winnerFocusBoost / winnerScore), [0,1]. Present when focus active + winner exists + winnerScore > 0. PR #513 ✅ MERGED (4eae278, 2026-06-15). 8 new tests, 1594/0/2. DONE.
- [x] **DDDDDD** — cast explanation.topCandidatesScoreVariance: number — variance of topCandidates scores (sum of squared deviations from mean, divided by N). Present when >= 2 topCandidates. Absent on no_match or single candidate. PR #514 ✅ MERGED (4787dec, 2026-06-15). 8 new tests, 1602/0/2. DONE.
- [x] **EEEEEE** — cast explanation.runnerUpInFocus: boolean — whether the runner-up tool's server or category matches the active focus profile. Present when focus active + runner-up exists (same conditions as focusDecisive/focusMargin). Absent when no focus, no_match, or < 2 candidates. Symmetric to winnerInFocus. PR #515 ✅ MERGED (444b18c, 2026-06-15). 8 new tests, 1610/0/2. DONE.
- [x] **FFFFFF** — cast explanation.runnerUpFocusBoost: number — exact additive focus boost applied to runner-up (equals focusBoost when runnerUpInFocus; 0 otherwise). Present when focus active + runner-up exists. Absent when no focus, no_match, or < 2 candidates. Symmetric to winnerFocusBoost. PR #517 ✅ MERGED (e98e910, 2026-06-15). 8 new tests, 1618/0/2. DONE.
- [x] **GGGGGG** — cast explanation.runnerUpScoreBase: number — runner-up's relevance score before active focus boost was applied (runnerUpScore - runnerUpFocusBoost). Identity: runnerUpScoreBase + runnerUpFocusBoost = runnerUpScore. Symmetric to winnerScoreBase. PR merged via parallel session (201303e, 2026-06-15). 8 new tests, 1626/0/2. DONE.
- [x] **HHHHHH** — cast explanation.topCandidatesScoreStdDev: number — standard deviation of topCandidates scores (sqrt of topCandidatesScoreVariance). Same units as scores, same presence conditions as topCandidatesScoreVariance. PR #521 ✅ MERGED (2026-06-15). 8 new tests, 1634/0/2. DONE.
- [x] **HHHHHH** (b) — cast explanation.runnerUpFocusBoostRatio: number — fraction of runner-up's total score from focus boost (runnerUpFocusBoost / runnerUpScore), [0,1]. Present when focus active + runner-up exists + runnerUpScore > 0. Absent when no focus, no_match, < 2 candidates, or runnerUpScore === 0. PR #522 ✅ MERGED (2026-06-15). 8 new tests, 1642/0/2. DONE.
- [x] **IIIIII** — cast explanation.inFocusMeanScore: number — arithmetic mean score of in-focus candidates. Same presence conditions as inFocusTopScore. PR #523 ✅ MERGED (2026-06-15). 8 new tests, 1650/0/2. DONE.
- [x] **JJJJJJ** — cast explanation.rawFocusMargin: number — winnerScoreBase - runnerUpScoreBase (unfocused score gap, strips focus boost from both sides). Present when focus active + runner-up exists. Can be negative when focus reversed ranking. PR #525 ✅ MERGED (3baf457, 2026-06-15). 8 new tests, 1658/0/2. DONE.
- [x] **KKKKKK** — cast explanation.focusNetBoostDelta: number — net differential focus boost winner received vs runner-up (winnerFocusBoost - runnerUpFocusBoost). +focusBoost when winner in-focus/runner-up out; 0 when both same; -focusBoost when vice versa. Identity: focusMargin === rawFocusMargin + focusNetBoostDelta. Present when focus active + runner-up exists. PR #529 ✅ MERGED (2026-06-15). 8 new tests, 1668/0/2. DONE.
- [x] **LLLLLL** — cast explanation.outOfFocusBottomScore: number. PR #529 (2nd) ✅ MERGED. DONE.
- [x] **MMMMMM** — cast explanation.inFocusBottomScore: number. PR #531 ✅ MERGED. DONE.
- [x] **NNNNNN** — cast explanation.rawFocusMarginRatio: number. PR #532 ✅ MERGED. DONE.
- [x] **OOOOOO** — cast explanation.focusMarginRatio: number. PR #533 ✅ MERGED. DONE.
- [x] **PPPPPP** — cast explanation.candidateScoreEntropy: number. PR #534 ✅ MERGED. DONE.
- [x] **QQQQQQ** — cast explanation.topCandidatesGiniCoefficient: number. PR #535 ✅ MERGED. DONE.
- [x] **RRRRRR** — cast explanation.scoreDominanceIndex: number. PR #536 ✅ MERGED. DONE.
- [x] **SSSSSS** — cast explanation.candidateGiniCoefficient: number. PR #537 ✅ MERGED. DONE.
- [x] **TTTTTT** — cast explanation.topCandidatesScoreSkewness: number. PR #538 ✅ MERGED. DONE.
- [x] **UUUUUU** — cast explanation.candidateScoreSkewness: number (3rd moment). PR #539 ✅ MERGED. DONE.
- [x] **VVVVVV** — cast explanation.candidateScoreVariance: number (2nd moment). PR #540 ✅ MERGED. DONE.
- [x] **WWWWWW** — cast explanation.candidateScoreStdDev: number. PR #542 ✅ MERGED. DONE.
- [x] **XXXXXX** — cast explanation.candidateScoreMean: number (1st moment). PR #543 ✅ MERGED. DONE.
- [x] **YYYYYY** — cast explanation.medianCandidateScore: number. PR #544 ✅ MERGED. DONE.
- [x] **ZZZZZZ** — cast explanation.candidateScoreMeanRatio: number. PR #545 ✅ MERGED. DONE.
- [x] **AAAAAAA** — cast explanation.candidateScoreCoefficientOfVariation: number (CV). PR #546 ✅ MERGED. DONE.
- [x] **BBBBBBB** — cast explanation.medianToMeanRatio: number. PR #548 ✅ MERGED. DONE.
- [x] **CCCCCCC** — cast explanation.winnerToMedianRatio: number. PR #549 ✅ MERGED. DONE.
- [x] **DDDDDDD** — cast explanation.winnerScoreZScore: number. PR #550 ✅ MERGED. DONE.
- [x] **EEEEEEE** — cast explanation.runnerUpScoreZScore: number. PR #551 ✅ MERGED. DONE.
- [x] **FFFFFFF** — cast explanation.zScoreGap: number (winner-runnerUp gap in stddev units). PR #552 ✅ MERGED. DONE.
- [x] **GGGGGGG** — cast explanation.candidateScoreNormalizedRange: number (spread / mean). PR #553 ✅ MERGED. DONE.
- [x] **HHHHHHH** — cast explanation.lowestCandidateScoreRatio: number. PR #554 ✅ MERGED. DONE.
- [x] **IIIIIII** — cast explanation.nonZeroCandidateFraction: number. PR #555 ✅ MERGED. DONE.
- [x] **JJJJJJJ** — cast explanation.topHeavinessRatio: number (top-5 share of total score mass). PR #556 ✅ MERGED. DONE.
- [x] **KKKKKKK** — cast explanation.candidateScoreHerfindahlIndex: number (HHI concentration). PR #557 ✅ MERGED (7295780, 2026-06-16, this run). 8 new tests. DONE.
- [x] **LLLLLLL** — cast explanation.effectiveN: number (1/HHI — effective candidate count). PR #558 ✅ MERGED (parallel session). DONE.
- [x] **MMMMMMM** — cast explanation.scoreEntropyNormalized: number (entropy / log2(nonZeroCount)). PR #559 ✅ MERGED (parallel session). DONE.
- [x] **NNNNNNN** — cast explanation.candidateScoreIQR: number (interquartile range, robust spread measure). PR #560 ✅ MERGED (parallel session). DONE.
- [x] **OOOOOOO** — cast explanation.candidateScoreIQRRatio: number (IQR / mean). PR #561 ✅ MERGED (parallel session). DONE.
- [x] **PPPPPPP** — cast explanation.top2HeavinessRatio: number (top-2 share of total score mass). PR #563 ✅ MERGED (parallel session). DONE.
- [x] **QQQQQQQ** — cast explanation.candidateScoreKurtosis: number (4th moment, excess kurtosis — completes 4-moment characterisation). PR #562 ✅ MERGED (this run). DONE.
- [x] **RRRRRRR** — cast explanation.winnerRunnerUpGap: number. PR #566 ✅ MERGED (parallel session). DONE.
- [x] **SSSSSSS** — cast explanation.runnerUpMeanGap: number. PR #567 ✅ MERGED (parallel session). DONE.
- [x] **TTTTTTT** — cast explanation.candidateScoreGeometricMean: number. PR #568 ✅ MERGED (parallel session). DONE.
- [x] **UUUUUUU** — cast explanation.candidateScoreHarmonicMean: number. PR #569 ✅ MERGED (parallel session). DONE.
- [x] **VVVVVVV** — cast explanation.candidateScoreP90: number. PR #570 ✅ MERGED (parallel session). DONE.
- [x] **WWWWWWW** — cast explanation.candidateScoreP10: number. PR #571 ✅ MERGED (parallel session). DONE.
- [x] **XXXXXXX** — cast explanation.candidateScoreP80Range: number. PR #572 ✅ MERGED (parallel session). DONE.
- [x] **YYYYYYY** — cast explanation.candidateScoreMAD: number (median absolute deviation). PR #573 ✅ MERGED (parallel session). DONE.
- [x] **ZZZZZZZ** — cast explanation.candidateScoreMADRatio: number (MAD / median). PR #575 ✅ MERGED (parallel session). DONE.
- [x] **AAAAAAAA** — cast explanation.candidateScoreRobustSkewness: number. PR #576 ✅ MERGED (parallel session). DONE.
- [x] **BBBBBBBB** — cast explanation.candidateScoreQuantileSkewness: number. PR #577 ✅ MERGED (parallel session). DONE.
- [x] **CCCCCCCC** — cast explanation.candidateScoreWinsorizedMean: number. PR #578 ✅ MERGED (parallel session). DONE.
- [x] **DDDDDDDD** — cast explanation.candidateScoreJainFairnessIndex: number (Jain's fairness index = (Σx)²/(n·Σx²)). PR #579 ✅ MERGED (parallel session). DONE.
- [x] **EEEEEEEE** — cast explanation.topCandidatesKurtosis: number. PR #583 ❌ CLOSED (parallel race — main advanced EEEEEEEE→YYYYYYYY while #583 sat open; same feature now carried by PR #611 ZZZZZZZZ). Feature not yet merged; continue via PR #611.
- [ ] **ZZZZZZZZ** — cast explanation.topCandidatesKurtosis: number. PR #611 🔄 OPEN (parallel session, 2218/0/2). Feature to merge here.

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

### 2026-06-15 (run 161 — EEEEEE)
- **Workstream**: A (gateway observability) — EEEEEE: `cast explanation.runnerUpInFocus: boolean`
- **Branch/PR**: `auto/DDDDDD-cast-explain-runner-up-in-focus` → PR #515 (open, EEEEEE — renamed from DDDDDD after parallel session race)
- **Build**: clean | **Tests**: 1602/0/2 (+8 EEEEEE from 1594 CCCCCC baseline)
- **What was done**:
  - Startup: npm ci clean, build clean. Merged CCCCCC (PR #513 → 4eae278). Corrected BBBBBB+CCCCCC to DONE.
  - Parallel session race: another run opened PR #514 (DDDDDD topCandidatesScoreVariance) at 19:17 UTC. This run renamed its work DDDDDD→EEEEEE to avoid collision.
  - EEEEEE: `src/aggregator.ts` `buildCastExplanation` — added `runnerUpInFocus: isInFocus(focus!, scoredTools[1])` inside `best !== undefined && topCandidates.length > 1` focus block. Tool description updated.
  - `test/eeeeee-cast-explain-runner-up-in-focus.test.ts`: 8 new tests. Build clean. 1602/0/2.
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: Merge DDDDDD (#514) then EEEEEE (#515). Then FFFFFF — `runnerUpFocusBoost: number`.

### 2026-06-15 (run 162 — FFFFFF)
- **Workstream**: A (gateway observability) — FFFFFF: `cast explanation.runnerUpFocusBoost: number`
- **Branch/PR**: `auto/FFFFFF-cast-explain-runner-up-focus-boost` → PR TBD
- **Build**: clean | **Tests**: 1618/0/2 (+8 FFFFFF from 1610 EEEEEE baseline)
- **What was done**:
  - Startup: merged DDDDDD (#514 → 4787dec) then EEEEEE (#515 → 444b18c). Conflict resolution: rebased PR #515 branch onto main after #514 squash, resolved aggregator.ts (keep both description strings) and DRIVER-BOARD.md (DDDDDD DONE + EEEEEE entry).
  - FFFFFF: `src/aggregator.ts` `buildCastExplanation` — added `runnerUpFocusBoost: isInFocus(focus!, scoredTools[1]) ? focusBoost : 0` alongside `runnerUpInFocus` in the `best !== undefined && topCandidates.length > 1` focus block. Tool description updated.
  - `test/ffffff-cast-explain-runner-up-focus-boost.test.ts`: 8 new tests. Build clean. 1618/0/2.
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: Merge FFFFFF (PR to be opened). Then GGGGGG — `runnerUpScoreBase: number` (runner-up score before focus boost; runnerUpScore - runnerUpFocusBoost) to complete the runner-up score decomposition parallel to winnerScoreBase.

### 2026-06-15 (run 163 — FFFFFF merged + collision on GGGGGG)
- **Workstream**: A (gateway observability) — FFFFFF merged; GGGGGG landed via parallel session
- **Branch/PR**: PR #519 `auto/GGGGGGG-cast-explain-runner-up-score-base` → closed (duplicate; parallel session 201303e won the race with GGGGGG)
- **Build**: clean | **Tests**: 1626/0/2 on main after GGGGGG
- **What was done**:
  - Startup: npm ci clean, build clean, 1610/0/2 on main (EEEEEE HEAD 444b18c). Board read from DRIVER-BOARD.md (Notion 401 — recurring). PR #517 (FFFFFF) confirmed open with all 3 CodeQL checks green. PR #516 (EEEEEE stale) closed.
  - Merged PR #517 (FFFFFF runnerUpFocusBoost) squash → e98e910. Reset main.
  - Implemented GGGGGGG (7 G's): `runnerUpScoreBase` in aggregator.ts + 8 tests. PR #519 opened. All 3 CodeQL checks passed.
  - Parallel session collision: origin/main advanced to 201303e (GGGGGG, 6 G's) — same feature (runnerUpScoreBase). PR #519 had merge conflicts. Closed #519 as superseded.
  - CodeRabbit + Codex rate-limited (recurring — no action).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: main is at GGGGGG (201303e, 1626/0/2). Next: HHHHHH — candidate `runnerUpFocusBoostRatio: number` (runnerUpFocusBoost / runnerUpScore — the fraction of runner-up's total score from focus boost; symmetric to winnerFocusBoostRatio).

### 2026-06-15 (run 163b — HHHHHH parallel session, runnerUpFocusBoostRatio)
- **Workstream**: A (gateway observability) — HHHHHH (b): `cast explanation.runnerUpFocusBoostRatio: number`
- **Branch/PR**: `auto/HHHHHH-cast-explain-runner-up-focus-boost-ratio` → PR #522
- **Build**: clean | **Tests**: 1634/0/2 (+8 from 1626 GGGGGG baseline)
- **What was done**: Parallel session with #521; both labeled HHHHHH. Added runnerUpFocusBoostRatio in focus+runner-up block.
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).

### 2026-06-15 (run 164 — JJJJJJ) ✅ COMPLETE
- **Workstream**: A (gateway observability) — merged HHHHHH (#521, #522) + IIIIII (#523); created JJJJJJ: `cast explanation.rawFocusMargin: number`
- **Branch/PR**: `auto/batch-merge-hhhhhh-iiiiii` → PR #524 ✅ MERGED | `auto/JJJJJJ-cast-explain-raw-focus-margin` → PR #525 ✅ MERGED (3baf457)
- **Build**: clean | **Tests**: 1658/0/2 (+8 JJJJJJ from 1650 IIIIII baseline)
- **What was done**:
  - Startup: npm ci clean, build clean, 1626/0/2 on main (GGGGGG HEAD 9d02bc2). Board read from DRIVER-BOARD.md (Notion 401 — recurring).
  - Closed #521, #522, #523 (parallel-session PRs with merge conflicts). Squash-merged locally with conflict resolution: HHHHHH topCandidatesScoreStdDev + HHHHHH(b) runnerUpFocusBoostRatio + IIIIII inFocusMeanScore. Batched as PR #524 → merged (919fc4b). Tests: 1650/0/2.
  - JJJJJJ: added rawFocusMargin (winnerScoreBase - runnerUpScoreBase) in focus+runner-up block. 8 new tests. PR #525 → merged (3baf457). Tests: 1658/0/2.
  - Blockers: direct `git push main` 403 (recurring — use PR path); CodeRabbit rate-limited on #525 (recurring); Notion 401.
- **Next run priority**: KKKKKK — `rawFocusMarginRatio: number` (rawFocusMargin / winnerScoreBase when winnerScoreBase > 0 — relative unfocused margin normalised to winner's base). Or alternatively `inFocusBottomScore: number` (lowest score among in-focus candidates, complement to inFocusTopScore).

### 2026-06-15 (run 165 — KKKKKK) ✅ COMPLETE
- **Workstream**: A (gateway observability) — KKKKKK: `cast explanation.outOfFocusMeanScore: number`
- **Branch/PR**: `auto/KKKKKK-cast-explain-out-of-focus-mean-score` → PR #527 (renamed from JJJJJJ — collision with run 164 rawFocusMargin)
- **Build**: clean | **Tests**: 1610/0/2 (+8 KKKKKK from 1602 baseline)
- **What was done**:
  - Startup: main at 966ba68 (run 164 JJJJJJ=rawFocusMargin). JJJJJJ was already taken; renamed workstream to KKKKKK.
  - Added outOfFocusMeanScore: precomputed outOfFocusScores array + outOfFocusMeanScore mean; wired into focus+best block alongside topOutOfFocusScore. Description line added after inFocusMeanScore. Symmetric to inFocusMeanScore.
  - 8 new tests (KKKKKK-1..8). All pass.
  - PR #527 opened; CI 3/3 green; merged.
  - CodeRabbit + Codex rate-limited on #527 (recurring — no action).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: LLLLLL — `outOfFocusBottomScore: number` (lowest relevance score among out-of-focus candidates, complement to topOutOfFocusScore; symmetric to inFocusBottomScore if that lands first) or `rawFocusMarginRatio: number` (rawFocusMargin / winnerScoreBase).

### 2026-06-15 (run 165 — KKKKKK)
- **Workstream**: A (gateway observability) — JJJJJJ confirmed DONE; KKKKKK: `cast explanation.focusNetBoostDelta: number`
- **Branch/PR**: `auto/KKKKKK-cast-explain-focus-net-boost-delta` → PR #529 ✅ MERGED (2026-06-15)
- **Build**: clean | **Tests**: 1668/0/2 (+8 KKKKKK from 1658 JJJJJJ baseline; 0 fail)
- **What was done**:
  - Fixed KKKKKK-4 test: STRIPE_TOOLS had 0 keyword overlap → filtered before focus boost. Added STRIPE_TOOLS_WEAK (query+database = 2/5=0.4 base, 0.9 after boost) so stripe is in-focus runner-up but neon (1.0) wins.
  - Rebased onto main after parallel sessions added NNNNNN/OOOOOO/PPPPPP; resolved conflicts keeping both rawFocusMarginRatio (HEAD) and focusNetBoostDelta (branch).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).

### 2026-06-15 (run 166 — LLLLLL) ✅ COMPLETE
- **Workstream**: A (gateway observability) — LLLLLL: `cast explanation.outOfFocusBottomScore: number`
- **Branch/PR**: `auto/LLLLLL-cast-explain-out-of-focus-bottom-score` → PR #529
- **Build**: clean | **Tests**: 1618/0/2 (+8 LLLLLL from 1610 KKKKKK baseline)
- **What was done**:
  - Startup: main at 640fc2ee (KKKKKK outOfFocusMeanScore merged). Added outOfFocusBottomScore: lowest score among out-of-focus candidates. Reuses outOfFocusScores array. Triple (bottom/mean/top) completes the out-of-focus score distribution.
  - Description line added after outOfFocusMeanScore. Wired into output spread after outOfFocusMeanScore.
  - 8 new tests (LLLLLL-1..8). All pass.
  - PR #529 opened; CI 3/3 green; merged.
  - CodeRabbit + Codex rate-limited (recurring — no action).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: MMMMMM — `inFocusBottomScore: number` (lowest score among in-focus candidates, symmetric bottom complement to inFocusTopScore; completes the in-focus triple: top/mean/bottom) or `rawFocusMarginRatio: number`.

### 2026-06-15 (run 167 — MMMMMM) ✅ COMPLETE
- **Workstream**: A (gateway observability) — MMMMMM: `cast explanation.inFocusBottomScore: number`
- **Branch/PR**: `auto/MMMMMM-cast-explain-in-focus-bottom-score` → PR #531
- **Build**: clean | **Tests**: 1626/0/2 (+8 MMMMMM from 1618 LLLLLL baseline)
- **What was done**:
  - Startup: main at 58e6413a (LLLLLL outOfFocusBottomScore merged). Added inFocusBottomScore: lowest score among in-focus candidates. Reuses inFocusScores array. Triple (bottom/mean/top) completes the in-focus score distribution.
  - Description line added after inFocusMeanScore. Wired into output spread after inFocusMeanScore.
  - 8 new tests (MMMMMM-1..8). All pass.
  - PR #531 opened; CI 3/3 green; merged.
  - CodeRabbit + Codex rate-limited (recurring — no action).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: NNNNNN — `rawFocusMarginRatio: number` (rawFocusMargin / winnerScoreBase when winnerScoreBase > 0 — relative unfocused margin normalised to winner's base; measures how much the focus boost mattered relative to the winner's organic strength).

### 2026-06-15 (run 168 — NNNNNN) ✅ COMPLETE
- **Workstream**: A (gateway observability) — NNNNNN: `cast explanation.rawFocusMarginRatio: number`
- **Branch/PR**: `auto/NNNNNN-cast-explain-raw-focus-margin-ratio` → PR #532
- **Build**: clean | **Tests**: 1634/0/2 (+8 NNNNNN from 1626 MMMMMM baseline)
- **What was done**:
  - Startup: main at 339430d7 (MMMMMM inFocusBottomScore merged). Added rawFocusMarginRatio: rawFocusMargin / winnerScoreBase (when winnerScoreBase > 0). Inline in the best+runner-up block alongside rawFocusMargin.
  - Description line added after rawFocusMargin. 8 new tests (NNNNNN-1..8). All pass.
  - PR #532 opened; CI 3/3 green; merged.
  - CodeRabbit + Codex rate-limited (recurring — no action).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: OOOOOO — `focusMarginRatio: number` (focusMargin / winnerScore — the post-focus gap as a fraction of winner's total score; symmetric to rawFocusMarginRatio but using the boosted scores).

### 2026-06-15 (run 169 — OOOOOO) ✅ COMPLETE
- **Workstream**: A (gateway observability) — OOOOOO: `cast explanation.focusMarginRatio: number`
- **Branch/PR**: `auto/OOOOOO-cast-explain-focus-margin-ratio` → PR #533
- **Build**: clean | **Tests**: 1642/0/2 (+8 OOOOOO from 1634 NNNNNN baseline)
- **What was done**:
  - Startup: main at 5021ed7b (NNNNNN rawFocusMarginRatio merged). Added focusMarginRatio: focusMargin / winnerScore (when winnerScore > 0). Inline in best+runner-up block alongside focusMargin. Symmetric to rawFocusMarginRatio in boosted score space.
  - Description line added after focusMargin. 8 new tests (OOOOOO-1..8). All pass.
  - PR #533 opened; CI 3/3 green; merged.
  - CodeRabbit + Codex rate-limited (recurring — no action).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: PPPPPP — `candidateScoreEntropy: number` (Shannon entropy of normalised candidate score distribution — measures how spread-out or concentrated scores are; low entropy = one dominant tool, high entropy = scores evenly spread).

### 2026-06-15 (run 170 — PPPPPP) ✅ COMPLETE
- **Workstream**: A (gateway observability) — PPPPPP: `cast explanation.candidateScoreEntropy: number`
- **Branch/PR**: `auto/PPPPPP-cast-explain-candidate-score-entropy` → PR #534 ✅ MERGED (0625d668)
- **Build**: clean | **Tests**: 1650/0/2 (+8 PPPPPP from 1642 OOOOOO baseline)

### 2026-06-15 (run 171 — QQQQQQ) ✅ COMPLETE
- **Workstream**: A (gateway observability) — QQQQQQ: `cast explanation.topCandidatesGiniCoefficient: number`
- **Branch/PR**: `auto/QQQQQQ-cast-explain-top-candidates-gini-coefficient` → PR #535 ✅ MERGED (a98ee7ab)
- **Build**: clean | **Tests**: 1658/0/2 (+8 QQQQQQ from 1650 PPPPPP baseline)
- **What was done**:
  - Startup: main at 0625d668 (PPPPPP candidateScoreEntropy merged). GitHub MCP token recovered (was expired ~23:00 UTC run 170 — now resolved).
  - QQQQQQ: added topCandidatesGiniCoefficient: Gini of topCandidates pool. Precomputed IIFE variable (sort ascending, G = (2·Σ(i+1)·s[i] / (n·total)) - (n+1)/n). Wired into topCandidates.length > 1 block alongside topCandidatesScoreStdDev. Description added after topCandidatesScoreStdDev.
  - 8 new tests (QQQQQQ-1..8). All pass. PR #535 merged.
  - CodeRabbit + Codex rate-limited (recurring — no action).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: RRRRRR — `scoreDominanceIndex: number` (winner's share of total candidate score mass: winnerScore / totalCandidateScore; present when winner exists and totalScore > 0).

### 2026-06-15 (run 172 — RRRRRR) ✅ COMPLETE
- **Workstream**: A (gateway observability) — RRRRRR: `cast explanation.scoreDominanceIndex: number`
- **Branch/PR**: `auto/RRRRRR-cast-explain-score-dominance-index` → PR #536 ✅ MERGED
- **Build**: clean | **Tests**: 1666/0/2 (+8 RRRRRR from 1658 QQQQQQ baseline)

### 2026-06-15 (run 173 — SSSSSS) ✅ COMPLETE
- **Workstream**: A (gateway observability) — SSSSSS: `cast explanation.candidateGiniCoefficient: number`
- **Branch/PR**: `auto/SSSSSS-cast-explain-candidate-gini-coefficient` → PR #537 ✅ MERGED
- **Build**: clean | **Tests**: 1674/0/2 (+8 SSSSSS from 1666 RRRRRR baseline)

### 2026-06-15 (run 174 — TTTTTT) ✅ COMPLETE
- **Workstream**: A (gateway observability) — TTTTTT: `cast explanation.topCandidatesScoreSkewness: number`
- **Branch/PR**: `auto/TTTTTT-cast-explain-top-candidates-score-skewness` → PR #538 ✅ MERGED
- **Build**: clean | **Tests**: 1682/0/2 (+8 TTTTTT from 1674 SSSSSS baseline)

### 2026-06-15 (run 175 — UUUUUU) ✅ COMPLETE
- **Workstream**: A (gateway observability) — UUUUUU: `cast explanation.candidateScoreSkewness: number`
- **Branch/PR**: `auto/UUUUUU-cast-explain-candidate-score-skewness` → PR #539 ✅ MERGED (0ac9474)
- **Build**: clean | **Tests**: 1690/0/2 (+8 UUUUUU from 1682 TTTTTT baseline)
- **What was done**:
  - Added candidateScoreSkewness: IIFE computing 3rd standardised moment of full candidate pool. Reuses candidateScoreEntropyTotal for mean. Absent when < 2 candidates or stddev === 0.
  - Test fix: neon tool description changed to 'billing sql query database' to share keyword 'billing' with intent (scorer filters 0-score tools, so both tools must match at least one keyword).
  - 8 new tests (UUUUUU-1..8). All pass. PR #539 merged.
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).

### 2026-06-15 (run 176 — VVVVVV) ✅ COMPLETE
- **Workstream**: A (gateway observability) — VVVVVV: `cast explanation.candidateScoreVariance: number`
- **Branch/PR**: `auto/VVVVVV-cast-explain-candidate-score-variance` → PR #540 ✅ MERGED (a741381)
- **Build**: clean | **Tests**: 1698/0/2 (+8 VVVVVV from 1690 UUUUUU baseline)
- **What was done**: Added candidateScoreVariance: (1/n)*Σ(x_i-mean)² over full pool. Reuses candidateScoreEntropyTotal for mean. Full-pool parallel to topCandidatesScoreVariance. Equals topCandidatesScoreVariance when candidateCount <= 5. 8 new tests.

### 2026-06-15 (run 177 — WWWWWW) ✅ COMPLETE
- **Workstream**: A (gateway observability) — WWWWWW: `cast explanation.candidateScoreStdDev: number`
- **Branch/PR**: `auto/WWWWWW-cast-explain-candidate-score-std-dev` → PR TBD
- **Build**: clean | **Tests**: 1706/0/2 (+8 WWWWWW from 1698 VVVVVV baseline)
- **What was done**: Added candidateScoreStdDev: sqrt(candidateScoreVariance). Derived directly from the precomputed candidateScoreVariance — no extra loop. Full-pool parallel to topCandidatesScoreStdDev. Identity: candidateScoreStdDev^2 === candidateScoreVariance. Equals topCandidatesScoreStdDev when candidateCount <= 5. 8 new tests.

### 2026-06-15 (run 178 — XXXXXX) ✅ COMPLETE
- **Workstream**: A (gateway observability) — XXXXXX: `cast explanation.candidateScoreMean: number`
- **Branch/PR**: `auto/XXXXXX-cast-explain-candidate-score-mean` → PR TBD
- **Build**: clean | **Tests**: 1714/0/2 (+8 XXXXXX from 1706 WWWWWW baseline)
- **What was done**: Added candidateScoreMean: totalCandidateScore / candidateCount. Reuses candidateScoreEntropyTotal (no extra loop). Full-pool parallel to topCandidatesMeanScore. Always <= winnerScore. Equals topCandidatesMeanScore when candidateCount <= 5. 8 new tests.

### 2026-06-16 (run 180 — EEEEEEEE) 🔄 PR #583 OPEN
- **Workstream**: A (gateway observability) — EEEEEEEE: `cast explanation.topCandidatesKurtosis: number`
- **Branch/PR**: `auto/EEEEEEEE-cast-explain-top-candidates-kurtosis` → PR #583 (open, CI in progress)
- **Build**: clean | **Tests**: 2050/0/2 (+8 EEEEEEEE from 2042 DDDDDDDD baseline)
- **What was done**:
  - Startup: npm ci clean, build clean, 2042/0/2 on main (DDDDDDDD HEAD 0ed511f). Board read from DRIVER-BOARD.md (Notion 401 — recurring).
  - Closed stale PR #565 (PPPPPPP targeting old SHA — candidateScoreKurtosis already merged as QQQQQQQ at 9f7dcf09).
  - Backfilled DRIVER-BOARD: YYYYYYY through DDDDDDDD (parallel sessions since run 179). Tests: 1994→2042.
  - EEEEEEEE: `src/aggregator.ts` — added `topCandidatesKurtosis` IIFE after `topCandidatesScoreSkewness`: `(1/n)*Σ((x_i−mean)⁴/stddev⁴) − 3`. Same presence guard (>= 2 topCandidates, stddev > 0). Description line added after `topCandidatesScoreSkewness`. Wired into output spread after `topCandidatesScoreSkewness`.
  - `test/eeeeeeee-cast-explain-top-candidates-kurtosis.test.ts`: 8 new tests. All pass.
  - PR #583 opened. CodeQL in progress. CodeRabbit rate-limited (recurring — no action).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: FFFFFFFF — `topCandidatesP90: number` (90th-percentile score of the top-5 pool) or `topCandidatesMedian: number` (median of top pool, complement to topCandidatesMeanScore). Check if PR #583 merged first; if so continue from FFFFFFFF.

### 2026-06-16 (run 179 — QQQQQQQ) ✅ COMPLETE
- **Workstream**: A (gateway observability) — QQQQQQQ: `cast explanation.candidateScoreKurtosis: number`
- **Branch/PR**: `auto/NNNNNNN-cast-explain-candidate-score-kurtosis` → PR #562 ✅ MERGED (9f7dcf09)
- **Build**: clean | **Tests**: 1994/0/2 (+8 QQQQQQQ from baseline)
- **What was done**:
  - Startup: npm ci clean, build clean. Board read from DRIVER-BOARD.md (Notion 401 — recurring).
  - Merged PR #557 (KKKKKKK candidateScoreHerfindahlIndex → 7295780). Closed stale PR #547 (YYYYYY kurtosis targeting old SHA — YYYYYY slot already taken by medianCandidateScore #544).
  - Parallel sessions merged LLLLLLL (#558), MMMMMMM (#559), NNNNNNN (#560), OOOOOOO (#561), PPPPPPP (#563), RRRRRRR (#566), SSSSSSS (#567), TTTTTTT (#568), UUUUUUU (#569), VVVVVVV (#570), WWWWWWW (#571), XXXXXXX (#572) — 3 consecutive rebase cycles required.
  - QQQQQQQ (renamed NNNNNNN→PPPPPPP→QQQQQQQ due to 2 race losses): 4th standardised moment (excess kurtosis) — `(1/n)*Σ((x_i-mean)^4/stddev^4) - 3`. Computed via IIFE after candidateScoreSkewness. Same presence guard (>= 2 candidates, stddev > 0). Description line added. Wired into output spread after candidateScoreSkewness.
  - 8 new tests (QQQQQQQ-1..8): present/finite/absent-single/absent-identical-scores/absent-no_match/2-candidate-identity(-2)/present-no-focus/description. All pass.
  - Board backfilled: LLLLLL through XXXXXXX (parallel sessions).
- **Blockers (unchanged)**: Notion API token invalid (401). Ledger DLQ. CI 0-jobs (non-CodeQL, recurring).
- **Next run priority**: YYYYYYY (7 Y's) — `topCandidatesKurtosis: number` (4th moment of topCandidates pool, symmetric to topCandidatesScoreSkewness; completes 4-moment characterisation for top pool).
