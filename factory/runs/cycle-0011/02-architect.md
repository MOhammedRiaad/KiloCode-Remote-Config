# Architect report — cycle 0011 — F-010: Bootstrap installer for macOS/Linux (install.sh): plugin copy, personal config, prerequisite check

## Inputs read
- factory/runs/cycle-0011/01-product-owner.md (F-010 with AC-1..AC-8)
- docs/architecture/ADR-0001, ADR-0003, ADR-0006, ADR-0007, ADR-0011, overview.md, contracts/personal-config-template.md, contracts/validator-cli.md
- backend/plugin/azdo-remote-config.ts (parseJsonc, resolveSettings, PAT env names, `__internals`), backend/personal-config/kilo.jsonc, backend/package.json, backend/tsconfig.json, backend/tools/check-fr11.mjs, backend/test/validator/helpers.ts
- scripts/ci.sh, scripts/check-lf.sh, .gitattributes, .github/workflows/ci.yml
- cycle-0010 follow-ups (security 0600 + backup, docs: plugin location)
- Web: OpenCode's global config dir comes from `xdg-basedir` (`$XDG_CONFIG_HOME` used as given, else `~/.config`), and on Windows it uses `~/.config` under the home dir too.

## Work done
- Design: a thin **bash front end** (`install.sh`: flags/env, required inputs, prerequisites; bash builtins + `node` + `az` only; never writes) plus a **Node helper** (`install-helper.ts`, all file I/O) and a **pure edit library** (`personal-config-edit.ts`). The helper reuses the plugin's `__internals.parseJsonc` and `__internals.resolveSettings`. Inputs reach the helper as NUL-separated `name=value` records on stdin, so the key never shows up in argv and Git Bash/MSYS2 cannot rewrite `/kilo.jsonc`. F-011 can reuse the helper as is.
- New ADR-0012 (POSIX installer), new contract `contracts/installer-cli.md` (CLI, env, exit codes, stdin protocol, edit rules, modes, backups, output and what is never printed).
- ADR-0001 amended: FR-11 lint rule 6 (`installer/*.ts` import allow-list), `tsconfig` include `installer/**/*.ts`, layout line. overview.md: C5 row, install data flow, layout, quality gate. README: contract index.

### Key decisions (details in ADR-0012 / contract)
| Topic | Decision |
|---|---|
| Inputs | `--org/--project/--repo` (required, flag or `KILO_AZDO_*`), `--path/--branch/--mode` (defaults `/kilo.jsonc`/`main`/`defaults`), `--help`. Flag > env > default. No key or PAT flag. Unknown args are never echoed. |
| Key | Only from `KILO_BIFROST_KEY`. If empty: keep the existing `apiKey`, or write the placeholder and print "Set your Bifrost virtual key ...". |
| Prereqs (before any write, all reported, exit 1) | `node` >= 22.18; `AZDO_PAT`/`AZURE_DEVOPS_EXT_PAT`/`KILO_AZDO_PAT` non-empty, otherwise `az` on PATH and `az account show --output none` exits 0. |
| Value validation | Each setting is checked through `resolveSettings({name: v}, {env:{}})`. Any warning means exit 2. The normalised values are written. |
| Target dir | Resolved by the helper: `$XDG_CONFIG_HOME/kilo` (must be absolute) or `os.homedir()/.config/kilo`. The plugin goes to `<dir>/azdo/azdo-remote-config.ts`. The tuple `./azdo/azdo-remote-config.ts` resolves relative to the config file in `<dir>`. Nothing is written to `plugin/`/`plugins/`; any existing copy there triggers a warning (AC-12). |
| Fresh config | Template text with exact token replacement, so comments are kept. The result is re-parsed and checked. |
| Update config | Parse, edit (remove every azdo-remote-config entry, insert one at the first position, keep everything else, apiKey rule), then `JSON.stringify(…, 2)` with a fixed header. Comments are dropped and kept in the backup. |
| Idempotency | `util.isDeepStrictEqual(planned, existing)` means no write and no backup. The plugin is copied only when its bytes differ. |
| Safety | Read-only phase first, then writes. Temp file `wx` + rename. Backup `kilo.jsonc.bak-<UTC>`[-n], `wx`, 0600, byte-identical. Config 0600, new dirs 0700, group/other write bits removed on existing dirs (POSIX only). `lstat`: symlinked targets are refused. 1 MiB config cap, 64 KiB stdin cap. |
| Exit codes | 0 ok · 1 prereq · 2 usage/input · 3 config/IO/internal |
| Tests | Child bash at an **absolute path** (PATH scan, skipping WSL launchers; `KILO_TEST_BASH` override). Env built from scratch. `PATH=<tmp>/bin` holds only a `node` wrapper and an optional `az` stub, so the CI runner's real `/usr/bin/az` cannot be reached. Mode checks are `t.skip` on Windows. |
| Lint | `.gitattributes` already forces LF for `*.sh`. Tests assert no CR and `bash -n`. Rule 6 in check-fr11. ShellCheck stays optional (see CI note). |

