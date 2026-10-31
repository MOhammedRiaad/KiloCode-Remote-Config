# Docs report — cycle 0016 — F-014: End-to-end simulated startup test

## Inputs read
- docs/architecture/contracts/e2e-harness.md, backend/test/e2e/*, README.md, docs/development.md, docs/user-guide.md, factory/VISION.md (AC table)

## Work done
- Documented the e2e suite in development.md: coverage, run command, bash requirement and skip message, result-to-file, simulator guard, how to add a scenario.
- Added a "What stays manual (Phase 0)" section (real Kilo /models and VS Code list, Kilo's own .ts plugin loading and path resolution, disabled key at request time) for F-016.
- README and user guide state the simulation does not prove vision AC-1. No real system is claimed tested.

## Files changed
- `README.md`, `docs/development.md`, `docs/user-guide.md`

## Verification
- Commands documented checked against backend/test/e2e files (path, KILO_TEST_BASH, skip message, guard). docs/api.md unchanged: no API change.

## Findings / issues
None.

## Assumptions made (no human available)
- Did not run the suite; documented from the contract and test source.

## Follow-ups for the backlog
- F-016 runbook should include the manual Phase 0 checks.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0016/07-docs.md
summary: e2e suite documented; AC-1 manual Phase 0 remainder called out
