# Security report — cycle 0020 — T-019: Installer hardening: CDPATH-safe helper lookup, symlink re-check, Node version test fix

## Inputs read
- `git diff main...HEAD` (branch `factory/T-019-installer-hardening-cdpath-safe-helper-l`, working tree clean)
- `factory/runs/cycle-0020/02-architect.md`, `03-backend.md`
- `docs/architecture/ADR-0012-posix-bootstrap-installer.md` (amended), `docs/architecture/contracts/installer-cli.md` 1.2.1
- `backend/installer/install.sh`, `install-helper.ts`, `fs-guard.ts`
- `backend/test/installer/fixtures/race-after-mkdir.ts`, `helpers.ts`, `install-sh.test.ts`, `fs-guard.test.ts`

## Work done
- **Secrets**: scanned the diff for key, token, private key and password patterns, and for `.env` files. Nothing found. The tests use the existing `FAKE_SECRET` constant.
- **install.sh (AC-1, AC-2)**: `if ! script_dir=$(CDPATH= cd -- "$script_dir" 2>/dev/null && pwd) || [ ! -f "$script_dir/install-helper.ts" ]; then ... exit 3; fi`
  - `CDPATH=` is a temporary assignment for the regular builtin `cd`, inside a subshell, so it does not leak. With CDPATH empty, `cd` neither searches nor prints. `--` stops option parsing. All expansions are quoted.
  - The script stays bash-3.2 compatible: assignment status is the status of the command substitution, and `if !` / `||` are 3.2 syntax. A failing condition inside `if` does not trip `set -e`.
  - The check comes after the prerequisite checks and before the only helper `node` call. The message is fixed text with no path or secret, and the exit code is 3. No eval and no external commands, so the AC-8 regex still holds. No new injection surface.
  - `[ -f ]` follows a symlinked helper. This is accepted per the architect: it is the user's own checkout, and install.ps1 behaves the same way.
- **Re-check placement (AC-3)**: in `applyPlan`, `firstUnsafeTarget([...])` runs right after `mkdirSync(azdoDir, recursive)` (install-helper.ts:345-352). It comes before the first chmod (`stripGroupOtherWrite`, :353), before any temp file, backup or rename, and before the no-change `restrictConfigMode`. It runs on every platform.
- **No path-based link-following mode changes or writes are left**: `chmodSync` and `lstatSync` no longer appear in `install-helper.ts`. Each remaining file-system mutation is listed below.
  - `adjustMode` (:151-172), used by `stripGroupOtherWrite` and `restrictConfigMode`, opens with `O_RDONLY|O_NOFOLLOW|O_DIRECTORY` (dirs) or `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` (file). It checks the type with `fstatSync` and changes the mode with `fchmodSync` on that descriptor, closing it in `finally`. `ELOOP` and `ENOTDIR` map to `refuse(path)`. Linux returns `ENOTDIR` (not `ELOOP`) for `O_NOFOLLOW|O_DIRECTORY` on a symlink, because the O_DIRECTORY check in `do_open` comes before `may_open`'s S_IFLNK check, so mapping both codes is correct. `fchmod` needs ownership, not write access, so an `O_RDONLY` descriptor is enough on Linux and macOS. `O_NONBLOCK` keeps a FIFO from blocking: the open returns at once, then the fstat type check refuses it.
  - `writeNew` (:140-148), used for temp files and backups: `openSync(path, "wx", mode)` (O_CREAT|O_EXCL), then `writeFileSync(fd)`, then `fchmodSync(fd, mode)` on POSIX. With O_EXCL, a symlink at the final component gives EEXIST and is never followed. Between create and fchmod the file mode is never wider than `mode`.
  - `renameSync(temp, dir/name)`: rename(2) replaces the directory entry at `newpath`. If `kilo.jsonc` or the plugin destination was swapped for a symlink after the re-check, the link itself is replaced and its target is neither written nor modified. Confirmed against POSIX rename semantics.
  - `rmSync(temp, {force:true})` on error unlinks and does not follow a final-component link.