## Backend tasks

Files to create / modify (all under `backend/`). Follow `docs/architecture/contracts/installer-cli.md` exactly.

**BE-1. `tools/check-fr11.mjs` + `tsconfig.json` (AC-8)**
- Generalise rule 5 into a helper used for `validator/` and `installer/` (rule 6): the `.ts` files directly in `installer/` may import only `node:*`, `./<name>.ts`, or exactly `../plugin/azdo-remote-config.ts`, and may not contain `require(`. Skip if the dir is missing. Error text names `installer/<file>`.
- `tsconfig.json`: add `"installer/**/*.ts"` to `include`.
- Tests in `test/tools/check-fr11.test.ts`: installer allowed imports pass, a bare package or `../validator/x.ts` import fails, `require(` fails, a missing `installer/` passes.

**BE-2. `installer/personal-config-edit.ts` (pure, no I/O; AC-1, AC-3, AC-4, AC-7)**
- Exports (suggested; names are free, behaviour is the contract): `PLACEHOLDER_KEY`, `validateInputs(records) -> {ok, values} | {ok:false, name, reason}` (uses `resolveSettings` per field; control-char check for apiKey), `refersToAzdoPlugin(entry): boolean`, `renderFresh(templateText, values, apiKey|undefined) -> text` (7 exact-once token replacements, LF-normalised, re-parse + deep-equal check, throws a fixed internal error on drift), `planUpdate(existing: object, values, apiKey|undefined) -> {result, changed, droppedOptions: string[]} | {error: fixedCode}`, `renderUpdated(result) -> text` (fixed 2-line header + `JSON.stringify(result, null, 2) + "\n"`).
- Must not mutate its input. It may create `provider`/`bifrost`/`options` objects when they are absent. If any of them exists but is not a plain object, or if `plugin` is not an array, return an error code.
- Tests `test/installer/personal-config-edit.test.ts`:
  - fresh render with and without a key, re-parsed with `__internals.parseJsonc`. Template comments are kept. Exactly one azdo entry with the expected options in key order.
  - update keeps `model`, `provider.other`, `headers`, `my-other-plugin` and the order. Several outdated azdo entries in string and tuple form (`./plugin/azdo-remote-config.ts`, `file:///x/azdo-remote-config.js`) collapse to one at the first index. `apiKey` is kept when no key is given, replaced when a key is given, and set to the placeholder when absent.
  - `pat`/`timeoutMs` are reported in `droppedOptions` by name.
  - idempotency: `planUpdate` applied to its own output reports `changed: false`.
  - non-object `plugin`/`provider` values give errors.
  - invalid org (`a/b`), branch (`a..b`), mode (`x`) and apiKey with `\n` are rejected. The reason contains no input value.
  - path `kilo.jsonc` normalises to `/kilo.jsonc`.
  - the input object is unchanged (deep-equal to a clone).
  - a fake secret built at runtime never appears in an error or reason.

**BE-3. `installer/install-helper.ts` (Node CLI, all I/O; AC-1..AC-7)**
- Read stdin asynchronously (`for await` over `process.stdin`, 64 KiB cap). Parse the NUL records (contract section 4). Validate through BE-2.
- `configDir`: `XDG_CONFIG_HOME` (absolute required, otherwise exit 2) or `join(os.homedir(), ".config", "kilo")`.
- Read-only phase: `lstat` `configDir`, `azdo/`, the plugin destination and `kilo.jsonc` (a wrong type or symlink exits 3). Read sources via `new URL("../plugin/azdo-remote-config.ts", import.meta.url)` and `../personal-config/kilo.jsonc` (missing exits 3). Read the existing `kilo.jsonc` (1 MiB cap, `parseJsonc`, root a plain object). Plan the result. Check `plugin/` and `plugins/` for `azdo-remote-config.*` (warning only). If `kilo.json`, `opencode.json`, `opencode.jsonc` or `config.json` exists in `configDir` (regular file of 1 MiB or less) and its text contains `azdo-remote-config`, print a warning naming the file.
- Write phase, in order: `mkdir` (0700, recursive; POSIX: strip g/o write bits from an existing `configDir` and `azdo/`). Plugin copy only if the bytes differ (temp `wx` 0644 then rename). If the config changed and existed before: backup `kilo.jsonc.bak-<yyyyMMddTHHmmssZ>` with `-n` suffix on collision, `wx` 0600, original bytes. Config write: temp `wx` 0600, rename, then POSIX `chmod 0600`. If unchanged: still POSIX `chmod 0600` when the mode differs. Never create anything under `plugin/` or `plugins/`.
- Output exactly as in contract section 7. A top-level `try/catch` maps every error to a fixed message (fs `err.code` may be appended only if it matches `/^[A-Z0-9_]+$/`), and the process exits 2 or 3. Never print values, file content or stacks.

