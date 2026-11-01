# Technical Writer report — cycle 0019 — T-013: Bind cache to the settings that produced it

## Inputs read
- Diff, plugin source log constants, existing docs, contract 0.8.0 / ADR-0018 as summarised in the task.

## Work done
- Documented the cache envelope, five-field binding, cache-outdated/cache-mismatch/cache-skipped, no cache use when settings are missing.

## Files changed
- `docs/user-guide.md` — startup step, Cache section, log table
- `docs/troubleshooting.md` — entries for the three codes and what to do
- `docs/api.md` — hook order steps, cache envelope example, contract 0.8.0 + ADR-0018 citation
- `docs/platform-runbook.md` — fallback applies only to same settings
- `README.md` — cache used only for same settings

## Verification
- `node backend/tools/check-docs.mjs` -> PASS (34 files)

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- docs/engineer-setup.md has no cache mention; left unchanged.

## Follow-ups for the backlog
- none

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0019/07-docs.md
summary: T-013 docs updated; check-docs passes
