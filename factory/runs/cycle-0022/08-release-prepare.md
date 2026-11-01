# CI/Release report (prepare) — cycle 0022 — F-020: Installer smoke test network pre-flight

## Inputs read
- VERSION, CHANGELOG.md, scripts/ci.sh, run folder reports

## Work done
- Ran the gate; bumped VERSION 0.14.2 -> 0.15.0 (feature -> minor); added CHANGELOG [0.15.0] with upgrade note.
- Planned tag: v0.15.0. PR mode local (no push).

## Files changed
- `VERSION` — 0.15.0
- `CHANGELOG.md` — new section
- `factory/runs/cycle-0022/08-release-prepare.md` — this report

## Verification
- `bash scripts/ci.sh` -> exit 0 (639 tests, 629 pass, 0 fail, 10 skipped; check-lf PASS; check-docs PASS, 35 files)

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Date 2026-11-01 used for the changelog entry.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0022/08-release-prepare.md
summary: CI green; version bumped to v0.15.0
