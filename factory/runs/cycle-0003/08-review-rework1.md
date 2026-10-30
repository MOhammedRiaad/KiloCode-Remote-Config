# Code Review report — cycle 0003 — F-001: Plugin: JSONC parser (Re-review 1)

## Inputs read
- `factory/runs/cycle-0003/05-review.md` (prior FAIL, finding: "unterminated ..." messages lacked "starting")
- `factory/runs/cycle-0003/06-backend-rework1.md`, `07-security-rework1.md` (security re-check PASS)
- `docs/architecture/contracts/plugin-interface.md` v0.2.0 section 2a (lines 70-71)
- Commit `057f95b` diff; `git diff main...HEAD --stat`

## Work done
- Compared the rework against the contract:
  - `backend/plugin/azdo-remote-config.ts:131` now throws `unterminated string starting at line L, column C`, which matches contract line 70.
  - `backend/plugin/azdo-remote-config.ts:136` now throws `unterminated block comment starting at line L, column C`, which matches contract line 71.
- The tests at `backend/test/plugin/jsonc.test.ts` (AC-5 string, AC-5 block comment, CRLF line-count test) now check the exact full message with `assert.equal`. Any change to the wording would make them fail. Nothing was weakened: the `err.cause === undefined` checks and the canary checks are still there.
- Searched `backend/` and `docs/` for the old wording without "starting". None left.
- Lane check: the rework commit touched only `backend/` and the factory run/state files. Nothing outside the lanes was changed.
- BOM nit: `backend/plugin/azdo-remote-config.ts:38` still contains a raw U+FEFF (bytes EF BB BF), which I confirmed with `od`. It does not affect behaviour, and the test "leading BOM is ignored" passes. The only concerns are readability and editor or tool mangling, so it is a low, non-blocking item.

## Files changed
- `factory/runs/cycle-0003/08-review-rework1.md` — this report

## Verification
- `bash scripts/ci.sh` → exit 0 (30 tests pass, 0 fail; check-lf PASS; `ci: PASS`)

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | resolved | backend | backend/plugin/azdo-remote-config.ts:131,136 | Prior medium finding (missing "starting") is fixed and pinned by exact-message tests | none |
| 2 | low (non-blocking) | backend | backend/plugin/azdo-remote-config.ts:38 | `BOM` constant is a raw invisible U+FEFF literal; rework report incorrectly said it was escaped. Behaviour correct (test passes). | Backlog: replace with `"﻿"` escape |

## Assumptions made (no human available)
- AC1-7 coverage was established in 05-review.md. This round changed only the two message strings and their tests, so I did not repeat the full AC re-audit beyond the CI run and the diff review.

## Follow-ups for the backlog
- Replace the raw BOM literal at `backend/plugin/azdo-remote-config.ts:38` with the `"﻿"` escape, and consider adding a check to `scripts/ci.sh` that flags invisible characters in source files.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0003/08-review-rework1.md
summary: Re-review 1 PASS - unterminated-message wording now matches contract v0.2.0 2a with exact-message tests; CI green; raw BOM literal logged as low backlog nit.
