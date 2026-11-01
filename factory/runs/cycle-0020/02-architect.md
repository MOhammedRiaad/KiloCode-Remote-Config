# Architect report — cycle 0020 — T-019: Installer hardening: CDPATH-safe helper lookup, symlink re-check, Node version test fix

## Inputs read
- `factory/runs/cycle-0020/01-product-owner.md` (T-019, 6 ACs)
- `docs/architecture/ADR-0012-posix-bootstrap-installer.md`, `ADR-0014` (install.ps1 helper lookup), `contracts/installer-cli.md` 1.2.0, `overview.md`
- `backend/installer/install.sh`, `backend/installer/install-helper.ts`, `backend/tools/check-fr11.mjs` (rules 6, 7)
- `backend/test/installer/install-sh.test.ts`, `helpers.ts`, `install-ps1-static.test.ts`

## Work done
- Small hardening change, so no new ADR. ADR-0012 is amended in place (sections 2, 6 and 8, plus an
  "Amended in place" header line). The contract `installer-cli.md` goes from 1.2.0 to **1.2.1**. That is a
  patch-level contract change: no new input, stdin record or exit code. The new install.sh
  message reuses the exit-3 class and copies install.ps1's wording word for word.
- Decisions:
  1. **install.sh**: `script_dir=$(CDPATH= cd -- "$script_dir" && pwd)`, then `[ -f "$script_dir/install-helper.ts" ]`.
     If the `cd` fails or the file is missing, stderr gets exactly
     `install.sh: error: installer sources are missing (expected install-helper.ts next to install.sh).`
     and the script exits 3. The check runs after the prerequisite checks, at the same point as in install.ps1.
     install.ps1 already uses this wording, so it stays **unchanged**.
  2. **Post-mkdir re-check** lives in a new sibling module, `backend/installer/fs-guard.ts`, with an injectable `lstat`,
     so it can be unit-tested on Windows. `install-helper.ts` runs top-level `await run()` when it is
     imported, so it must stay export-free. Testable logic goes into sibling modules, the same pattern as
     `personal-config-edit.ts` and `smoke.ts`. The plugin export surface is unaffected because the installer is not the plugin.
  3. **Refusal**: reuse `refuse(path)`. Exit 3 and
     `<path> is not a regular file or directory (symlinks are not followed); update it manually.`
  4. **TOCTOU, handled honestly**: the lstat re-check alone is still check-then-use. Every chmod is
     therefore done through a descriptor opened with `O_NOFOLLOW` (dirs also get `O_DIRECTORY`, files also get
     `O_NONBLOCK`). The type is checked with `fstat` and the mode is set with `fchmod`. This closes the race for the last path
     component. Temp files and backups are `fchmod`-ed through the `wx` descriptor that created them.
     Accepted residual risk, written into the ADR and the contract: (a) parent components can still be swapped;
     (b) if configDir is swapped between planning and the write phase, `mkdirSync(recursive)` can create an empty 0700
     `azdo/` inside the link target before the re-check refuses. Node has no `mkdirat` or `openat`.
     Exploiting either needs write access to `~/.config` or `XDG_CONFIG_HOME`, which means the account is already controlled.
     Parents are deliberately not checked, because dotfile managers symlink `~/.config`.
  5. **Race test without a product test switch**: a TEST-ONLY preload `test/installer/fixtures/race-after-mkdir.ts`
     is loaded via NODE_OPTIONS next to `fake-network.ts`. It wraps `fs.mkdirSync` and calls
     `module.syncBuiltinESMExports()` so the helper's named import picks up the wrapper. Then it swaps the
     target for a symlink right after the real mkdir. This keeps rule 7 intact: `installer/` contains no
     `KILO_TEST_` or `NODE_OPTIONS` text.

