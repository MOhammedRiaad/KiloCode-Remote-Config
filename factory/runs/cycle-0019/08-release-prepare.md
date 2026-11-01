# CI/Release report (prepare) — cycle 0019 — T-013: Bind cache to the settings that produced it

## Inputs read
- VERSION (0.14.0), CHANGELOG.md, scripts/ci.sh, task prompt

## Work done
- Ran `bash scripts/ci.sh` (includes check-lf and check-docs): PASS. Tests: 607, pass 602, fail 0, skipped 5. check-docs: 34 files.
- Bumped VERSION 0.14.0 -> 0.14.1 (security item, patch while 0.x).
- Added CHANGELOG [0.14.1] section (Security, Changed) with behaviour change, upgrade note, new codes, contract 0.8.0.

## Files changed
- `VERSION` — 0.14.1
- `CHANGELOG.md` — new [0.14.1] section
- `factory/runs/cycle-0019/08-release-prepare.md` — this report

## Verification
- `bash scripts/ci.sh` -> exit 0, "ci: PASS"

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Planned tag v0.14.1; local mode, no push.

## Follow-ups for the backlog
- None

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0019/08-release-prepare.md
summary: CI green; prepared v0.14.1 for T-013
