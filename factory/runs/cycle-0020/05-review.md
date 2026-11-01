# Code Review report — cycle 0020 — T-019: Installer hardening: CDPATH-safe helper lookup, symlink re-check, Node version test fix

## Inputs read
- `git diff main...HEAD` (working tree clean), branch `factory/T-019-installer-hardening-cdpath-safe-helper-l`
- `factory/runs/cycle-0020/01-product-owner.md` (6 ACs), `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/contracts/installer-cli.md` 1.2.1 (diff), `docs/architecture/ADR-0012-posix-bootstrap-installer.md` (diff)
- `backend/installer/install.sh`, `install-helper.ts`, `fs-guard.ts`
- `backend/test/installer/install-sh.test.ts`, `fs-guard.test.ts`, `helpers.ts`, `fixtures/race-after-mkdir.ts`

## Work done
- Ran the full gate myself, then checked each AC against code and a test that can fail.
- **AC-1 (CDPATH)**: `install.sh:139` uses `CDPATH= cd -- "$script_dir" 2>/dev/null && pwd`. The test runs `installer/install.sh` from `cwd=backendRoot`, with CDPATH pointing at a decoy that has an `installer/install-helper.ts` printing `DECOY`. Under the old code bash `cd installer` resolves through CDPATH, prints the directory, and the multi-line `script_dir` breaks the hand-off, so the test is red on old code (BE confirmed it). The asserts check exit 0, no `DECOY` or `decoy` on stdout, the real plugin bytes, and that kilo.jsonc exists. The test is valid on Linux too: `msysPath` returns the path unchanged there.
- **AC-2 (missing helper)**: the message matches contract section 3 step 4 and section 7 exactly, with exit 3. The test copies install.sh alone and asserts stderr `===` the message plus `\n`, empty stdout, no `install-helper` in the node.log stub (the prerequisite `node -p` call is logged but does not match), `noStack`, and an empty `$HOME` snapshot. bash 3.2: the assignment's status is the command substitution's status, `! a || b` is `(! a) || b`, and a failure inside `if` does not trigger `set -e`. No external commands are added, so the AC-8 regex test still passes.
- **AC-3 (re-check)**: `applyPlan` (install-helper.ts:345-352) runs `mkdirSync`, then `firstUnsafeTarget(configDir, azdoDir, plugin, kilo.jsonc)`, then `refuse()` (exit 3, contract wording). Only after that come `stripGroupOtherWrite`, writes, backups and `restrictConfigMode`. The order matches contract section 6. All POSIX mode changes go through `adjustMode`: `O_NOFOLLOW` (+`O_DIRECTORY` for dirs, +`O_NONBLOCK` for the file), an `fstat` type check, and `fchmod` on the same fd, with `closeSync` in a `finally`. `ELOOP`/`ENOTDIR` map to `refuse`. Temp files and backups use `writeNew`: `openSync(path,"wx",mode)`, then `writeFileSync(fd)`, then `fchmodSync(fd)`, then close. `writeAtomic` still removes the temp file on error. `writeBackup` still retries on EEXIST. No `chmodSync` or `lstatSync` is left in the helper.
  - The 5 POSIX tests skip on this Windows host. The skip message is clear and skips only on `isWindows`, so it cannot hide a Linux failure. I traced each one against the Linux semantics:
    - Planning-time configDir link: `checkedDir(configDir)` in `buildPlan` refuses with stderr equal to `refusal(configDir)`. The azdo link (configDir real) is caught by `checkedDir(azdoDir)`. Both check the decoy mode (0777) and listing.
    - Race (a) configDir: the fixture fires after the real `mkdir(configDir/azdo)`, renames configDir to `.orig` and links it to the decoy dir. The re-check's first target fails, giving `refuse(configDir)`. On old code `chmodSync` follows the link (0777 -> 0755) and then ENOENT gives a generic message, so the test is red.
    - Race (b) azdo: gives `refuse(azdoDir)`. `swap` equals `plan.azdoDir`: both are `join(home,".config","kilo","azdo")`, `HOME` is passed and `XDG_CONFIG_HOME` is unset. Old code chmods the decoy, so red.
    - Race (c) fresh kilo.jsonc: the plugin is absent (optional), so the result is `refuse(configPath)`. Old code exits 0, so red.
    - Race (d) unchanged kilo.jsonc: the first run uses the same env as the existing "AC-6 running twice changes nothing" test, so the second run plans `configText === null`. The re-check refuses before the no-change chmod. Old code `chmodSync(configPath, 0600)` follows the link (decoy 0644 -> 0600), so red.
    - In every race case, warnings are printed only after `applyPlan` succeeds, so the exact-stderr asserts hold.
  - I confirmed on this host (Node 24.15) that an `--import` preload calling `syncBuiltinESMExports()` makes a `.ts` module's named `import { mkdirSync } from "node:fs"` use the wrapper. This was the main uncertainty in the race fixture.
  - `fs-guard.test.ts` runs on every platform (8 tests). It covers all-fine, link-like, first failure wins, missing required, missing optional, wrong file type, EACCES propagation, and a real `lstatOrNull` on a missing path.