## Files changed
- `docs/architecture/contracts/installer-cli.md` — 1.2.1: version line, `fs-guard.ts` in the Files list, section 3 step 4 (CDPATH-safe dir, missing helper -> exit 3), step 6 (re-check), section 6 (re-check order, O_NOFOLLOW/fchmod, residual risk), section 7 (fixed missing-helper message).
- `docs/architecture/ADR-0012-posix-bootstrap-installer.md` — amended: header, section 2 (CDPATH), section 6 (re-check, fd-based chmod, residual risk), section 8 (race fixture, unit tests, no exports from the helper).
- `docs/architecture/overview.md` — C5 row, install data flow, directory layout (`fs-guard.ts`, `race-after-mkdir.ts`).
- `factory/runs/cycle-0020/02-architect.md` — this report.

## Backend tasks

Follow ADR-0001 and ADR-0012 (as amended). Keep `install.sh` bash-3.2 compatible and builtins only (AC-8 regex).
No installer file may contain the text `KILO_TEST_` or `NODE_OPTIONS`, comments included (rule 7). `installer/*.ts` may import only
`node:*`, `./<sibling>.ts` and `../plugin/azdo-remote-config.ts` (rule 6). `.ts` files must use erasable
syntax only (Node type stripping: no enums, no parameter properties).

### BE-1 install.sh: CDPATH-safe dir and missing-helper check (AC-1, AC-2, AC-6)
File: `backend/installer/install.sh` (replace lines 139-141):
```bash
if ! script_dir=$(CDPATH= cd -- "$script_dir" 2>/dev/null && pwd) || [ ! -f "$script_dir/install-helper.ts" ]; then
  printf 'install.sh: error: installer sources are missing (expected install-helper.ts next to install.sh).\n' >&2
  exit 3
fi
printf '%s\0' ... | node "$script_dir/install-helper.ts"
```
(Any equivalent is fine if it keeps: no CDPATH search, `--`, the exact one-line message, exit 3, no helper node call, and it still works under `set -euo pipefail`.)

### BE-2 fs-guard.ts: target re-check (AC-3, AC-6)
New file `backend/installer/fs-guard.ts`. Imports only `node:fs`. Exports:
```ts
export type TargetKind = "dir" | "file";
export interface Target { readonly path: string; readonly kind: TargetKind; readonly required: boolean }
export type LstatLike = (path: string) => { isFile(): boolean; isDirectory(): boolean } | null;
export function lstatOrNull(path: string): Stats | null;            // moved from install-helper.ts unchanged (ENOENT/ENOTDIR -> null, else throw)
export function firstUnsafeTarget(targets: readonly Target[], lstat: LstatLike = lstatOrNull): string | null;
```
Semantics: check the targets in order. `null` stat: if `required`, return the path, otherwise continue. `dir` and not `isDirectory()` -> path.
`file` and not `isFile()` -> path. A symlink fails both checks. Errors other than ENOENT/ENOTDIR propagate and
map to the generic exit-3 message. Return `null` when every target is fine. The file header comment cites ADR-0012 and contract 1.2.1.

### BE-3 install-helper.ts applyPlan ordering and fd-based chmod (AC-3, AC-6)
File: `backend/installer/install-helper.ts`. Import `lstatOrNull` and `firstUnsafeTarget` from `./fs-guard.ts` and delete the local copy of `lstatOrNull`.
New `applyPlan` order:
1. `mkdirSync(plan.azdoDir, { recursive: true, mode: 0o700 })`.
2. `const bad = firstUnsafeTarget([{configDir,dir,required:true},{azdoDir,dir,required:true},{pluginPath,file,false},{configPath,file,false}]); if (bad !== null) throw refuse(bad);`
   This comes before ANY chmod, temp file, backup or rename.
3. `stripGroupOtherWrite(configDir)`, then `stripGroupOtherWrite(azdoDir)`. On POSIX, rewrite as
   `fd = openSync(dir, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY)`, then `fstatSync(fd)` must be a
   directory, then `fchmodSync(fd, mode & ~0o022)` only if `mode & 0o022`, and `closeSync` in a `finally`.
   `ELOOP`, `ENOTDIR` or the wrong type -> `throw refuse(dir)`.
4. Plugin copy (unchanged logic).
5. No-change branch: on POSIX, open `configPath` with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, require `fstat` to report a regular file,
   and `fchmodSync(fd, 0o600)` when `(mode & 0o777) !== 0o600`. `ELOOP` or the wrong type -> `refuse(configPath)`.
