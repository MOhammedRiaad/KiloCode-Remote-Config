# Code Review report (Re-review 3) — cycle 0027 — T-038: plugin JSDoc trim pass and wording fixes

## Inputs read
- HEAD commit 1bdf619 (`git show HEAD`), `factory/runs/cycle-0027/03-backend-rework3.md`, `05-review-rerun2.md`
- `backend/test/installer/ps-helpers.ts` (stub shims `stubNodePs` lines 96-109, new `isAllowedNodeArgv` lines 214-221)
- `backend/test/installer/install-ps1.test.ts` (AC-7 test, lines 498-527), `install-ps1-smoke.test.ts` (`assertClean`)
- `backend/installer/install.ps1` (`Invoke-Probe` line 73, `Invoke-Helper` lines 133-153), `backend/tsconfig.json`

## Work done
- Checked the root cause against the shims and the product code:
  - `Invoke-Helper` sets `ProcessStartInfo.Arguments = '"' + $helper + '"'`.
  - On Windows the `node.cmd` stub logs `echo(%*`. cmd keeps the raw command tail, quotes included, so the log line is `"<helperPath>"`.
  - On POSIX, .NET splits `Arguments` into argv and drops the quotes. The `/bin/sh` stub then logs `printf '%s\n' "$*"`, which writes the bare path. A path that contains spaces is still one argv element, so `$*` gives the path unchanged.
  - The old comparison expected quotes on every platform, so it could never match on Linux. The new helper picks the quoted form on Windows and the bare form on POSIX, which is correct on both.
  - The probe line `-p process.versions.node` is the same on both shims (`Invoke-Probe` passes two separate args, `$*` joins them with a space, and `%*` keeps the raw tail).
- Checked for weakening: the allow-list is still exactly 2 entries. The Windows branch behaves as before. No `skip`, `todo` or disabled test was added. `assert.ok(lines.length >= 2)` and every per-line assertion are still in place.
- Checked for dead imports: `helperPath` is no longer imported by either test file, and `noUnusedLocals` is on, so `tsc` in CI would catch any leftover. `helperPath` is still used inside `ps-helpers.ts`, so it is not dead.
- Minimality: 3 test files, +9/-7 lines, test-only, all under `backend/`. No product code was touched.

## Files changed
- `factory/runs/cycle-0027/05-review-rerun3.md` — this report

## Verification
- `bash scripts/ci.sh` → exit 0 (`ci: PASS`; 726 tests: 716 pass, 0 fail, 10 skipped; check-lf PASS; check-docs PASS).
- Correction to the brief: on this Windows host the `[pwsh]` tests did not skip. pwsh 7 (`C:\Program Files\PowerShell\7\pwsh.exe`) and Windows PowerShell 5.1 are both installed, and 56 `[pwsh]`/`[powershell5]` tests ran and passed. That includes the AC-7 argv test and the smoke `assertClean` checks. So the Windows (quoted) branch has been run and passes.
- The POSIX (bare) branch could not be run here. WSL only has the `docker-desktop` distro, and the Docker engine is not running (`dockerDesktopLinuxEngine` pipe missing). The Linux behaviour was judged by reading the code only, as above. The next Linux CI run on the PR should confirm the 7 previously failing `[pwsh]` tests now pass.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/test/installer/install-ps1.test.ts:504 | `const isAllowed = isAllowedNodeArgv;` is a redundant alias (owner: backend). | Optional: call `isAllowedNodeArgv` directly. |
| 2 | info | backend/test/installer/ps-helpers.ts:220 | `toLowerCase()` comparison is also applied on POSIX, where paths are case-sensitive; slightly looser than needed but cannot admit a secret (owner: backend). | Optional: compare case-insensitively on Windows only. |

No blocking findings.

## Assumptions made (no human available)
- Linux behaviour of the `/bin/sh` stub and the .NET `ProcessStartInfo.Arguments` parsing was judged by reading the code, because no Linux runtime is available on this host.

## Follow-ups for the backlog
- Tidy the 2 info nits above.
- Optionally add a Linux job (ubuntu + pwsh) to the PR checks if one does not already exist, so the POSIX stub path is exercised before merge.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/05-review-rerun3.md
summary: Rework 3 is a minimal test-only fix that is correct on both platforms (quoted on Windows, bare on POSIX), nothing weakened or skipped, no dead imports; ci.sh exit 0.
