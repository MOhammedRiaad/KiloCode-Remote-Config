# Security report (Re-check 3) — cycle 0027 — T-038: plugin JSDoc trim pass and wording fixes

## Inputs read
- `git show HEAD` (1bdf619, rework 3 delta) and `git diff main...HEAD --stat`
- `factory/runs/cycle-0027/03-backend-rework3.md`, previous `04-security*.md`
- `backend/test/installer/ps-helpers.ts` (`isAllowedNodeArgv`, `stubNodePs`), `install-ps1.test.ts` (AC-7 block), `install-ps1-smoke.test.ts` (`assertClean`)

## Work done
- Reviewed the test-only delta. `isAllowedNodeArgv(line)` returns true only for
  `-p process.versions.node` or an exact (case-insensitive) match of the helper path; on Windows
  the expected form is `"<helperPath>"` (cmd `%*` keeps quotes), on POSIX the bare `<helperPath>`
  (`"$*"` in the sh stub drops quotes). Still exactly two permitted invocations; the comparison is
  whole-line equality, so any extra argument (e.g. a key or PAT on argv) still fails the check.
  Windows behaviour is byte-identical to the previous inline predicate.
- Both call sites (`assertClean` in the smoke test, AC-7 test in `install-ps1.test.ts`) now call
  the shared helper; no other assertion changed. `noSecrets(...)`, the config-file PAT check, the
  `az.log` deepEqual, the usage-error and control-character tests are untouched.
- Secrets grep on the HEAD diff: no keys/tokens/passwords added (the fake `KEY` constant is
  pre-existing test data).
- Untracked root `kilo.jsonc`: present on disk, `git ls-files` does not know it, not in the commit.
- No product code changed in this delta.

## Files changed
- `factory/runs/cycle-0027/04-security-rerun3.md` — this report

## Verification
- `npm run lint` (backend) -> check-fr11: PASS
- `npm run typecheck` -> exit 0
- `npm test` -> 726 tests, 716 pass, 0 fail, 10 skipped (Windows host; the POSIX branch of `isAllowedNodeArgv` is exercised only on the Linux CI runner)
- `npm audit --omit=dev --audit-level=high` -> found 0 vulnerabilities

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/test/installer/ps-helpers.ts:218-220 | On POSIX `"$*"` flattens argv, so `node "<p>"` and `node <p split on spaces>` log identically. Not a weakening: helperPath is fixed, and a secret in argv would still change the line and fail equality. | None. |

## Assumptions made (no human available)
- POSIX branch correctness is taken from the stub source (`printf '%s\n' "$*"`) and the rework-3 report of the Linux CI failure; it cannot run on this Windows host.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/04-security-rerun3.md
summary: Rework 3 is test-only; node argv allow-list still exactly two exact-match invocations, secret assertions unchanged, no secrets added, kilo.jsonc untracked; lint/typecheck/tests/audit clean.
