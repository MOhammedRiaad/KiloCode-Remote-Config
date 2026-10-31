# Contract: bootstrap installer (`install.sh`) and install helper

- Version: 1.1.0 (cycle-0013, F-019: smoke test, `--no-smoke`, exit code 4, optional `smoke`
  stdin record). 1.0.0: cycle-0011, F-010. Decision records: ADR-0012, ADR-0013.
- Files: `backend/installer/install.sh` (bash front end), `backend/installer/install-helper.ts`
  (Node CLI, all file I/O), `backend/installer/personal-config-edit.ts` (pure library),
  `backend/installer/smoke.ts` (smoke checks, injectable deps; since 1.1.0).
- Inputs read from the repo tree (relative to the helper): `../plugin/azdo-remote-config.ts`,
  `../personal-config/kilo.jsonc`. Neither file is modified.
- Consumers: engineers (macOS, Linux), tests (Linux CI, Windows Git Bash), F-011 `install.ps1`
  (reuses the helper via section 4), F-019 smoke test (runs after a successful install).

## 1. Command line

```
bash install.sh --org <org> --project <project> --repo <repo>
                [--path <path>] [--branch <branch>] [--mode defaults|enforce] [--no-smoke]
bash install.sh --help | -h
```

| Argument | Contract |
|---|---|
| `--org`, `--project`, `--repo`, `--path`, `--branch`, `--mode` | Take the **next** argument as value (`--org=x` form is NOT supported and is an unknown option). Repeating a flag: last one wins. A flag as the last argument (no value) is a usage error. A value that looks like a flag (e.g. `--org --no-smoke`) is still taken as the value. |
| `--no-smoke` | (1.1.0) No value. Skips the smoke test (section 9): no smoke request, no az token call for it, no `smoke` line, exit code per F-010 (0-3). May appear anywhere, repeatable. `--no-smoke=x` is an unknown option. |
| `--help`, `-h` | Print the usage text to stdout, exit 0. No checks, no writes. Takes effect wherever it appears (scanned first). |
| Anything else (unknown flag, `--key`, `--api-key`, positional argument) | Usage error. **The offending argument text is never echoed** (it may be a secret). |

There is deliberately **no flag for the virtual key** and no flag for a PAT.

## 2. Environment inputs

| Variable | Use |
|---|---|
| `KILO_AZDO_ORG`, `KILO_AZDO_PROJECT`, `KILO_AZDO_REPO` | Used when the matching flag is absent. A flag always wins. An empty value counts as absent. |
| `KILO_AZDO_PATH`, `KILO_AZDO_BRANCH`, `KILO_AZDO_MODE` | Same; when both flag and env are absent the defaults are `/kilo.jsonc`, `main`, `defaults`. |
| `KILO_BIFROST_KEY` | The engineer's Bifrost virtual key. Non-empty: written to `provider.bifrost.options.apiKey`. Empty/unset: existing `apiKey` kept, or the placeholder `sk-bf-<your-virtual-key>` written when there is none. Never printed. |
| `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`, `KILO_AZDO_PAT` | `install.sh` only tests them for non-emptiness (prerequisite check). Since 1.1.0 the helper reads them **in the smoke phase only** and hands them solely to the plugin's `resolveSettings` / `fetchRemoteConfig` (FR-3 order). Never printed, never written to a file, never in argv. |
| `KILO_AZDO_TIMEOUT_MS` | (1.1.0) Read by the helper in the smoke phase only, through `resolveSettings`: per-check timeout, default 5000 ms; invalid values silently fall back to the default. |
| `PATH`, `ComSpec` | Used by the plugin's default `az` runner in the smoke phase when no PAT is set. |
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
7. Helper, **smoke phase** (1.1.0; only when the write phase succeeded and the `smoke` record is
   `on`): checks `azdo` then `bifrost` (section 9). Writes nothing, never modifies or undoes the
   installation. Any check `fail` -> exit 4; otherwise exit 0.

