# CI/Release (ship) report — cycle 0005 — F-003: Plugin: in-place merge with defaults/enforce modes

## Inputs read
- 08-release.md, VERSION (0.3.0), CHANGELOG.md

## Work done
- Re-ran `bash scripts/ci.sh` on the branch: PASS (94 tests, 93 pass, 1 skipped, 0 fail).
- Local mode: squash-merged branch into main, committed, tagged v0.3.0, deleted branch.

## Files changed
- `factory/runs/cycle-0005/09-ci-ship.md` — this report

## Verification
- `bash scripts/ci.sh` → exit 0

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- No remote; nothing pushed, no GitHub release created (release: local).

## Follow-ups for the backlog
- none

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0005/09-ci-ship.md
summary: F-003 squash-merged to main, tagged v0.3.0 locally
