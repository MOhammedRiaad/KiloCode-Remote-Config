# Backend report - cycle 0020 - T-019 installer hardening

## Work done
- BE-1 `backend/installer/install.sh`: `script_dir=$(CDPATH= cd -- "$script_dir" 2>/dev/null && pwd)` plus `[ -f "$script_dir/install-helper.ts" ]`; otherwise the exact one-line message and exit 3, before any node call.
- BE-2 new `backend/installer/fs-guard.ts` (imports only `node:fs`): `lstatOrNull`, `firstUnsafeTarget(targets, lstat)`, types.
- BE-3 `backend/installer/install-helper.ts`: after `mkdirSync`, `firstUnsafeTarget` over configDir, azdoDir, plugin, kilo.jsonc, then `refuse()` (exit 3) before any chmod/temp/backup/rename. All mode changes are fd-based: `adjustMode` opens with `O_NOFOLLOW` (+`O_DIRECTORY` for dirs, +`O_NONBLOCK` for files), checks `fstat`, then `fchmod`. Temp files and backups use `writeNew` (`wx` open + `fchmodSync` on the same fd). No `chmodSync` or `lstatSync` remains in the helper.
- BE-4 `test/installer/helpers.ts`: `RunInstallOptions.cwd/script/preload`, `stubNode(..., {log})`, `raceFixtureUrl`; `KILO_TEST_RACE` added to `MSYS2_ENV_CONV_EXCL`.
- BE-5 `test/installer/fixtures/race-after-mkdir.ts`: test-only preload wrapping `fs.mkdirSync` + `syncBuiltinESMExports()`.
- BE-6 tests in `test/installer/install-sh.test.ts`; BE-7 `test/installer/fs-guard.test.ts` (8 tests, all platforms).
- Files normalised to LF on touch (install-helper.ts, helpers.ts, install-sh.test.ts were CRLF in the working copy only; the index was already LF).

## Acceptance criteria -> tests
| AC | Test |
|----|------|
| AC-1 CDPATH | `T-019 AC-1 a CDPATH look-alike directory does not hijack the helper lookup` (MSYS `/c/...` CDPATH form on Windows) |
| AC-2 missing helper | `T-019 AC-2 a missing install-helper.ts exits 3 with the fixed message` |
| AC-3 symlinks | `T-019 AC-3 a symlinked configDir or azdo dir found while planning...`, four race tests (configDir, azdo dir, fresh kilo.jsonc, unchanged kilo.jsonc) - POSIX only; plus `fs-guard.test.ts` (7 injected-lstat tests + real `lstatOrNull`) which run everywhere |
| AC-4 Node version | `T-019 AC-4 Node 22.17.1 is refused...`, `T-019 AC-4 Node 22.18 and newer pass ... and install` (replaces the old `--help` test) |
| AC-5 sk-bf- key | `T-019 AC-5 an sk-bf- key is accepted silently and never echoed` |
| AC-6 gate/rules | `bash scripts/ci.sh` (check-fr11 rules 6/7 pass; existing AC-8 LF / bash -n / no-external-commands tests unchanged and pass) |

## Red-before-green (old code)
Checked against the original `install.sh` on this Windows host: AC-1 CDPATH and AC-2 missing-helper tests FAIL on old code and pass on new. The AC-4 22.17.1 test passes on old code too (old behaviour was already correct; the weakness was the old positive test that never reached the check, now replaced). The old-helper red check for the race tests (a), (b), (d) was NOT possible here: symlink tests are skipped on Windows, so they were never executed on this host. They, the race preload fixture, and the O_NOFOLLOW / fchmod behaviour are Linux-only and UNVERIFIED here; the Windows host relies on the injected-lstat unit tests in `fs-guard.test.ts`. They must be confirmed on Linux CI.

## Verification
- `bash scripts/ci.sh` -> exit 0 (lint incl. check-fr11 PASS, tsc typecheck, node tests, check-lf PASS, check-docs PASS 34 files).
- `node --test test/installer/install-sh.test.ts test/installer/fs-guard.test.ts` in `backend/`: all non-symlink tests pass; the 5 symlink/race tests are reported as skipped on Windows.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | race-after-mkdir.ts | Preload relies on `syncBuiltinESMExports`; unverified on Linux | Confirm on Linux CI; if it fails, keep planning-time tests + unit tests and record it |

## Assumptions made (no human available)
- The AC-2 test converts the script path with `msysPath` on Windows so Git Bash can run the copied script.
- Contract/docs not changed (read-only for me); no contract discrepancy found.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0020/03-backend.md
summary: T-019 implemented; ci.sh exit 0; symlink/race tests Linux-only and unverified on this Windows host
