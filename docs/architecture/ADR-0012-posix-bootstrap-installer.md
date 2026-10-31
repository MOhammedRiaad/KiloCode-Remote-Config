# ADR-0012: POSIX bootstrap installer (`install.sh`) and shared Node install helper
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0011 / F-010
- Amended by: ADR-0013 (cycle-0013, F-019): smoke phase in the helper, `--no-smoke`, exit code 4,
  optional `smoke` stdin record, FR-11 lint rule 7.
- Amended by: ADR-0014 (cycle-0014, F-011): `install.ps1` front end, optional `frontend` stdin
  record (message prefix only), Windows ACL behaviour documented.

## Context

FR-18..FR-21, FR-23, AC-12 and AC-14 need a bootstrap installer for macOS / Linux that:
copies the single plugin file (C2) to the Kilo global config directory, creates or updates the
engineer's personal config (C3) from `backend/personal-config/kilo.jsonc`, and checks the
prerequisites (Node, `az login` or a PAT) before it writes anything. Constraints:

- Zero runtime npm dependencies (FR-11, ADR-0001 section 6). Installers may use POSIX shell and
  Node built-ins only.
- Editing JSONC in bash is not realistic. The plugin already has a tested JSONC parser
  (`__internals.parseJsonc`, ADR-0003) and settings validation (`__internals.resolveSettings`,
  ADR-0006).
- The plugin file, its export surface (`__internals` with 6 keys) and the template must not change.
- Tests must run `install.sh` in a child `bash` on Linux CI (GitHub Actions `ubuntu-latest`, which
  ships a real `az` in `/usr/bin`) and on Windows Git Bash dev machines (MSYS2 runtime, which
  rewrites path-looking arguments and environment values when it starts a native `.exe`).
- The Windows installer (F-011, `install.ps1`) needs the same behaviour (parity).
- macOS still ships bash 3.2 as `/bin/bash`.

Kilo is an OpenCode fork. OpenCode computes its global config dir with `xdg-basedir`
(`$XDG_CONFIG_HOME` if set, else `<homedir>/.config`) and appends the product name, so Kilo's
global dir is `$XDG_CONFIG_HOME/kilo` or `~/.config/kilo` on every platform (also Windows, where
the home dir is `%USERPROFILE%`). ADR-0001 section 5 already relies on the plugin tuple
`["./azdo/azdo-remote-config.ts", {...}]` being resolved relative to the config file that holds
it, i.e. the global config dir (vision assumption A1/A2, re-checked in Phase 0).

## Decision

### 1. Split: thin bash front end + Node helper that does all file work

| File | Role |
|---|---|
| `backend/installer/install.sh` | Argument / env parsing, required-input check, prerequisite checks (Node version, `az` login or PAT). Uses **only bash builtins plus `node` and `az`**: no `dirname`, `cp`, `mkdir`, `chmod`, `date`, `cat`, `sed`, `mktemp`. bash 3.2 compatible (no arrays under `set -u`, no `mapfile`, no `${x,,}`, no associative arrays). Never writes a file. |
| `backend/installer/install-helper.ts` | Node CLI (I/O). Reads inputs from stdin, resolves the target dir, validates, plans, then writes. Shared with F-011 (`install.ps1` can feed it the same stdin). |
| `backend/installer/personal-config-edit.ts` | Pure, synchronous functions (no I/O): input validation, fresh-config rendering from the template, update of an existing config object, plugin-entry matching. Unit-tested directly. |

The helper files import only `node:` built-ins, `./<sibling>.ts` and exactly
`../plugin/azdo-remote-config.ts` (for `__internals.parseJsonc` and `__internals.resolveSettings`).
This is enforced by a new FR-11 lint rule 6 (ADR-0001 section 3 amended). They are `.ts` files
run directly by Node, so **Node >= 22.18** is a prerequisite of the installer (same as ADR-0001).

### 2. Locating the sources

Script-relative only, no source option. `install.sh` computes its own directory with builtins
(`${BASH_SOURCE[0]%/*}` + `cd ... && pwd`) and runs `node "<dir>/install-helper.ts"`. The helper
locates its inputs from `import.meta.url`:
`../plugin/azdo-remote-config.ts` and `../personal-config/kilo.jsonc`. Distribution therefore keeps
the three folders `installer/`, `plugin/`, `personal-config/` side by side (a checkout of this
`backend/` tree or the same subtree published in the C1 repo).