**BE-4. `installer/install.sh` (AC-1, AC-2, AC-5, AC-7)**
- `#!/usr/bin/env bash`, `set -euo pipefail`, LF only, bash 3.2 compatible. **Only builtins plus `node` and `az`** (no `dirname`, `cat`, `date`, `mkdir`, etc.; the tests enforce this because PATH holds only stubs). Never use `set -x` and never `eval`. Quote every expansion.
- Scan for `-h`/`--help` first. Parse `--org|--project|--repo|--path|--branch|--mode <value>`. Anything else gives exit 2 with `install.sh: error: unknown option or argument.` plus `Run install.sh --help for usage.`, and the argument text is never echoed.
- Merge flag > `KILO_AZDO_*` > default. Missing org/project/repo gives exit 2 naming `--org (or KILO_AZDO_ORG)` etc.
- Prerequisites (collect every failure, then exit 1): `command -v node`; version from `node -p process.versions.node` (strip `\r`, compare major/minor with >= 22.18 using parameter expansion). Credentials: PAT env non-empty, or `command -v az` and `az account show --output none >/dev/null 2>&1`. Use the fixed messages from contract section 7.
- Script dir: `src=${BASH_SOURCE[0]}; case $src in */*) d=${src%/*};; *) d=.;; esac; d=$(cd "$d" && pwd)`.
- Last command: `printf '%s\0' "org=$org" "project=$project" "repo=$repo" "path=$path" "branch=$branch" "mode=$mode" "apiKey=${KILO_BIFROST_KEY:-}" | node "$d/install-helper.ts"`. With `pipefail`, the script exits with the helper's code.

**BE-5. `test/installer/helpers.ts` + `test/installer/install-sh.test.ts` (AC-1..AC-8)**
- `findBash()`: use `KILO_TEST_BASH` if set. Otherwise scan `process.env.PATH` for `bash` (POSIX) or `bash.exe` (win32), skipping directories containing `\windows\system32` or `windowsapps` (case-insensitive). If none is found, the test fails (it is not skipped).
- `sandbox()`: `mkdtemp` with `<tmp>/home`, `<tmp>/bin`, `<tmp>/xdg`. `<tmp>/bin/node` = `#!/bin/sh\nexec "<execPath with / separators>" "$@"\n`. `stubAz(mode: "ok"|"fail")` writes `<tmp>/bin/az` (`account show` exits 0 or 1, every invocation is appended to `<tmp>/az.log`), chmod 0755. Always `rmSync` in `finally`.
- `runInstall(args, extraEnv)`: `spawnSync(bash, [installShPath, ...args], {env, encoding: "utf8"})`. `env` is built from scratch: `PATH=<tmp>/bin`, `HOME`, and on Windows also `USERPROFILE`, `SYSTEMROOT`, `TEMP`/`TMP` pointing at `<tmp>/t`. `process.env` is never spread in.
- `snapshot(dir)`: recursive map of relative path to bytes (and mode on POSIX).
- Cases:
  - **AC-1** fresh install: exit 0. The plugin is byte-identical. Parsed config has exactly one azdo tuple with the supplied org/project/repo plus `/kilo.jsonc`/`main`/`defaults`, and `apiKey` equals the key. Mode 0600 (skipped on Windows). Also XDG: files under `<xdg>/kilo` and nothing under `HOME`.
  - **AC-2** `KILO_BIFROST_KEY=FAKE_SECRET` and `AZDO_PAT=SENTINEL`: stdout and stderr contain neither, nor `SECRET_TAIL`. Key unset: placeholder written, output matches `/virtual key/i` and `KILO_BIFROST_KEY`. Also `--key x` is rejected (exit 2) and `x` is not echoed.
  - **AC-3** existing commented config (built in the test, using `FAKE_SECRET`-free `sk-bf-existing`) with and without a key; deep-equal checks; one backup byte-identical (`kilo.jsonc.bak-*`).
  - **AC-4** after fresh and update runs, `<configDir>/plugin` and `plugins` do not exist and the raw text contains `azdo-remote-config.ts` exactly once. A pre-existing `plugin/azdo-remote-config.ts` gives a warning and is left untouched.
  - **AC-5** no az and no PAT; stub az `fail`; Node too old (node wrapper printing `20.11.0` for `-p`). Each case: exit 1, stderr matches `/az login/` and `/AZDO_PAT/` (or `/Node\.js 22\.18/`), and the `HOME` snapshot is unchanged (empty). With `AZDO_PAT` set and no az: exit 0, and `az.log` is absent when the stub exists.
  - **AC-6** running twice: second exit 0, recursive snapshot of `configDir` equal, backup count unchanged. Do this for both fresh and update starting points.
  - **AC-7** missing org/project/repo (each, exit 2, names the input), unknown flag, flag without value, invalid JSONC, array root, `plugin: {}`, relative `XDG_CONFIG_HOME`, symlinked `kilo.jsonc` (POSIX only; skipped on Windows). All give non-zero exit, no `/\n\s+at /` stack, file text not echoed (put a sentinel in the file), and the pre-existing snapshot is byte-identical.
  - **AC-8 / lint**: `install.sh` has no `\r` byte and `bash -n install.sh` exits 0.