| Code | Meaning |
|---|---|
| 0 | Installed, updated, or already up to date. Warnings allowed. Smoke test (if run): every check `pass` or `skipped`. |
| 1 | A prerequisite is missing (Node / Node version / credentials). Nothing written. |
| 2 | Usage or input error: unknown option, missing value, missing org/project/repo, a value rejected by the plugin's setting rules, `KILO_BIFROST_KEY` containing control characters, relative `XDG_CONFIG_HOME`. Nothing written. |
| 3 | Existing config or file system problem: existing `kilo.jsonc` not valid JSONC / root not an object / larger than 1 MiB / `plugin` present but not an array / `provider`, `provider.bifrost` or `provider.bifrost.options` present but not a plain object / a target is a symlink or wrong type / I/O error / installer sources missing / internal error. Nothing written when detected in the read-only phase. |
| 4 | (1.1.0) Installed exactly as for exit 0, but at least one smoke check failed. The files are byte-identical to those of a run with the same inputs that exits 0. Never returned with `--no-smoke`. |

## 4. Helper stdin protocol (shared with F-011)

- stdin: UTF-8, a sequence of records, each `name=value` terminated by one NUL byte. At most 64 KiB.
- Names (each exactly once, in any order): `org`, `project`, `repo`, `path`, `branch`, `mode`,
  `apiKey`. `apiKey` may be empty (= no key supplied); the other six are non-empty (the front end
  applies defaults before sending).
- (1.1.0) Optional record `smoke`, at most once, value exactly `on` or `off`. Absent = `off`
  (a 1.0.0 front end gets no smoke test). `install.sh` always sends it (`on` unless `--no-smoke`).
- Missing, duplicate or unknown names, a record without `=`, a `smoke` value other than `on` /
  `off`, data after the last NUL, or more than 64 KiB -> exit 3 with
  `install.sh: error: internal error (bad helper input)`.
