# CI/Release report (prepare) — cycle 0020 — T-019: Installer hardening

## Inputs read
- VERSION, CHANGELOG.md, .github/workflows/ci.yml, scripts/ci.sh output

## Work done
- Ran `bash scripts/ci.sh` (incl. check-lf and check-docs): PASS. Tests: 624 total, 614 pass, 0 fail, 10 skipped.
- Bumped VERSION 0.14.1 -> 0.14.2 (non-feature, patch). Planned tag: v0.14.2 (local mode, no push).
- Added CHANGELOG [0.14.2] section for T-019, with explicit NOTE that the 5 POSIX symlink/race tests were skipped on the Windows dev host and must be confirmed passing on Linux CI.

## Files changed
- `VERSION` — 0.14.2
- `CHANGELOG.md` — [0.14.2] section

## Verification
- `bash scripts/ci.sh` -> exit 0 (run before and after the edits).
- CI workflow check (report only, unchanged): `.github/workflows/ci.yml` job `quality-gate` runs on `ubuntu-latest`, Node 22, and calls `bash scripts/ci.sh`, so POSIX-only installer tests will execute there (on pull_request/push to main). Caveat: in local PR mode there is no PR, so CI only runs after the change reaches main. Not verified which of the 10 skips are the 5 POSIX ones.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | CI | 5 POSIX tests unverified on this host | Confirm green on Linux CI after merge |

## Assumptions made (no human available)
- Changelog categories chosen (Security/Changed/Notes) from the task description.

## Follow-ups for the backlog
- Confirm Linux CI result for the 5 POSIX installer tests.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0020/08-release-prepare.md
summary: Gate green; VERSION 0.14.2 and changelog prepared
