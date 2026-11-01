# CI/Release report (prepare) — cycle 0023 — F-021: Plugin firewall/network classification

## Inputs read
- VERSION, CHANGELOG.md, factory/templates/report.md

## Work done
- Ran `bash scripts/ci.sh` (includes check-lf and check-docs).
- Bumped VERSION 0.15.0 -> 0.16.0 (feature -> minor).
- Added CHANGELOG [0.16.0] with F-021, F-022 and a BEHAVIOUR CHANGE note.

## Files changed
- `VERSION`, `CHANGELOG.md`, this report.

## Verification
- `bash scripts/ci.sh` -> exit 0; 690 tests, 680 pass, 0 fail, 10 skipped; check-lf PASS; check-docs PASS (36 files).
- Planned version v0.16.0, planned tag v0.16.0. PR mode local.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Date 2026-11-01 used, matching prior entries.

## Follow-ups for the backlog
- none

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0023/08-release-prepare.md
summary: CI green, v0.16.0 prepared
