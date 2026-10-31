# Contract: bootstrap installer (`install.sh`) and install helper

- Version: 1.0.0 (cycle-0011, F-010). Decision record: ADR-0012.
- Files: `backend/installer/install.sh` (bash front end), `backend/installer/install-helper.ts`
  (Node CLI, all file I/O), `backend/installer/personal-config-edit.ts` (pure library).
- Inputs read from the repo tree (relative to the helper): `../plugin/azdo-remote-config.ts`,
  `../personal-config/kilo.jsonc`. Neither file is modified.
- Consumers: engineers (macOS, Linux), tests (Linux CI, Windows Git Bash), F-011 `install.ps1`
  (reuses the helper via section 4), F-019 smoke test (runs after a successful install).

## 1. Command line

```
bash install.sh --org <org> --project <project> --repo <repo>
                [--path <path>] [--branch <branch>] [--mode defaults|enforce]
bash install.sh --help | -h
```

| Argument | Contract |
|---|---|
| `--org`, `--project`, `--repo`, `--path`, `--branch`, `--mode` | Take the **next** argument as value (`--org=x` form is NOT supported and is an unknown option). Repeating a flag: last one wins. A flag as the last argument (no value) is a usage error. |
| `--help`, `-h` | Print the usage text to stdout, exit 0. No checks, no writes. Takes effect wherever it appears (scanned first). |
| Anything else (unknown flag, `--key`, `--api-key`, positional argument) | Usage error. **The offending argument text is never echoed** (it may be a secret). |

There is deliberately **no flag for the virtual key** and no flag for a PAT.

## 2. Environment inputs

| Variable | Use |
|---|---|
| `KILO_AZDO_ORG`, `KILO_AZDO_PROJECT`, `KILO_AZDO_REPO` | Used when the matching flag is absent. A flag always wins. An empty value counts as absent. |
| `KILO_AZDO_PATH`, `KILO_AZDO_BRANCH`, `KILO_AZDO_MODE` | Same; when both flag and env are absent the defaults are `/kilo.jsonc`, `main`, `defaults`. |
| `KILO_BIFROST_KEY` | The engineer's Bifrost virtual key. Non-empty: written to `provider.bifrost.options.apiKey`. Empty/unset: existing `apiKey` kept, or the placeholder `sk-bf-<your-virtual-key>` written when there is none. Never printed. |
| `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`, `KILO_AZDO_PAT` | Only tested for non-emptiness by the prerequisite check. Never read otherwise, never printed, never written to a file. |
| `XDG_CONFIG_HOME` | Read by the helper. Non-empty and absolute: config dir is `$XDG_CONFIG_HOME/kilo`. Non-empty and relative: usage error (exit 2). Unset/empty: `<os.homedir()>/.config/kilo`. |
| `HOME` (POSIX), `USERPROFILE` (Windows) | Via Node `os.homedir()`. |

## 3. Processing order and exit codes

1. `install.sh`: scan for `--help`; parse flags (usage error -> exit 2).
2. `install.sh`: merge flags > env > default; if org, project or repo is missing -> exit 2, naming
   each missing input as `--org (or KILO_AZDO_ORG)` etc.
3. `install.sh`: prerequisites (all checked, all failures reported) -> exit 1:
   - `node` on PATH and `process.versions.node` >= 22.18;
   - one of `AZDO_PAT` / `AZURE_DEVOPS_EXT_PAT` / `KILO_AZDO_PAT` non-empty (then `az` is NOT run),
     otherwise `az` on PATH and `az account show --output none` exits 0 (its stdout/stderr discarded).
4. `install.sh`: `printf '%s\0' <records> | node "<script dir>/install-helper.ts"`; its exit code is
   the script's exit code.
5. Helper, **read-only phase**: read and validate stdin records; validate values; resolve config
   dir; `lstat` targets; read source plugin and template; read, size-check and parse existing
   `kilo.jsonc`; compute the planned content. Any failure -> exit 2 (invalid input) or 3, no writes.
6. Helper, **write phase** (only what changed): create dirs, fix dir modes, copy plugin, write
   backup, write personal config. Failure -> exit 3, temp files removed.

| Code | Meaning |
|---|---|
| 0 | Installed, updated, or already up to date. Warnings allowed. |
| 1 | A prerequisite is missing (Node / Node version / credentials). Nothing written. |
| 2 | Usage or input error: unknown option, missing value, missing org/project/repo, a value rejected by the plugin's setting rules, `KILO_BIFROST_KEY` containing control characters, relative `XDG_CONFIG_HOME`. Nothing written. |
| 3 | Existing config or file system problem: existing `kilo.jsonc` not valid JSONC / root not an object / larger than 1 MiB / `plugin` present but not an array / `provider`, `provider.bifrost` or `provider.bifrost.options` present but not a plain object / a target is a symlink or wrong type / I/O error / installer sources missing / internal error. Nothing written when detected in the read-only phase. |

## 4. Helper stdin protocol (shared with F-011)

- stdin: UTF-8, a sequence of records, each `name=value` terminated by one NUL byte. At most 64 KiB.
- Names (each exactly once, in any order): `org`, `project`, `repo`, `path`, `branch`, `mode`,
  `apiKey`. `apiKey` may be empty (= no key supplied); the other six are non-empty (the front end
  applies defaults before sending).
- Missing, duplicate or unknown names, a record without `=`, data after the last NUL, or more than
  64 KiB -> exit 3 with `install.sh: error: internal error (bad helper input)`.
- The helper reads no other input from the environment except `XDG_CONFIG_HOME` and what
  `os.homedir()` uses.