- POSIX mode assertions use `t.skip("POSIX permissions are not enforced on Windows")` when `process.platform === "win32"`.

**Must not change:** `backend/plugin/azdo-remote-config.ts`, `backend/personal-config/kilo.jsonc`, the validator, `package.json` (no `dependencies`, no new devDependencies, no new scripts needed).

## Frontend tasks
None. `frontend/` does not exist (no UI, ADR-0001).

## Notes for Security engineer
- Secrets: the key reaches the helper only via stdin (bash builtin `printf`), not via argv. PAT values are only tested for emptiness. Output must never contain the key, a PAT, unknown argument text or config content. Check AC-2 tests and every `console.*` call in the helper.
- File safety: read-only validation comes before writes. `wx` temp files plus rename. Backups are byte-identical and 0600. Config 0600, dirs 0700, g/o write bits stripped. `lstat` refuses symlinks (prevents a write-through to an attacker-chosen target). Size caps.
- Input validation reuses the plugin's own setting rules, so the installer cannot write a value the plugin would reject. Control characters in the key are rejected.
- AC-12: nothing is written to the auto-loaded `plugin/`/`plugins/` dirs. Existing copies trigger a warning.
- bash hygiene: no `eval`, no `set -x`, everything quoted, no external commands except `node`/`az`.
- Accepted residual risks: `KILO_BIFROST_KEY` is inherited by the `az` and `node` child environments (it was already in the user's env). The helper runs Node from the user's PATH.

## Notes for CI releaser
- No change to `scripts/ci.sh` is required: `npm test` picks up `test/installer/`. Optional: run `shellcheck backend/installer/install.sh` when `command -v shellcheck` succeeds (it is preinstalled on ubuntu-latest), and extend `scripts/check-lf.sh` to `backend/installer/*.sh`. `.gitattributes` already forces LF for `*.sh`, and a test also checks it.

## Files changed
- `docs/architecture/ADR-0012-posix-bootstrap-installer.md`: new ADR.
- `docs/architecture/contracts/installer-cli.md`: new contract 1.0.0.
- `docs/architecture/ADR-0001-tech-stack.md`: lint rule 6, tsconfig include, layout line.
- `docs/architecture/overview.md`: C5 row, install data flow, layout, quality gate.
- `docs/architecture/README.md`: contract index.

## Verification
- Docs only. Checked that no stray NUL bytes are in the docs (one was introduced into overview.md during editing and fixed). Locally confirmed: Node v24.15.0 and bash 5.3 (MSYS) on the dev machine; `shellcheck` is not installed locally, hence optional.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Kilo follows OpenCode/`xdg-basedir`: `$XDG_CONFIG_HOME/kilo` else `~/.config/kilo`, and relative plugin specs resolve against the config file's dir. This is consistent with ADR-0001 section 5, and Phase 0 re-checks it.
- Node >= 22.18 is required to run the installer, because the helper is `.ts` and imports the plugin. Kilo is npm-distributed, so Node is present. Older versions get a fix message.
- Symlinked `kilo.jsonc` and `azdo/` targets are refused instead of followed. This is conservative for safety, and docs should mention it.
- Old azdo entry options `pat`/`timeoutMs` are dropped on update (names reported). This keeps PATs out of the file (FR-3).
- No `--source-dir` option. Script-relative layout only (YAGNI).
- Running as root is not blocked.

## Follow-ups for the backlog
- F-011: reuse `install-helper.ts` via the stdin protocol. It only needs PowerShell prereqs plus ACLs.
- F-019: smoke test runs after a successful `install.sh`. It could add a `--smoke` flag or a separate script.
- Docs (F-016): document the symlink refusal, the comment loss on update plus the backup, the Node 22.18 requirement and XDG.
- CI: optional shellcheck and `check-lf` coverage for `backend/installer/*.sh`.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0011/02-architect.md
summary: install.sh (bash front end, builtins+node+az) + Node helper reusing parseJsonc/resolveSettings via NUL stdin records; ADR-0012, contract installer-cli 1.0.0, lint rule 6; 5 backend tasks.
