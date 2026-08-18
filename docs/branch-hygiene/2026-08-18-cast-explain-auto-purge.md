# Branch Hygiene Run-Log — auto/* cast-explain metric-freeze purge

- **Date:** 2026-08-18
- **Repo:** chittyos/ch1tty
- **Operator:** gh authed as `chitcommit`
- **Directive:** CLAUDE.md §buildCastExplanation metric freeze — all `auto/*cast-explain*` branches are guardrail violations, deleted unconditionally; plus other `auto/*` merged into main, plus other `auto/*` >30d with no open PR.

## Build / Test
- `npm run build` (tsc): **PASS** (exit 0)
- `npm test` (node --test via tsx): **PASS** — 1441 tests, 1440 pass, 0 fail, 1 skipped (exit 0)

## Branch counts
- `auto/*` before: **1008**
- `auto/*` after: **66**
- Deleted: **942**
  - `auto/*cast-explain*` (unconditional): **261**
  - other `auto/*` merged into main: **10**
  - other `auto/*` stale >30d, no open PR: **671**
- Blocked (permission/other): **0**
- Retained: 66 `auto/*` branches (<30d old, no open PR) — not in scope of this pass.

## Recovery
Full tip-SHA capture + per-branch `git push origin <sha>:refs/heads/<branch>` restore commands were recorded before deletion (capture-before-destroy). cast-explain 261: `cast-explain-branch-deletion-manifest.tsv`; full 942: `cast-explain-full-delete-recovery-manifest.tsv`.

## Note (not actioned this pass)
244 of the 261 cast-explain branches were MERGED into `main` — the forbidden ratio-metric code is present in `main`. That is a code-revert decision, tracked separately from this branch-hygiene pass. This run-log commit is the ONLY change to `main`; no source code was modified.