### 3. Passing inputs to the helper: NUL-separated records on stdin

`install.sh` runs `printf '%s\0' "org=$org" ... "apiKey=$key" | node "$helper"`. `printf` is a
builtin, so no value ever appears in any process argv. stdin is never rewritten by MSYS2, so
values such as `path=/kilo.jsonc` survive Git Bash unchanged (passing them as arguments or env vars
would get them rewritten to `C:/Program Files/Git/kilo.jsonc`). The virtual key is read once by
`install.sh` from `KILO_BIFROST_KEY` and forwarded as the `apiKey` record. The helper does not read
`KILO_AZDO_*`, `KILO_BIFROST_KEY` or any PAT variable itself. Exact protocol: contract
`installer-cli.md` section 4.

### 4. Target directory

Resolved by the helper, not by bash (Node's `os.homedir()` is what Kilo uses, on all platforms):
`configDir = $XDG_CONFIG_HOME/kilo` when `XDG_CONFIG_HOME` is set and non-empty, else
`join(os.homedir(), ".config", "kilo")`. A relative `XDG_CONFIG_HOME` is a usage error (Kilo would
resolve it against its own cwd, which the installer cannot know). Files written:

- `<configDir>/azdo/azdo-remote-config.ts`: byte copy of the plugin.
- `<configDir>/kilo.jsonc`: the personal config.
- `<configDir>/kilo.jsonc.bak-<UTC yyyyMMddTHHmmssZ>[-<n>]`: backup, only before a modification.

Nothing is ever written to `<configDir>/plugin/` or `<configDir>/plugins/` (AC-12: those folders
are auto-loaded by Kilo; a second copy there would load the plugin twice). If either already holds
an `azdo-remote-config.*` file, the helper prints a warning telling the engineer to remove it and
does not touch it.

### 5. Fresh install vs update (FR-20)

- **Fresh** (no `kilo.jsonc`): the template text is rendered by exact token replacement, so its
  comments are kept. Each of the seven literal pairs `"org": "contoso"`, `"project": "platform"`,
  `"repo": "kilo-config"`, `"path": "/kilo.jsonc"`, `"branch": "main"`, `"mode": "defaults"`,
  `"apiKey": "sk-bf-<your-virtual-key>"` must occur exactly once; the value is replaced with
  `JSON.stringify(newValue)`. The result is re-parsed and must deep-equal the expected object;
  otherwise the helper fails with an internal error (template drift is caught by tests first).
  With no key the placeholder stays.
- **Update** (file exists): parse with `parseJsonc`, root must be a plain object, then apply the
  edit rules of the contract (section 5): remove every entry that refers to
  `azdo-remote-config`, insert one new tuple at the position of the first removed entry (append
  if none), keep every other key and plugin entry, set `apiKey` only when a key was supplied or
  none exists. Output is `JSON.stringify(obj, null, 2)` with a fixed two-line header comment and
  LF endings. **Comments of an existing file are not preserved**; the backup holds them.
- **Idempotency (AC-14, FR-23)**: the helper compares the planned object with the parsed existing
  object using `util.isDeepStrictEqual`. Equal means no write, no backup, no temp file. The plugin
  copy is skipped when the destination bytes already equal the source. A second run with the same
  inputs therefore changes nothing.

### 6. Safety of writes

- Validate everything first (inputs, existing config parse, file types, sizes), then write. Any
  failure before the write phase leaves the disk untouched (AC-5, AC-7).
- Write order: dirs, plugin, backup, personal config.
- All writes go to a temp file in the same directory, opened with flag `wx` and mode `0600`
  (`0644` for the plugin copy), then `rename` over the target. The temp file is removed on failure.
- Backups are created with `wx` + `0600` from the exact original bytes (byte-identical). On a
  name collision, `-1`, `-2`, ... is appended.
- POSIX only (`process.platform !== "win32"`): the personal config and backups are `chmod 0600`
  after rename (defeats umask). Dirs the helper creates are `0700`. If `<configDir>` or
  `<configDir>/azdo` exist and are group- or world-writable, those bits are removed. On Windows
  no chmod is attempted (ACLs are F-011's job).
- Symlinks: `lstat` is used. If `kilo.jsonc`, `azdo/` or `azdo/azdo-remote-config.ts` exists and is
  not a regular file / directory (for example a symlink), the helper refuses with a fixed error and
  writes nothing. Conservative: no writing through links that someone else may control.
- Size caps: existing `kilo.jsonc` at most 1 MiB; stdin at most 64 KiB.

### 7. Prerequisites (FR-21), checked by `install.sh` before the helper runs

1. Node on PATH and version >= 22.18 (`node -p process.versions.node`, compared in bash).
2. Credentials: pass if any of `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`, `KILO_AZDO_PAT` is non-empty (the
   value is never read beyond the emptiness test; `az` is not called). Otherwise `az` must be on
   PATH and `az account show --output none` must exit 0 (stdout and stderr discarded).

All failing prerequisites are reported together, then exit 1. The FR-22 smoke test is F-019.

### 8. Testing approach

- Integration tests spawn **an absolute path to bash** (found by scanning `process.env.PATH` for
  `bash` / `bash.exe`, skipping `\Windows\System32` and `WindowsApps` (WSL launchers);
  `KILO_TEST_BASH` overrides), because Node looks up the command in the child env's `PATH`, which
  the test replaces.
- The child env is built from scratch (never inherits `process.env`): `PATH=<tmp>/bin` only,
  `HOME=<tmp>/home`; on Windows also `USERPROFILE=<tmp>/home`, `SYSTEMROOT`, `TEMP`/`TMP` (outside
  home). `<tmp>/bin` holds a `node` wrapper (`#!/bin/sh` + `exec "<process.execPath>" "$@"`, path with
  forward slashes) and, per test, a stub `az`. Because install.sh uses only builtins, this PATH
  is enough, and the runner's real `az` is never reachable.
- POSIX mode assertions are skipped on Windows with `t.skip("POSIX permissions are not enforced on
  Windows")`.
- No network, no real `az`, no real home directory, no Kilo.

### 9. Lint / CI

- `.gitattributes` already has `*.sh text eol=lf` and `*.jsonc text eol=lf`. A test asserts that
  `install.sh` contains no CR byte and that `bash -n install.sh` passes.
- FR-11 lint rule 6: `installer/*.ts` import allow-list (same as rule 5 for `validator/`).
- `tsconfig.json` includes `installer/**/*.ts`.
- ShellCheck is not a dependency (not installed on Windows dev machines). Recommended for the CI
  releaser: run it in `scripts/ci.sh` only when present (as with `ruff`); `ubuntu-latest` ships it.

## Consequences

- One code path for JSONC editing, validated by the same parser and setting rules Kilo's plugin
  uses. A value the installer accepts is a value the plugin accepts.
- `install.ps1` (F-011) can reuse `install-helper.ts` unchanged and only re-implement the prereq
  check and stdin feeding in PowerShell.
- Engineers need Node >= 22.18. Kilo CLI is distributed through npm, so Node is present, but older
  versions get a clear fix message.
- Comments in an existing personal config are lost on update (byte-identical backup kept).
- A symlinked `kilo.jsonc` (dotfile managers) is refused rather than replaced; the engineer edits it
  by hand. Documented by the docs writer.
- Extra plugin options in an old azdo entry (`pat`, `timeoutMs`) are dropped on update; their names
  (never values) are reported. This also moves PATs out of the file (FR-3).

## Alternatives considered

- **Edit JSONC in bash/sed/awk/jq**: fragile, `jq` is not JSONC-aware and not always installed.
  Rejected.
- **A second zero-dep JSONC parser in plain `.mjs`** (works on older Node): duplicates ADR-0003
  logic and its security properties. Rejected; Node >= 22.18 is acceptable.
- **Comment-preserving JSONC edit** (CST edit): high effort, PO explicitly allows dropping comments
  with a backup. Rejected for now; fresh installs keep the template comments.
- **Pass values as argv or env to Node**: argv leaks the key into process listings, and MSYS2
  rewrites `/kilo.jsonc`-style values on Git Bash. Rejected for stdin.
- **Bash resolves `$HOME/.config/kilo` and passes it to Node**: on Git Bash it is a POSIX path Node
  cannot use, and Kilo itself uses Node's `homedir()`. Rejected.
- **Install into `~/.config/kilo/plugin/`** (auto-loaded): combined with the tuple entry it loads the
  plugin twice and the tuple is the only way to pass options. Rejected (AC-12).
- **`--source-dir` option**: no current need. Can be added later without breaking the contract.
- **Restrict tests to a PATH with `/usr/bin`**: the Linux runner has a real `az` there. Rejected in
  favour of the builtins-only rule plus a stub bin dir.