- The helper reads no other input from the environment except `XDG_CONFIG_HOME`, what
  `os.homedir()` uses and, in the smoke phase only, `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`,
  `KILO_AZDO_PAT`, `KILO_AZDO_TIMEOUT_MS` (plus `PATH` / `ComSpec` through the plugin's az runner).
  It never reads `KILO_BIFROST_KEY` or the other `KILO_AZDO_*` variables.
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
smoke azdo: <result>                             (1.1.0, smoke phase only, section 9)
smoke bifrost: <result>
Smoke test: set KILO_BIFROST_KEY and re-run install.sh to check your Bifrost virtual key.
                                                 (only after "smoke bifrost: skipped no-key")
Done.                                            (exit 0 and exit 4)
```
stderr:
```
install.sh: error: <fixed reason>          # followed by "Run install.sh --help for usage." on exit 2
install.sh: warning: <fixed reason>
install.sh: error: smoke test failed; the installation was kept.     # exit 4 only
```
Fixed prerequisite messages (must contain these fixes):
- Node missing: `Node.js was not found on PATH. Install Node.js 22.18 or later and re-run.`
- Node old: `Node.js 22.18 or later is required (found <version>).`
- No credentials, no az: `No Azure DevOps credentials: install the Azure CLI and run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope.`
- az present, not logged in: `The Azure CLI is not logged in: run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope.`
- `plugin/` or `plugins/` holds `azdo-remote-config.*` (warning): `<path> is auto-loaded by Kilo and would load the plugin twice; remove it.`
- Existing invalid config: `<path> is not valid JSONC (<parser message>); fix or move it, then re-run.` (the parser message contains only line/column, ADR-0003)

**Never printed**: the value of `KILO_BIFROST_KEY` or of the effective `apiKey`, any PAT, its
Basic credential, any az token, any argument text of an unknown option, any content of an existing
config file or of the fetched shared config, any fetch error text or HTTP response body, stack
traces. All errors are caught at the top of the helper and mapped to a fixed message.

## 8. Not part of the contract

- Windows ACLs (F-011).
- Comment preservation on update.
- Resolving `{env:}` / `{file:}` placeholders in the shared `baseURL` or the personal `apiKey`
  during the smoke test.

## 9. Smoke test (1.1.0, FR-22 / AC-10; ADR-0013)

Runs in the helper after a successful write phase when the `smoke` record is `on`. Inputs: the
normalised `org/project/repo/path/branch` of this install; `settings = resolveSettings(values,
{ env })` and `fetchRemoteConfig(settings, { env })` with `env` = only `AZDO_PAT`,
`AZURE_DEVOPS_EXT_PAT`, `KILO_AZDO_PAT`, `KILO_AZDO_TIMEOUT_MS` copied from the process env;
`timeoutMs = settings.timeoutMs` (default 5000) per check; the **effective key** = the `apiKey` the
personal config holds after this run (fresh: `KILO_BIFROST_KEY` or the placeholder; update: the
supplied key, else the existing value).

Result line format: `smoke <check>: pass` | `smoke <check>: fail <code>` |
`smoke <check>: skipped <code>`. Checks run and print in the order `azdo`, `bifrost`.

### 9.1 `azdo`

| Condition | Line |
|---|---|
| `fetchRemoteConfig` returns `ok: false` with code `c` | `smoke azdo: fail <c>`, `c` in `invalid-settings`, `auth-unavailable`, `timeout`, `too-large`, `bad-response`, `network`, `http-<status>` (e.g. `http-404`) |
| text does not parse with `__internals.parseJsonc` | `smoke azdo: fail invalid-jsonc` |
| root is not a plain object | `smoke azdo: fail invalid-shape` |
| unexpected exception | `smoke azdo: fail internal` |
| otherwise | `smoke azdo: pass` |

The request is exactly the plugin's (FR-2/FR-3, ADR-0007): `https://dev.azure.com/<org>/<project>/_apis/git/repositories/<repo>/items?path=<path>&versionDescriptor.version=<branch>&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`,
`Authorization: Basic base64(":"+PAT)` or `Bearer <az token>`, one deadline, 1 MiB cap.

### 9.2 `bifrost`

Evaluated in this order; the first matching row decides. Only the last two rows send a request.

| # | Condition | Line |
|---|---|---|
| 1 | azdo is not `pass` | `smoke bifrost: skipped azdo-failed` |
| 2 | shared `provider.bifrost.options.baseURL` is not an own string property of plain objects | `smoke bifrost: fail no-base-url` |
| 3 | `new URL(baseURL.trim())` throws, or the URL has a username, password, query or fragment | `smoke bifrost: fail invalid-base-url` |
| 4 | protocol is not `https:` | `smoke bifrost: fail insecure-base-url` |
| 5 | effective key is not a string, is empty, or equals `sk-bf-<your-virtual-key>` | `smoke bifrost: skipped no-key` (+ the `Smoke test: set KILO_BIFROST_KEY ...` line) |
| 6 | effective key contains `{env:` or `{file:` | `smoke bifrost: skipped key-reference` |
| 7 | effective key is longer than 4096 chars or has a char outside 0x21-0x7E | `smoke bifrost: fail invalid-key` |
| 8 | request made (below) and fails | `smoke bifrost: fail <code>` |
| 9 | request made, 2xx, body is UTF-8 JSON with a plain-object root, <= 1 MiB | `smoke bifrost: pass` |

Request (exactly one): `GET <models URL>` where the models URL is the parsed baseURL with every
trailing `/` removed from its pathname and `/models` appended
(`https://bifrost.yourcompany.internal/v1` -> `https://bifrost.yourcompany.internal/v1/models`);
headers exactly `Accept: application/json` and `Authorization: Bearer <effective key>`;
`redirect: "manual"`; one AbortController and one `timeoutMs` timer for request and body.
Fail codes (row 8): HTTP status outside 200-299 -> the bare status number (e.g. `fail 401`,
`fail 302`; redirects are not followed); status not an integer 100-599 or body not JSON object ->
`bad-response`; declared `content-length` > 1 MiB or more than 1048576 bytes read -> `too-large`;
deadline reached -> `timeout`; any throw / rejection -> `network`; unexpected exception ->
`internal`. The key is never sent anywhere else (not to AzDO, not to a non-https URL); the PAT /
az token is never sent to Bifrost.

### 9.3 Outcome

- Any `fail` -> stderr `install.sh: error: smoke test failed; the installation was kept.`, exit 4.
- Otherwise exit 0. `skipped` never fails the run.
- Time bound: at most about `2 x timeoutMs` (plus process overhead).
- The smoke phase writes no file (no cache, no log) and never alters the installed files.