- **Error messages**: `refuse(path)` echoes the path. The contract requires this (section 6/7 wording). The path is the user's own config path (`$XDG_CONFIG_HOME`/`~/.config/kilo/...`) and holds no secret, so this is intended and not a leak. Unexpected errno values still map to the generic `file system or internal error (CODE).` message.
- **Windows**: `IS_WINDOWS` guards are still in place in `writeNew`, `stripGroupOtherWrite` and `restrictConfigMode`. `constants.O_NOFOLLOW` is never evaluated on Windows. `install.ps1`, `backend/plugin/`, `backend/tools/` and the validator are not in the diff.
- **Lint rules 6/7**: `backend/installer/` has no `KILO_TEST_` or `NODE_OPTIONS` text (grep), and `fs-guard.ts` imports only `node:fs`. Both are confirmed by `check-fr11` inside `ci.sh`.
- **Test fixture**: `race-after-mkdir.ts` is referenced only from `backend/test/installer/{helpers.ts,install-sh.test.ts}`. Product code never imports it, and it does nothing unless `KILO_TEST_RACE` is set. It can only be loaded through test-controlled `NODE_OPTIONS`. The tests are hermetic: all paths (sandbox HOME, decoys, swap targets) are under the per-test `mkdtemp` root, which `withSandbox` removes. The CDPATH test uses `cwd: backendRoot` read-only and writes only to the sandbox HOME.
- **Runtime availability for the POSIX tests**: WSL has only the `docker-desktop` distro, and the Docker Desktop daemon is stopped. Node on win32 reports `process.platform === "win32"`, so the 5 POSIX symlink/race tests skip by design. I did not start Docker Desktop, because that has side effects on the host. The 5 tests were therefore **not run** this cycle (see Verification).

## Files changed
- `factory/runs/cycle-0020/04-security.md` — this report (no source changes).

## Verification
- `bash scripts/ci.sh` → exit 0 (`ci: PASS`). Totals: 624 tests, 614 pass, 0 fail, 10 skipped. `check-lf`, `check-docs` and lint (check-fr11 rules 6/7) pass.
  - These ran and passed on Windows: the 8 `fs-guard.test.ts` unit tests, T-019 AC-4 (22.17.1 refused, 22.18.0/23.0.1 install), AC-1 (CDPATH look-alike, MSYS path form), AC-2 (missing helper: exit 3, exact stderr, no helper node call, nothing written) and AC-5 (sk-bf- key never echoed).
  - These were skipped (win32): the 5 AC-3 symlink/race tests.
- `npm audit --omit=dev --audit-level=high` (backend) → `found 0 vulnerabilities`.
- **Not verified on a real POSIX host** (reasoned only):
  1. That `syncBuiltinESMExports()` makes the helper's `import { mkdirSync } from "node:fs"` binding use the wrapper on the CI Node version. This is documented Node behaviour (live bindings of builtin ESM), and the `fake-network.ts` preload already proves that `--import` of a `.ts` preload works.
  2. The ELOOP/ENOTDIR → refusal mapping in `adjustMode` on Linux/macOS. On FreeBSD, `O_NOFOLLOW` gives `EMLINK`, which falls to the generic exit-3 message. That still fails closed and never follows the link.
  3. **No test exercises the `O_NOFOLLOW`/`fchmod` path against a link.** The race fixture swaps right after `mkdir`, so the lstat re-check always fires first. A swap between the re-check and `adjustMode`, between the re-check and `writeNew`, or over `kilo.jsonc` just before `rename` is covered only by code review and kernel semantics, not by a test.
  4. The exact exit 3 and stderr of the race tests, and the decoy dir and file modes staying untouched.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | docs/architecture/contracts/installer-cli.md (section 6 "Residual") / ADR-0012 section 6 | The residual-risk text is incomplete. It names (a) a configDir swap before `mkdir` creating an empty `azdo/` and (b) unchecked parents of `<configDir>`. It does not say that `<configDir>` or `azdo/` can be swapped for a link **after** the re-check and `adjustMode` but before `writeAtomic`/`writeBackup`. In that case the plugin (0644), `kilo.jsonc` (0600) and the backup are created and renamed **inside the link target directory**, because `join(dir, temp)` resolves the dir component through the link. The ADR's "race for the parent components" covers this only implicitly, and the contract line "a symlink's target is never touched" holds only for the re-check moment. The precondition is the same as the accepted residual (write access to the user's own config dir or its parent), so the risk is accepted, but the docs should say so plainly. | Follow-up: in contract section 6 and ADR-0012 section 6, add one sentence: "a swap of `<configDir>` or `azdo/` after the re-check can redirect the plugin/config/backup writes into the link target; Node has no `openat`/`renameat`, so this is accepted with the same precondition." |
