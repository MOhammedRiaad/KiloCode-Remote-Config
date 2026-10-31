# CI/Release report (prepare) — cycle 0015 — F-008: Shared config repo: Azure Pipelines PR gate and branch policy setup

## Inputs read
- VERSION, CHANGELOG.md, scripts/ci.sh

## Work done
- Ran `bash scripts/ci.sh`: PASS (548 tests, 543 pass, 0 fail, 5 skipped; check-lf PASS).
- Bumped VERSION 0.11.0 -> 0.12.0 (feature -> minor). Planned tag: v0.12.0. PR mode: local.
- Added CHANGELOG [0.12.0] section.

## Files changed
- `VERSION` — 0.12.0
- `CHANGELOG.md` — release notes for F-008

## Verification
- `bash scripts/ci.sh` -> ci: PASS

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Release date taken from the system date (2026-10-31).

## Follow-ups for the backlog
- none

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0015/08-release-prepare.md
summary: CI green, v0.12.0 prepared