6. Backup, then config write (unchanged order).
7. `writeAtomic` / `writeBackup`: create with `openSync(path, "wx", mode)`, `writeFileSync(fd, data)`,
   `fchmodSync(fd, mode)` on POSIX, then `closeSync`. Replace the path-based `chmodSync`. Keep the temp-file cleanup on error.
   After this change, `chmodSync` must not appear in the helper anymore.
Windows: no chmod or fd mode code runs (keep the `IS_WINDOWS` guards). Step 2 runs on every platform.

### BE-4 test helpers (supports AC-1..AC-5)
File: `backend/test/installer/helpers.ts`. These changes are backward compatible, because e2e and other tests use `runInstall`.
- `RunInstallOptions` gains `cwd?: string` (spawn cwd), `script?: string` (script argument, default `installShPath`),
  and `preload?: string[]` (extra file URLs, each appended to `NODE_OPTIONS` as `--import=<url>`).
- `stubNode(sb, version?, opts?: { log?: boolean })`: when `log` is set, append `"$*"` to `<sb.root>/node.log` before acting.

### BE-5 race preload fixture (AC-3)
New file `backend/test/installer/fixtures/race-after-mkdir.ts`. TEST ONLY: it is never imported by product code.
It reads `KILO_TEST_RACE` = JSON `{ trigger, swap, target }`. It wraps `fs.mkdirSync` on the `node:fs` default
export and calls `syncBuiltinESMExports()`. The **first** call whose path argument equals `trigger` (the azdo dir) runs the real
mkdir and then swaps: an existing `swap` is renamed to `swap + ".orig"`, then `symlinkSync(target, swap)`.
The fixture does nothing when the variable is unset.

### BE-6 tests: `backend/test/installer/install-sh.test.ts`
Each new or rewritten test below must FAIL against the current `install.sh` / helper (check red, then green on Linux):
- **AC-1 CDPATH look-alike**: decoy `<sb.root>/decoy/installer/install-helper.ts` (prints `DECOY`). Run
  `runInstall(sb, REQUIRED_ARGS, { AZDO_PAT, CDPATH: <sb.root>/decoy }, { cwd: backendRoot, script: "installer/install.sh" })`.
  Expect exit 0, the real plugin and kilo.jsonc installed, and stdout without `DECOY` or any decoy/installer directory line. On Windows
  CDPATH needs the MSYS form (`/c/...`), because `:` is the CDPATH separator. Convert the path, or skip on Windows with
  `t.skip("CDPATH test needs a POSIX path list; covered on Linux CI")`.
- **AC-2 missing helper**: copy install.sh alone to `<sb.root>/lonely/install.sh`, use `stubNode(sb, undefined, { log: true })`
  and `{ script: <copy> }` with valid args and AZDO_PAT. Expect exit 3, stderr `===` the exact message + `\n`, stdout `""`,
  no `install-helper` in node.log, `noStack`, and `snapshot(sb.home)` equal to `{}`.
- **AC-4 Node version** (replaces the test at line 246): v22.17.1 -> exit 1, stderr contains
  `Node.js 22.18 or later is required (found 22.17.1).`, nothing written. v22.18.0 and v23.0.1 with REQUIRED_ARGS + AZDO_PAT
  (no `--help`) -> exit 0, stderr does not match `/Node\.js 22\.18/`, kilo.jsonc exists.
- **AC-5 sk-bf- key**: `KILO_BIFROST_KEY = "sk-bf-" + FAKE_SECRET`. Expect exit 0, neither stdout nor stderr contains the key,
  `FAKE_SECRET` or `SECRET_TAIL`, no `does not start with sk-bf-` warning, and kilo.jsonc apiKey equal to the key.
