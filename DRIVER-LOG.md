# ch1tty goal-driver board (fallback — Notion auth 401)

Notion MCP is connected (22 tools) but all write calls return 401. This file
is the cross-run state board until the Notion integration token is rotated.

**To fix Notion:** rotate the integration token in workspace Settings → Connections
→ ch1tty integration, or run `chitty-mcp-token notion` via 1Password.

---

## Workstream checklist

- [x] **A** — Gateway up/refreshed/tested: build clean + tests green + 5 meta-tools confirmed
- [x] **B** — GitHub MCP migration: `servers.json` github entry migrated to hosted remote endpoint
- [x] **C** — Focus-profile layer: `CH1TTY_FOCUS` env var + per-call `focus` param on search/cast; `focus-profiles.json` data-driven; status reports active focus
- [x] **D** — Scenario testing + simulation: harness in `test/scenario/` driving cast + search/execute across backends with realistic multi-step scenarios per focus
- [ ] **E** — Alchemist brainstorm: **IN PROGRESS** — 300 combos / 207 verified across 6 focus profiles (36th pass, PR #227); catalog at `focus-suggestions.json`

---

## Open PRs (merge in order)

| PR | Title | Base | Status |
|----|-------|------|--------|
| #224 | chore(driver): add DRIVER-LOG.md fallback board | main | open |
| #225 | feat(catalog): thirty-fourth-pass — 276 combos, 185 verified | main | open |
| #226 | feat(catalog): thirty-fifth-pass — 288 combos, 195 verified | auto/E-catalog-thirty-fifth-pass | open |
| #227 | feat(catalog): thirty-sixth-pass — 300 combos, 207 verified | auto/E-catalog-thirty-fifth-pass | open |

---

## Blockers

| Blocker | Command to fix |
|---------|---------------|
| Notion auth 401 | `chitty-mcp-token notion` (1Password) or rotate token in Notion workspace → Settings → Connections |
| CI runner never starts | Persistent remote environment infra issue — local `npm test` is the validation source of truth |

---

## Run log

### 2026-06-06 (this run)
- **Workstream**: E (Alchemist brainstorm) — 36th catalog pass
- **Branch/PR**: `auto/E-catalog-thirty-sixth-pass` → PR #227
- **Build**: clean (`npm run build` → 0 errors)
- **Tests**: 938 pass / 0 fail / 2 skipped (after fixing `wrangler-audit-agents-sdk-deploy` to include `notion/API-post-page` for code-profile relevance test)
- **Catalog**: 288 → **300 combos**, 195 → **207 verified** (+12 combos, +12 verified)
- **New coverage**: 5 skills with zero prior catalog entries now documented:
  `migration:claude-opus-migration`, `pr-review:review-pr`, `commit-commands:commit-push-pr`,
  `chittyos-devops:wrangler-audit`, `chittyos-devops:branch-cleanup`
- **Live gateway**: 28 agents / 15 bound / 81 tools / 8 servers connected; all skill chains
  confirmed via `orchestrator/skill_execute` returning `action: local_invoke`
- **Bot comments on PR #227**: Codex usage-limit (no action needed) + CodeRabbit skipped
  (expected — base is not main for stacked PR)
- **Notion**: still 401 — board written here instead
- **Next run**: 37th catalog pass — target `notes` agent (6 tools, unbound, Apple Notes RAG)
  when it binds; `ship` agent (8 tools, unbound); `wrangler-audit` + `compliance` + `canon`
  governance cert chain; merge queued PRs (#224 → #225 → #226 → #227) to clear the stack