- **AC-4**: the vacuous `--help` test is replaced. 22.17.1 gives exit 1, the exact message and an empty `$HOME`. 22.18.0 and 23.0.1 run with REQUIRED_ARGS plus a PAT and give exit 0, no version error, and kilo.jsonc written. This now goes through the version check at install.sh:96-113. Nothing was weakened: the new tests are strictly stronger than the old one.
- **AC-5**: `sk-bf-` + `FAKE_SECRET`. The test checks that neither the key, `FAKE_SECRET` nor `SECRET_TAIL` appears in stdout or stderr, that no prefix warning is printed, and that the apiKey stored in kilo.jsonc equals the key.
- **AC-6**: ci.sh passes. The contract documents the exit-3 message and the re-check. The existing installer tests are all present (AC-7 symlinked kilo.jsonc, AC-8 LF / `bash -n` / no external commands), and the install.ps1 tests (pwsh) passed.
- **Test hygiene**: everything runs in a per-test `mkdtemp` sandbox that is removed in a `finally`. The CDPATH test only reads `backendRoot`. The race fixture is inert unless `KILO_TEST_RACE` is set and lives only under `test/`. `KILO_TEST_RACE` was added to `MSYS2_ENV_CONV_EXCL`. The helper changes (`cwd`, `script`, `preload`, `stubNode` `log`) are optional and backward compatible.
- **Lanes and lint**: the backend engineer changed only `backend/`. `install.ps1`, `backend/plugin/` and `frontend/` are not in the diff. Grep finds no `KILO_TEST_` or `NODE_OPTIONS` in `backend/installer/`, and `fs-guard.ts` imports only `node:fs` (check-fr11 PASS).

## Files changed
- `factory/runs/cycle-0020/05-review.md` — this report.

## Verification
- `bash scripts/ci.sh` -> exit 0 (`ci: PASS`). check-fr11 PASS, typecheck OK, tests 624 / pass 614 / fail 0 / skipped 10, check-lf PASS, check-docs PASS (34 files).
- The T-019 tests that ran and passed here: 8 fs-guard tests, AC-1, AC-2, AC-4 (both tests), AC-5. Skipped (win32): the 5 AC-3 symlink/race tests, each with the message "symlink tests need POSIX symlinks; fs-guard unit tests cover Windows".
- I confirmed the `syncBuiltinESMExports` live-binding behaviour with a scratch preload and a `.ts` entry on Node v24.15.0 (`WRAPPED ./x/y`).
- Not run here: the 5 POSIX tests. My reading of them is above. `.github/workflows` runs `bash scripts/ci.sh` on `ubuntu-latest`, so they will run there.

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | low | backend | backend/test/installer/install-sh.test.ts:519-541 (RACES) / install-helper.ts:151-172 | The race fixture fires right after `mkdir`, so the lstat re-check always refuses first. No test reaches the `adjustMode` refusal branches (ELOOP/ENOTDIR/wrong type) or the `restrictConfigMode` no-change path against a link. Case (d) "unchanged kilo.jsonc" therefore proves the re-check, not the O_NOFOLLOW chmod. This is the same as security finding 2. AC-3 is still met by the re-check itself. | Follow-up, not blocking: add a trigger on the first `O_NOFOLLOW` `openSync` of the target (or after the re-check) to exercise the fd-level refusal on Linux. |
| 2 | info | backend (CI phase confirms) | install-sh.test.ts:499-556 | The 5 POSIX AC-3 tests have never executed: this host is Windows and has no Linux runtime. My review found them correct for Linux. | The CI/Release phase must confirm they show as passed, not skipped, on `ubuntu-latest`. |
| 3 | info | backend | install-sh.test.ts:496-499 | `posixOnly` repeats the existing `skipOnWindows` (line 44) with only a different message. | Optional: parametrise the skip message in one helper. |
| 4 | info | backend | install-helper.ts:109-119 vs fs-guard.ts:28-38 | The planning-time `checkedFile`/`checkedDir` and `firstUnsafeTarget` express the same type rule twice. | Optional: build the planning checks on fs-guard. |
| 5 | info | architect (docs) | docs/architecture/ADR-0012-posix-bootstrap-installer.md (section 6) | The ADR calls the guard `checkTargets`, but the code exports `firstUnsafeTarget`. The residual-risk wording also leaves out the swap after the re-check (security findings 1 and 3). | Doc fix in a later cycle. |

No correctness bug, contract mismatch, missing AC coverage or weakened test was found.

## Assumptions made (no human available)
- I judged the POSIX-only tests correct by tracing them against Linux syscall semantics and the code, plus the live-binding check. Linux CI is the final confirmation.

## Follow-ups for the backlog
- A post-re-check race trigger that covers the `adjustMode`/`fchmod` refusal branches and rename-over-link (finding 1).
- Merge `skipOnWindows`/`posixOnly`, and reuse fs-guard in the planning checks (findings 3 and 4).
- ADR-0012 naming and residual-risk wording (finding 5).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0020/05-review.md
summary: T-019 PASS - ci.sh exit 0 (624/614 pass/0 fail/10 skip); all 6 ACs implemented and tested; contract message/exit 3 and re-check ordering match; 5 POSIX race tests traced correct but must be confirmed on ubuntu CI; 1 low + 4 info follow-ups
