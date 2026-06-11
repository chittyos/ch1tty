# ch1tty goal-driver board

Fallback board — Notion (notion backend) was unreachable at board creation time. This file serves as the cross-run durable state until Notion access is restored.

## Workstream Status

- [x] **A. Gateway up/refreshed/tested** — Build clean, 938 tests pass, 5 meta-tools confirmed (`ch1tty/search`, `ch1tty/execute`, `ch1tty/status`, `ch1tty/reload`, `ch1tty/cast`), docs present. DONE.
- [x] **B. GitHub MCP migration** — `servers.json` github entry already migrated to `https://api.githubcopilot.com/mcp/` with `envHeaders` for `GITHUB_MCP_AUTHORIZATION`. No `@modelcontextprotocol/server-github` anywhere. DONE.
- [x] **C. Focus-profile layer** — `focus-profiles.json` with 6 profiles (finance, governance, design, code, communication, ops), `CH1TTY_FOCUS` env var, per-call `focus` param on search/cast, `ch1tty/status` reports `availableFocusProfiles`, real tests in `test/focus.test.ts`. DONE.
- [x] **D. Scenario testing + simulation** — `test/scenario.test.ts` (1157 lines), `test/simulation.test.ts` (229 lines), `sim/scenarios.ts` harness driving real Aggregator over FixtureBackends. All 6 focus profiles covered. All tests pass. DONE.
- [ ] **E. Alchemist brainstorm** — `focus-suggestions.json` suggestions catalog, actively growing. See run log below for current pass number.

## Live Gateway State (as of 2026-06-11)

- Connected backends: cloudflare-builds (7 tools), evidence (3), browser-rendering (3), context7 (2), thinking (1), fs (14), playwright (23), orchestrator (13) — 66 total tools
- Not connected: chittyos, cloudflare, GitHub, linear, notion, stripe, neon (lazy, auth-gated)
- System health: degraded (ledger DLQ has 6 entries — ledger.chitty.cc unreachable)
- Brain: ok (embedding circuit open=false, ollama circuit open=false)

## Blockers

- Notion backend not accessible in remote execution environment (auth/config issue — `/home/ubuntu/.local/bin/notion-mcp-wrapper.sh` not present or token not set). Human must configure `NOTION_API_TOKEN` and the wrapper script to restore Notion access.
- Ledger DLQ backlog (6 entries): ledger.chitty.cc unreachable. System health shows `degraded`. Run `cat ~/.ch1tty/ledger.dlq.jsonl` to inspect entries.

## Run Log

---

### Run 71 — 2026-06-11 (auto-driver)

**Workstream advanced**: E (Alchemist catalog)
**Branch**: `auto/E-catalog-132nd-pass`
**Build**: clean (0 errors)
**Tests**: 938 pass, 0 fail, 2 skipped (749 test nodes, 45 suites)

**What was done**:
- Inspected all workstreams; A, B, C, D confirmed done (no open PRs, build clean, focus profiles in place, scenario harness complete)
- Catalog at 131st pass, 1466 combos, 518 verified — identified `playwright/browser_press_key` and `playwright/browser_file_upload` both at 1/6 profile coverage
- Added 132nd pass: 10 new verified combos (2 per tool × 5 missing profiles each) + 10 new prompts — all chains use connected backends (playwright, orchestrator, cloudflare-builds, context7)
- Both tools now at 6/6 profile coverage
- Total: 1476 combos, 1497 prompts
- Created this fallback board since Notion backend is not accessible

**Next run priority**:
- Continue catalog toward 133rd pass: identify remaining tools at <6/6 coverage and add verified combos (prioritize tools reachable via connected backends: playwright, orchestrator, cloudflare-builds, context7, thinking, fs, evidence, browser-rendering)
- If Notion access is restored, migrate this board to a proper Notion page titled "ch1tty goal-driver board"
- Consider bumping `cloudflare-builds/workers_builds_cancel` and `playwright/browser_close` from 1/6 to 6/6 (both have connected backends)