- **AC-3 symlinks (POSIX only)**: skip with `t.skip("symlink tests need POSIX symlinks; fs-guard unit tests cover Windows")`.
  Decoy dir with mode 0o777 plus a file in it. Decoy file with mode 0o644 and known bytes.
  - planning time: configDir -> symlink to decoy dir; azdoDir -> symlink to decoy dir (configDir real).
  - post-mkdir race via `preload: [race fixture URL]`, cases: (a) swap configDir (fresh run); (b) swap azdoDir;
    (c) swap kilo.jsonc, fresh; (d) swap kilo.jsonc on an **unchanged** config (install once, `chmod 0644`
    kilo.jsonc, run again with the same inputs, so the no-change chmod branch is taken).
  - Every case: exit 3, stderr `===` `install.sh: error: <swapped path> is not a regular file or directory (symlinks are not followed); update it manually.\n`,
    decoy bytes, mode and listing unchanged (check `statSync(decoy).mode` explicitly), no `.*.tmp-*` and no `kilo.jsonc.bak-*`
    created through the link, `noStack`. Cases (a), (b) and (d) must be red against the current helper.
- Keep every existing test (including `AC-7 a symlinked kilo.jsonc is refused`, the AC-8 LF / `bash -n` / no-external-commands checks).

### BE-7 tests: `backend/test/installer/fs-guard.test.ts` (new, runs on all platforms)
Use an injected `lstat` fake. Cases: all fine -> null; symlink-like stat (both checks false) at configDir -> configDir;
the first failure wins (order); required dir missing -> its path; optional file missing -> null; a `file` target that is a
directory -> path; `lstat` throwing `EACCES` propagates. Real fs: `lstatOrNull` on a missing path -> null.

### BE-8 gate
`bash scripts/ci.sh` exits 0 (lint incl. check-fr11 rules 6/7, typecheck, tests, docs check). The install.ps1 tests still pass
where PowerShell is available. No change to `install.ps1`, the plugin, or `docs/` outside architecture.

## Frontend tasks
- None. `frontend/` is intentionally absent (scope.frontend = false).

## Security notes (for the Security engineer)
- Check that the re-check really sits between `mkdirSync` and the first chmod or write, that no `chmodSync`/path-based
  mode change is left in the helper, and that `O_NOFOLLOW` is used on every POSIX mode change.
- Residual races (parent components; the empty `azdo/` mkdir through a link swapped before mkdir) are accepted and documented
  in ADR-0012 section 6 and contract section 6. They need write access to the user's own config parent.
- `[ -f ]` follows a symlinked `install-helper.ts`. This is acceptable: it is the user's own checkout, and the same holds for install.ps1.
- The race fixture and `KILO_TEST_RACE` live only under `test/`. Rule 7 keeps `installer/` free of test switches.
- No secret is ever printed: the new message is fixed text, and the sk-bf- key leak test is added.

## Verification
- Documentation-only change by the Architect. `install-ps1-static.test.ts` reads the contract: section 10 and its
  exit-code sentence are unchanged.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/installer/install.sh:139 | CDPATH-unsafe `cd`, no helper check | BE-1 |
| 2 | low | backend/installer/install-helper.ts:312-326 | No re-check after mkdir; `chmodSync` follows links | BE-2, BE-3 |
| 3 | low | backend/test/installer/install-sh.test.ts:246 | Version-pass test never reaches the check | BE-6 |

## Assumptions made (no human available)
- Contract version 1.2.1, not 1.3.0: no new input, record or exit code. The new message matches install.ps1's.
- The plugin destination is re-checked as well, which is cheap and consistent with planning, even though the AC names only configDir, azdoDir and kilo.jsonc.
- If `syncBuiltinESMExports` cannot make the race preload work on the CI Node version, BE may fall back to the planning-time
  symlink tests plus fs-guard unit tests and must record that in its report. This is not expected: the API is documented for exactly this purpose.
- A file that appears concurrently between planning and write (a regular file, not a link) is out of scope. It is a concurrency issue, not a link-following one.

## Follow-ups for the backlog
- None new.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0020/02-architect.md
summary: T-019 design: install.sh CDPATH-safe dir + exact exit-3 missing-helper check; fs-guard.ts post-mkdir re-check + O_NOFOLLOW/fchmod in applyPlan; race preload fixture + real version/sk-bf-/CDPATH tests; contract 1.2.1, ADR-0012 amended
