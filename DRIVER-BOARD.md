# ch1tty goal-driver board

Fallback board — Notion (notion backend) was unreachable at board creation time. This file serves as the cross-run durable state until Notion access is restored.

## Workstream Status

- [x] **A. Gateway up/refreshed/tested** — Build clean, 938 tests pass, 5 meta-tools confirmed (`ch1tty/search`, `ch1tty/execute`, `ch1tty/status`, `ch1tty/reload`, `ch1tty/cast`), docs present. DONE.
- [x] **B. GitHub MCP migration** — `servers.json` github entry already migrated to `https://api.githubcopilot.com/mcp/` with `envHeaders` for `GITHUB_MCP_AUTHORIZATION`. No `@modelcontextprotocol/server-github` anywhere. DONE.
- [x] **C. Focus-profile layer** — `focus-profiles.json` with 6 profiles (finance, governance, design, code, communication, ops), `CH1TTY_FOCUS` env var, per-call `focus` param on search/cast, `ch1tty/status` reports `availableFocusProfiles`, real tests in `test/focus.test.ts`. DONE.
- [x] **D. Scenario testing + simulation** — `test/scenario.test.ts` (1157 lines), `test/simulation.test.ts` (229 lines), `sim/scenarios.ts` harness driving real Aggregator over FixtureBackends. All 6 focus profiles covered. All tests pass. DONE.
- [x] **E. Alchemist brainstorm** — `focus-suggestions.json` suggestions catalog COMPLETE. 1750 combos, 1759 prompts across 6 profiles (154th pass); **372/372 tools at 6/6 — 100% complete coverage**. DONE (run 91, 2026-06-12).
- [x] **F. Cast miss-path focus suggestions** — `cast: no_match` and `cast: discovered` now surface catalog suggestions when focus is active. PR #365 MERGED. DONE (run 92, 2026-06-12).
- [x] **G. Search focus suggestions** — `ch1tty/search` now includes ranked catalog suggestions (combos + prompts) alongside tool results when focus is active and a query is present. PR #368 ✅ MERGED (run 93, 2026-06-12). 5 new tests, 945/0/2. DONE.

See Run Log below for full history. Next: UUUU.
