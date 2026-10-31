# CI/Release report (prepare) — cycle 0018 — F-016: User and operator documentation

## Inputs read
- `factory/runs/cycle-0018/02-architect.md`
- `docs/architecture/ADR-0001-tech-stack.md`
- `scripts/ci.sh`
- `VERSION` (`0.13.0`), `CHANGELOG.md`

## Work done
- Task C1: Added `node backend/tools/check-docs.mjs` after `bash scripts/check-lf.sh` in `scripts/ci.sh`, preserving LF-only line endings.
- Task C2: Kept `scripts/check-lf.sh` and `.gitattributes` unchanged per ADR-0017.
- Ran CI quality gate checks (`npm run lint`, `npm run typecheck`, `npm test`, JSON metadata check, LF check, `node backend/tools/check-docs.mjs`, `.github/workflows/ci.yml` check): all passed.
- Bumped `VERSION` from `0.13.0` to `0.14.0` (`feature` -> minor while major is 0).
- Added `## [0.14.0] - 2026-10-31` section to `CHANGELOG.md` referencing `F-016`.
- Planned version: `v0.14.0`, planned tag: `v0.14.0`.

## Files changed
- `scripts/ci.sh`
- `VERSION`
- `CHANGELOG.md`
- `factory/runs/cycle-0018/08-release-prepare.md`

## Verification
- `npm run lint` (`check-fr11.mjs`) -> `check-fr11: PASS`
- `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) -> 0 errors
- `node --test test/tools/check-docs.test.ts` -> 19 tests (18 pass, 0 fail, 1 skipped)
- `scripts/check-lf.sh` check -> `check-lf: PASS` (`scripts/ci.sh` and `scripts/check-lf.sh` strictly LF-only)
- `node backend/tools/check-docs.mjs` -> `check-docs: PASS (33 markdown files checked)` (exit 0)

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Per caller instructions, changes are left uncommitted in the working tree for the orchestrator to commit.

## Follow-ups for the backlog
- None

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0018/08-release-prepare.md
summary: Wired check-docs.mjs into scripts/ci.sh, verified CI and check-docs PASS, bumped version to v0.14.0.