| 2 | low | backend/test/installer/install-sh.test.ts (RACES) | The race fixture fires only after `mkdir`, so the `O_NOFOLLOW`/`fchmod` refusal in `adjustMode` (ELOOP/ENOTDIR/wrong-type branches) and rename-over-link are never exercised. That code path is unverified on every platform. | Follow-up: add a race trigger after the re-check, for example by wrapping `fs.openSync` so the swap happens on the first `O_NOFOLLOW` open of the target, so the descriptor-level refusal and the "rename replaces the link" behaviour are tested on Linux CI. |
| 3 | info | docs/architecture/ADR-0012-posix-bootstrap-installer.md section 6 | The ADR calls the guard `checkTargets`, but the code exports `firstUnsafeTarget`. | Rename it in the ADR text. |
| 4 | info | backend/installer/install-helper.ts:152-158 | `adjustMode` opens dirs and the file `O_RDONLY`. An owner-unreadable config dir (for example mode 0333) now fails with a generic exit 3, where the old path-based chmod succeeded. Opening a device node swapped in at `kilo.jsonc` would also run its open side effects, although an attacker needs write access to the config dir to do that. Both fail closed. | None required. |
| 5 | info | (environment) | The 5 POSIX symlink/race tests have never run. | They must pass on Linux CI (the `ai-factory.yml`/`ci.sh` run on ubuntu) before or at merge. The CI/Release phase should confirm they appear as passed, not skipped. |

No critical, high or medium findings.

## Assumptions made (no human available)
- Kernel behaviour is taken from POSIX and Linux namei/rename semantics: O_NOFOLLOW gives ELOOP or ENOTDIR (Linux, with O_DIRECTORY), O_EXCL does not follow a final symlink, and rename replaces a link at newpath. I did not run it on Linux, because no Linux runtime was running on this host and starting Docker Desktop would change the host.
- Findings 1 and 2 are graded low. Exploiting them needs same-user write access to `~/.config` or `XDG_CONFIG_HOME`, which the ADR already treats as account compromise. They are documentation and test-coverage gaps, not weakened controls.

## Follow-ups for the backlog
- Contract/ADR: state the post-re-check dir-swap residual explicitly (finding 1) and fix the `checkTargets` name (finding 3).
- Tests: add a post-re-check race trigger (wrap `openSync`) to cover the `O_NOFOLLOW`/`fchmod` refusal and rename-over-link (finding 2).
- CI: confirm that the 5 T-019 AC-3 POSIX tests pass on Linux (finding 5).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0020/04-security.md
summary: T-019 PASS - re-check sits between mkdir and first chmod/write, all mode changes fd-based with O_NOFOLLOW, wx+fchmod for temp/backup, install.sh CDPATH-safe with exact exit-3 message; ci.sh PASS, npm audit 0 vulns; 2 low follow-ups (residual doc wording, O_NOFOLLOW path untested) and POSIX race tests unrun on this Windows host
