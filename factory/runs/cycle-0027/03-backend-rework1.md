# Backend report (rework 1) — cycle 0027 — T-038: plugin JSDoc trim

## Inputs read
- factory/runs/cycle-0027/05-review.md, 04-security.md (findings 1-3), backend/plugin/azdo-remote-config.ts

## Work done
Comment-only edits in backend/plugin/azdo-remote-config.ts, each checked against current code:
1. runConfigHook: claim narrowed to "no secret, PAT, token, Azure DevOps URL or host, or resolved config value"; says L-UNRESOLVED names are copied as written (sanitised, shortened) from the shared config and may contain paths or hosts, never their values.
2. resolvePlaceholders: `@param deps` states the default readFile is the guarded reader; the 1 MiB / regular-file rule is attributed to the default reader.
3. executeHook Logs: "then L-UNRESOLVED (if any) and L-APPLIED or LOG_MERGE (L-MERGE)".
Optional follow-ups (:1166, :423, :1550) not done: no line budget (file is 1838 of 1839).

## Files changed
- `backend/plugin/azdo-remote-config.ts` — comments only

## Verification
- compare-plugin-shape --base-ref v0.16.2: PASS (195 declarations, 10 exports, 6 internals keys, 200 statements identical)
- wc -l: 1838; longest comment line: 110; no non-ASCII found
- git diff --name-only v0.16.2 -- backend: only backend/plugin/azdo-remote-config.ts
- source-layout.test.ts (unchanged): 8 pass, 0 fail
- lint (check-fr11): PASS; typecheck: clean
- npm test: 724 tests, 714 pass, 0 fail, 10 skipped (pre-existing)
- check-docs: PASS (37 markdown files); `bash scripts/ci.sh`: ci: PASS

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | medium | runConfigHook | log claim too broad | fixed |
| 2 | low | resolvePlaceholders | guarded reader lost | fixed |
| 3 | low | executeHook | Logs list ambiguous | fixed |

## Assumptions made (no human available)
- Optional items skipped for line budget.

## Follow-ups for the backlog
- Optional wording items at :1166, :423, :1550.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/03-backend-rework1.md
summary: Three comment-only fixes applied; shape PASS, 1838 lines, ci PASS