- Value validation (exit 2): each of the six settings is checked alone with
  `__internals.resolveSettings({ <name>: value }, { env: {} })`; any `warnings` entry rejects it with
  `install.sh: error: invalid value for --<name>: <reason>` where `<reason>` is the fixed tail of the
  warning (e.g. `contains characters or segments that are not allowed.`). The **normalised** value
  (`settings.<name>`, trimmed; `path` gains a leading `/`) is what gets written.
  `apiKey`: rejected if it contains a control character (`<= 0x1F`, `0x7F`); otherwise used as-is.
  A non-empty key not starting with `sk-bf-` gives a warning (no value echoed).

## 5. Personal config rules

Let `entry = ["./azdo/azdo-remote-config.ts", {org, project, repo, path, branch, mode}]` (option
keys in this order, normalised values, never `pat` / `timeoutMs`).

An existing plugin entry **refers to azdo-remote-config** when its spec (the entry itself if it is a
string, or element `[0]` if it is an array whose `[0]` is a string) has a last segment (split on
`/` and `\`) matching `^azdo-remote-config(\.(ts|mts|js|mjs))?$`.

**Fresh** (`<configDir>/kilo.jsonc` does not exist): template text with the seven token
replacements of ADR-0012 section 5 (`apiKey` replaced only when a key was supplied). The output
keeps the template's comments and line endings normalised to LF.

**Update** (exists, regular file, <= 1 MiB, parses, root plain object):
1. `plugin` absent -> `[entry]`. Present and not an array -> exit 3. Otherwise remove every entry
   that refers to azdo-remote-config and insert `entry` at the index of the first removed entry, or
   append it. Every other entry keeps its value and relative order.
2. `provider.bifrost.options.apiKey`: key supplied -> set to the key. No key and an `apiKey` property
   exists (any value) -> unchanged. No key and none exists -> placeholder. Missing `provider`,
   `bifrost`, `options` objects are created; present but not plain objects -> exit 3.
3. Every other key at every level is left exactly as parsed (deep-equal). `$schema` is not added.
4. If the result `util.isDeepStrictEqual`s the parsed original: **no write, no backup**.
5. Otherwise: backup (byte-identical, section 6), then write
   `// Personal Kilo configuration (C3). Rewritten by install.sh: comments were not preserved.\n`
   `// The previous version is saved next to this file as kilo.jsonc.bak-<timestamp>.\n`
   followed by `JSON.stringify(result, null, 2) + "\n"`.
6. Names (never values) of options dropped from an old azdo entry are reported on stdout, e.g.
   `Note: dropped plugin options from the previous entry: pat, timeoutMs`.

The resulting file always contains exactly one entry that refers to azdo-remote-config (AC-12).

## 6. Files, modes, backups

| Path | When written | Mode (POSIX) |
|---|---|---|
| `<configDir>/` | created if missing | `0700` when created; existing: group/other write bits removed |
| `<configDir>/azdo/` | created if missing | `0700` when created; existing: group/other write bits removed |
| `<configDir>/azdo/azdo-remote-config.ts` | when missing or bytes differ from source | `0644` |
| `<configDir>/kilo.jsonc` | fresh, or update with a semantic change | `0600` (chmod after every run if it differs, even without a content change) |
| `<configDir>/kilo.jsonc.bak-<yyyyMMddTHHmmssZ>[-n]` | immediately before modifying an existing `kilo.jsonc` | `0600`, created with `wx`, exact original bytes |
| `<configDir>/plugin/`, `<configDir>/plugins/` | **never** | - |

- Timestamp is UTC. Collision -> suffix `-1`, `-2`, ... (first free name, `wx` guarantees no overwrite).
- Writes: temp file `.<name>.tmp-<pid>-<random hex>` in the target dir (`wx`, final mode), then
  `rename`. On error the temp file is removed.
- `lstat`: existing `kilo.jsonc` or plugin destination must be a regular file, existing `azdo/` and
  `<configDir>` must be directories (not symlinks) -> else exit 3,
  `install.sh: error: <path> is not a regular file or directory (symlinks are not followed); update it manually.`
- On Windows (`process.platform === "win32"`) no `chmod` is performed.

## 7. Output

stdout (informational, fixed wording, paths allowed; normative content in brackets):
```
Installed plugin: <path>                         | Plugin already up to date: <path>
Created personal config: <path>                  | Updated personal config: <path>
Backup of the previous personal config: <path>   (only when a backup was written)
Personal config already up to date: <path>
Note: dropped plugin options from the previous entry: <names>
Set your Bifrost virtual key: re-run with KILO_BIFROST_KEY set, or edit provider.bifrost.options.apiKey in <path>.
                                                 (whenever apiKey equals the placeholder after the run)
Done.
```
stderr:
```
install.sh: error: <fixed reason>          # followed by "Run install.sh --help for usage." on exit 2
install.sh: warning: <fixed reason>
```
Fixed prerequisite messages (must contain these fixes):
- Node missing: `Node.js was not found on PATH. Install Node.js 22.18 or later and re-run.`
- Node old: `Node.js 22.18 or later is required (found <version>).`
- No credentials, no az: `No Azure DevOps credentials: install the Azure CLI and run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope.`
- az present, not logged in: `The Azure CLI is not logged in: run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope.`
- `plugin/` or `plugins/` holds `azdo-remote-config.*` (warning): `<path> is auto-loaded by Kilo and would load the plugin twice; remove it.`
- Existing invalid config: `<path> is not valid JSONC (<parser message>); fix or move it, then re-run.` (the parser message contains only line/column, ADR-0003)

**Never printed**: the value of `KILO_BIFROST_KEY`, any PAT, any argument text of an unknown option,
any content of an existing config file, stack traces. All errors are caught at the top of the
helper and mapped to a fixed message.

## 8. Not part of the contract

- The FR-22 smoke test (F-019).
- Windows ACLs (F-011).
- Comment preservation on update.
