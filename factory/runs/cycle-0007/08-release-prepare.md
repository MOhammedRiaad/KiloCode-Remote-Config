# CI/Release report (prepare) — cycle 0007 — F-005: Plugin: Azure DevOps fetch and authentication

## Inputs read
- `VERSION`, `CHANGELOG.md`, `docs/api.md`, `docs/architecture/contracts/plugin-interface.md`, ADR-0007.

## Work done
- Ran `bash scripts/ci.sh`: PASS (229 tests, 228 pass, 0 fail, 1 skipped; check-lf PASS).
- Bumped VERSION 0.4.0 -> 0.5.0 (feature -> minor).
- Added CHANGELOG `[0.5.0] - 2026-10-31` section referencing F-005.
- Fixed stale "Authoritative contract" line in `docs/api.md` (v0.5.0 -> v0.6.0, added ADR-0007 reference).
- Planned version: 0.5.0. Planned tag: v0.5.0. PR mode: local.

## Files changed
- `VERSION`, `CHANGELOG.md`, `docs/api.md`, this report.

## Verification
- `bash scripts/ci.sh` -> exit 0 (run before the doc/version edits, which touch no code).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Also added the ADR-0007 reference to the api.md line, since the contract 0.6.0 is defined by it.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0007/08-release-prepare.md
summary: CI green, v0.5.0 prepared
