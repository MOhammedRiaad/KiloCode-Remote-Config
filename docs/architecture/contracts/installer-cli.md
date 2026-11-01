# Contract: bootstrap installers (`install.sh`, `install.ps1`) and install helper

- Version: 1.3.2 (cycle-0024, T-035: (a) the fixed network hint of section 7 is also printed,
  at most once, when the pre-flight passed but an authenticated line failed for a network
  reason (`smoke azdo: fail network-unreachable|network-blocked|timeout`,
  `smoke bifrost: fail network|timeout|407|470`); exact rule in section 9.4; (b) a probe answer
  of HTTP 470 (Azure Firewall application-rule deny, community-reported) is `blocked` (section
  9.0), so no credential is sent after it. No new input, line format, hint text, code or exit
  code. Decision record: ADR-0019 amendment A1, ADR-0020 amendment A1.)
  1.3.1: cycle-0023, F-021: section 9.1 lists the plugin codes `network-unreachable`
  and `network-blocked` (plugin-interface 0.9.0, ADR-0020) that `smoke azdo: fail <c>` passes
  through verbatim. Informative only: no change to `smoke.ts`, inputs, lines, hints or exit codes.
  1.3.0: cycle-0022, F-020: the smoke test starts each target with an unauthenticated
  network pre-flight probe and prints a first line `smoke network: ...`, a new skip code
  `network-blocked` and a fixed VPN / allow-list hint (sections 7 and 9.0); time bound
  `4 x timeoutMs` (9.3). No new input, flag, record or exit code. Decision record: ADR-0019.)
  1.2.1: cycle-0020, T-019: `install.sh` resolves its directory CDPATH-safe and exits 3
  with a fixed message when `install-helper.ts` is missing (section 3 step 4); the helper re-checks
  its targets for symlinks after creating directories and changes modes only through
  `O_NOFOLLOW` descriptors (section 6). No new input, record or exit code.
  1.2.0: cycle-0014, F-011: `install.ps1` front end (section 10), optional `frontend`
  stdin record, front-end-specific message prefix. 1.1.0: cycle-0013, F-019 (smoke test,
  `--no-smoke`, exit code 4, optional `smoke` stdin record). 1.0.0: cycle-0011, F-010.
  Decision records: ADR-0012 (amended cycle-0020), ADR-0013 (amended by ADR-0019), ADR-0014,
  ADR-0019.
- Files: `backend/installer/install.sh` (bash front end), `backend/installer/install.ps1`
  (PowerShell front end; since 1.2.0), `backend/installer/install-helper.ts`
  (Node CLI, all file I/O), `backend/installer/personal-config-edit.ts` (pure library),
  `backend/installer/smoke.ts` (smoke checks, injectable deps; since 1.1.0),
  `backend/installer/fs-guard.ts` (target type check with injectable `lstat`; since 1.2.1).
- Inputs read from the repo tree (relative to the helper): `../plugin/azdo-remote-config.ts`,
  `../personal-config/kilo.jsonc`. Neither file is modified.
- Consumers: engineers (macOS, Linux: `install.sh`; Windows: `install.ps1`), tests (Linux CI,
  Windows Git Bash / PowerShell), F-019 smoke test (runs after a successful install).
- Sections 1-9 describe `install.sh` and the helper; section 10 lists what differs for
  `install.ps1`. Everything not listed there (env inputs, processing order, exit codes, helper
  behaviour, files, output) is identical, with `install.ps1` in place of `install.sh` in messages.

## 1. Command line (`install.sh`; `install.ps1`: section 10.1)

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
4. `install.sh`: (1.2.1) script dir = `${BASH_SOURCE[0]%/*}` (or `.` when it has no `/`),
   made absolute with `CDPATH= cd -- "<dir>" && pwd` (CDPATH is ignored, so `cd` never searches
   it and never prints a directory). If that fails or `<script dir>/install-helper.ts` is not a
   regular file (`[ -f ]`): stderr exactly
   `install.sh: error: installer sources are missing (expected install-helper.ts next to install.sh).`
   (one line), exit 3, `node` is not started for the helper, nothing written. Otherwise
   `printf '%s\0' <records> | node "<script dir>/install-helper.ts"`; its exit code is the
   script's exit code.
5. Helper, **read-only phase**: read and validate stdin records; validate values; resolve config
   dir; `lstat` targets; read source plugin and template; read, size-check and parse existing
   `kilo.jsonc`; compute the planned content. Any failure -> exit 2 (invalid input) or 3, no writes.
6. Helper, **write phase** (only what changed): create dirs, (1.2.1) re-check targets for
   symlinks (section 6), fix dir modes, copy plugin, fix the mode of an unchanged `kilo.jsonc`,
   write backup, write personal config. Failure -> exit 3, temp files removed.
7. Helper, **smoke phase** (1.1.0; only when the write phase succeeded and the `smoke` record is
   `on`): (1.3.0) network probe of the AzDO origin, then `azdo`, then (only when the Bifrost
   request would be sent) network probe of the Bifrost origin, then `bifrost` (section 9).
   Writes nothing, never modifies or undoes the installation. Any `fail` (network or check) ->
   exit 4; otherwise exit 0.

| Code | Meaning |
|---|---|
| 0 | Installed, updated, or already up to date. Warnings allowed. Smoke test (if run): every check `pass` or `skipped`. |
| 1 | A prerequisite is missing (Node / Node version / credentials). Nothing written. |
| 2 | Usage or input error: unknown option, missing value, missing org/project/repo, a value rejected by the plugin's setting rules, `KILO_BIFROST_KEY` containing control characters, relative `XDG_CONFIG_HOME`. Nothing written. |
| 3 | Existing config or file system problem: existing `kilo.jsonc` not valid JSONC / root not an object / larger than 1 MiB / `plugin` present but not an array / `provider`, `provider.bifrost` or `provider.bifrost.options` present but not a plain object / a target is a symlink or wrong type / I/O error / installer sources missing / internal error. Nothing written when detected in the read-only phase. |
| 4 | (1.1.0) Installed exactly as for exit 0, but at least one smoke check failed (1.3.0: including `smoke network: fail ...`). The files are byte-identical to those of a run with the same inputs that exits 0. Never returned with `--no-smoke`. |

## 4. Helper stdin protocol (shared with F-011)

- stdin: UTF-8, a sequence of records, each `name=value` terminated by one NUL byte. At most 64 KiB.
- Names (each exactly once, in any order): `org`, `project`, `repo`, `path`, `branch`, `mode`,
  `apiKey`. `apiKey` may be empty (= no key supplied); the other six are non-empty (the front end
  applies defaults before sending).
- (1.1.0) Optional record `smoke`, at most once, value exactly `on` or `off`. Absent = `off`
  (a 1.0.0 front end gets no smoke test). `install.sh` always sends it (`on` unless `--no-smoke`).
- (1.2.0) Optional record `frontend`, at most once, value exactly `install.sh` or `install.ps1`.
  Absent = `install.sh`. `install.sh` does **not** send it (its output is unchanged);
  `install.ps1` always sends `frontend=install.ps1`. Effect, for `install.ps1`, on **messages
  only** (never on file contents, never on exit codes):

  | Message part | `install.sh` (absent) | `install.ps1` |
  |---|---|---|
  | stderr prefix | `install.sh: error:` / `install.sh: warning:` | `install.ps1: error:` / `install.ps1: warning:` |
  | usage hint after exit 2 | `Run install.sh --help for usage.` | `Run install.ps1 -Help for usage.` |
  | setting label in `invalid value for <label>: <reason>` | `--org` `--project` `--repo` `--path` `--branch` `--mode` | `-Org` `-Project` `-Repo` `-Path` `-Branch` `-Mode` |
  | no-key smoke hint | `... and re-run install.sh to check ...` | `... and re-run install.ps1 to check ...` |
  | (1.3.0) network smoke hint | `..., then re-run install.sh.` | `..., then re-run install.ps1.` |

  The update header comment (section 5 step 5) keeps the text `Rewritten by install.sh` for both
  front ends, so personal configs are byte-identical across front ends.
- Missing, duplicate or unknown names, a record without `=`, a `smoke` value other than `on` /
  `off`, a `frontend` value other than `install.sh` / `install.ps1`, data after the last NUL, or
  more than 64 KiB -> exit 3 with `install.sh: error: internal error (bad helper input)` (always
  the `install.sh` prefix: the front end is not known yet).
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
- (1.2.1) **Re-check after `mkdir`**: immediately after creating `<configDir>/azdo/` and before
  any chmod, temp file, backup or rename, the helper `lstat`s again, in this order:
  `<configDir>` (must exist, directory), `<configDir>/azdo` (must exist, directory),
  `<configDir>/azdo/azdo-remote-config.ts` and `<configDir>/kilo.jsonc` (absent or regular file).
  The first failing path gives the same exit 3 and the same message as above; nothing is chmod-ed
  or written, and a symlink's target is never touched.
- (1.2.1) **Mode changes never follow a link** (POSIX): the group/other-write strip of
  `<configDir>` and `azdo/` and the `0600` fix of an unchanged `kilo.jsonc` open the path with
  `O_RDONLY | O_NOFOLLOW` (dirs: `| O_DIRECTORY`; file: `| O_NONBLOCK`), check the type with
  `fstat`, and `fchmod` the descriptor. A link or wrong type found there (`ELOOP`, `ENOTDIR`, not a
  regular file) -> the same exit 3 refusal message. New temp files and backups are `fchmod`-ed
  through the descriptor that created them (`wx`).
- Residual (accepted, ADR-0012 section 6): a swap of `<configDir>` between planning and `mkdir` can
  let `mkdir` create an empty `azdo/` (mode `0700`) inside the link target before the re-check
  refuses; parents of `<configDir>` are never checked (they may legitimately be links).
- On Windows (`process.platform === "win32"`) no `chmod` is performed and no ACL is set (by the
  helper or `install.ps1`): new directories and files inherit the ACL of their parent. Under the
  default `%USERPROFILE%\.config\kilo` that grants access to the user, `SYSTEM` and
  `Administrators` only. When `XDG_CONFIG_HOME` is set, `install.ps1` warns (section 10.4).

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
smoke network: pass | smoke network: fail <code>[,<code>]
                                                 (1.3.0, smoke phase only, always the first smoke line, section 9.0)
smoke azdo: <result>                             (1.1.0, smoke phase only, section 9)
smoke bifrost: <result>
Smoke test: set KILO_BIFROST_KEY and re-run install.sh to check your Bifrost virtual key.
                                                 (only after "smoke bifrost: skipped no-key")
Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run install.sh.
                                                 (1.3.0, only when the network line is "fail" with a code other than "internal";
                                                  1.3.2: also after a qualifying authenticated-line code; at most once; rule: section 9.4)
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
- (1.2.1) Helper missing next to `install.sh` (exit 3): `installer sources are missing (expected install-helper.ts next to install.sh).` (same wording as `install.ps1`, section 10.2 step 5)

**Never printed**: the value of `KILO_BIFROST_KEY` or of the effective `apiKey`, any PAT, its
Basic credential, any az token, any argument text of an unknown option, any content of an existing
config file or of the fetched shared config, any fetch error text or HTTP response body, stack
traces. All errors are caught at the top of the helper and mapped to a fixed message.

## 8. Not part of the contract

- Explicit Windows ACL hardening (inherited ACLs are documented in section 6; ADR-0014 section 8).
- Running `install.ps1` from a pipe (`irm ... | iex`) or from PowerShell ISE.
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
(1.3.0) The line `smoke network: ...` (9.0) is printed before them, always first.

### 9.0 `network` pre-flight (1.3.0, F-020, ADR-0019)

Before the credential-bearing request of a target is sent, the helper sends one
**unauthenticated probe** to that target's origin:

| Target | Probe URL | Sent when |
|---|---|---|
| `azdo` | `https://dev.azure.com/` (constant) | always, first; before `fetchRemoteConfig` (so before any PAT header and before `az` runs) |
| `bifrost` | origin of the models URL + `/` (e.g. `https://bifrost.yourcompany.internal/`; a non-default port is kept) | only when 9.2 rows 1-7 did not match (the `GET <models URL>` would otherwise be sent next) |

Probe request (exactly): `GET <probe URL>`, `headers` = `{}` (no `Authorization`, `api-key`,
`x-api-key`, `Cookie`, `Accept`), no body, `redirect: "manual"` (never followed), one
AbortController and one `timeoutMs` timer per probe. The response body is never read (it is
cancelled). Same fetch function as 9.2 (`globalThis.fetch` at call time in production).

Classification:

| Probe outcome | Verdict | Code |
|---|---|---|
| integer status 100-599 except 403, 407 and 470 (e.g. 200, 204, 301, 302, 401, 404, 405, 500, 503) | reachable | - |
| status 403, 407 or (1.3.2) 470 | blocked | `<target>-blocked` |
| resolved value without an integer status 100-599 | unreachable | `<target>-unreachable` |
| rejection / throw before the deadline (DNS, refused, reset, TLS) | unreachable | `<target>-unreachable` |
| deadline reached | timeout | `<target>-timeout` |
| unexpected exception, injected `fetch` not a function | internal | `internal` |

`<target>` is `azdo` or `bifrost`. Any verdict other than reachable:
- `azdo`: `smoke azdo: skipped network-blocked`, `smoke bifrost: skipped azdo-failed`; `az` is not
  run, no PAT / token is sent, no Bifrost request of any kind is sent.
- `bifrost`: `smoke bifrost: skipped network-blocked`; `GET <models URL>` is not sent and the key
  is sent nowhere.

Network line: `smoke network: pass` when every probe that was sent was reachable; otherwise
`smoke network: fail <codes>` with the codes de-duplicated, comma-joined without spaces, in the
order azdo, bifrost, `internal` (e.g. `smoke network: fail bifrost-blocked`). Any `fail` here sets
exit 4. When the codes include at least one code other than `internal`, the last smoke line is
the fixed hint (section 7):
`Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run <install.sh|install.ps1>.`
(1.3.2) The same hint also follows a qualifying authenticated-line code; section 9.4 is the
complete rule.

(1.3.2) **HTTP 470**: Azure Firewall answers an application-rule deny (no rule matched; for
HTTPS only with TLS inspection) with the non-standard status 470 and an `Action: Deny` text
body. This is community-reported only (unofficial sources, not Microsoft documentation). 470 is
not an IANA-registered status and neither Azure DevOps nor Bifrost answers it, so it is treated
like 403 / 407: `blocked`, the body is cancelled unread, the target's credential is not sent.

### 9.1 `azdo`

Only evaluated when the azdo probe is reachable; otherwise `smoke azdo: skipped network-blocked` (9.0).

| Condition | Line |
|---|---|
| `fetchRemoteConfig` returns `ok: false` with code `c` | `smoke azdo: fail <c>`, `c` in `invalid-settings`, `auth-unavailable`, `timeout`, `too-large`, `bad-response`, `network`, `network-unreachable`, `network-blocked` (both since 1.3.1, plugin-interface 0.9.0 row 6 / 7a), `http-<status>` (e.g. `http-404`). Because the azdo probe ran first and was reachable, `fail network-unreachable` / `fail network-blocked` mean the authenticated request itself was refused or blocked (e.g. a WAF rule on the API path). Not to be confused with `skipped network-blocked` (9.0, probe verdict). (1.3.2) `fail network-unreachable`, `fail network-blocked` and `fail timeout` add the section 7 network hint (once, section 9.4); every other code in this row (`invalid-settings`, `auth-unavailable`, `too-large`, `bad-response`, `network`, every `http-<status>`) adds none. An authenticated HTTP 470 is reported by the plugin as `network-blocked` (plugin-interface 0.9.1 row 7a). |
| text does not parse with `__internals.parseJsonc` | `smoke azdo: fail invalid-jsonc` |
| root is not a plain object | `smoke azdo: fail invalid-shape` |
| unexpected exception | `smoke azdo: fail internal` |
| otherwise | `smoke azdo: pass` |

The request is exactly the plugin's (FR-2/FR-3, ADR-0007): `https://dev.azure.com/<org>/<project>/_apis/git/repositories/<repo>/items?path=<path>&versionDescriptor.version=<branch>&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`,
`Authorization: Basic base64(":"+PAT)` or `Bearer <az token>`, one deadline, 1 MiB cap.

### 9.2 `bifrost`

Evaluated in this order; the first matching row decides. Only rows 7a (probe, no credential),
8 and 9 send a request.

| # | Condition | Line |
|---|---|---|
| 1 | azdo is not `pass` | `smoke bifrost: skipped azdo-failed` |
| 2 | shared `provider.bifrost.options.baseURL` is not an own string property of plain objects | `smoke bifrost: fail no-base-url` |
| 3 | `new URL(baseURL.trim())` throws, or the URL has a username, password, query or fragment | `smoke bifrost: fail invalid-base-url` |
| 4 | protocol is not `https:` | `smoke bifrost: fail insecure-base-url` |
| 5 | effective key is not a string, is empty, or equals `sk-bf-<your-virtual-key>` | `smoke bifrost: skipped no-key` (+ the `Smoke test: set KILO_BIFROST_KEY ...` line) |
| 6 | effective key contains `{env:` or `{file:` | `smoke bifrost: skipped key-reference` |
| 7 | effective key is longer than 4096 chars or has a char outside 0x21-0x7E | `smoke bifrost: fail invalid-key` |
| 7a | (1.3.0) Bifrost origin probe (9.0) not reachable | `smoke bifrost: skipped network-blocked` (network line carries the code) |
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
az token is never sent to Bifrost. (1.3.2) Row 8 codes are unchanged (an authenticated 470 still
reads `fail 470`, a 407 `fail 407`); `network`, `timeout`, `407` and `470` add the network hint
(section 9.4).

### 9.3 Outcome

- (1.3.2) Exit codes unchanged: every line that adds the network hint is already a `fail`.
- Any `fail` (network, azdo or bifrost) -> stderr `install.sh: error: smoke test failed; the installation was kept.`, exit 4.
- Otherwise exit 0. `skipped` never fails the run by itself (`skipped network-blocked` always
  comes with `smoke network: fail ...`, which does).
- Time bound: at most about `4 x timeoutMs` (1.3.0: probe, items, probe, models; plus process
  overhead). A blocked AzDO probe ends the smoke phase after at most one `timeoutMs`.
- Output example (Bifrost behind an Azure IP firewall, engineer off the VPN):
  ```
  smoke network: fail bifrost-blocked
  smoke azdo: pass
  smoke bifrost: skipped network-blocked
  Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run install.sh.
  Done.
  ```
- The smoke phase writes no file (no cache, no log) and never alters the installed files.

### 9.4 Hint rule (1.3.2, T-035, ADR-0019 amendment A1)

`formatSmoke(report, frontEnd)` returns, in this order: the network line, the azdo line, the
bifrost line, then the no-key hint (only after `smoke bifrost: skipped no-key`, unchanged), then
the network hint **at most once**, as the last line. The network hint text is the section 7 text,
unchanged; only `<install.sh|install.ps1>` varies.

The network hint is printed iff at least one of these holds (OR; never more than one line):

| # | Source | Condition |
|---|---|---|
| N1 | network line (unchanged) | `network.status === "fail"` and `codes` contains a code other than `internal` |
| N2 | azdo line | `azdo.status === "fail"` and `azdo.code` is exactly `network-unreachable`, `network-blocked` or `timeout` |
| N3 | bifrost line | `bifrost.status === "fail"` and `bifrost.code` is exactly `network`, `timeout`, `407` or `470` |

No network hint from the azdo or bifrost line for any other code, in particular:

| Line | Codes that never add the hint |
|---|---|
| azdo `fail` | `http-401`, `http-403`, `http-404` and every other `http-<status>`, `auth-unavailable`, `invalid-settings`, `network`, `bad-response`, `too-large`, `invalid-jsonc`, `invalid-shape`, `internal` |
| bifrost `fail` | `401`, `403`, `404`, `500` and every other status number, `bad-response`, `too-large`, `invalid-key`, `no-base-url`, `invalid-base-url`, `insecure-base-url`, `internal` |
| any `skipped` | `azdo-failed`, `no-key`, `key-reference`, `network-blocked` (a `skipped network-blocked` always comes with a failing network line, so N1 already applies) |

Why azdo `network` is excluded but bifrost `network` is included: azdo `network` is the plugin's
catch-all (no fetch function, internal throw, body-stream failure after a 2xx; plugin-interface
2e), while the plugin reports a refused / reset / DNS-failed authenticated call as
`network-unreachable`. The smoke Bifrost request has no such split: `fail network` mainly means
the authenticated `GET <models URL>` call itself was rejected. Bifrost `403` stays hint-free
(more likely a key or permission problem: troubleshooting "Bifrost 401").

Cases (all print the hint exactly once): network `fail` (non-internal) only; N2 or N3 only;
N1 together with N2 or N3 (only possible for a hand-built report); N2 together with N3 (likewise).
A network line `fail internal` alone prints no hint (unchanged); `fail internal` with N2 or N3
prints the hint once (hand-built report only). The no-key hint is independent: a `runSmoke`
report never combines it with the network hint (no-key means the bifrost probe was not sent and
azdo passed), and for a hand-built report both are printed, no-key first. A malformed `network`
value still prints `smoke network: fail internal` and adds no hint by itself. The N2 / N3 decision
reads `status` and `code` with guarded property access (`attempt`), compares only primitive
strings by exact equality (no coercion), and anything else counts as "no hint" (the azdo / bifrost
line formatting itself is unchanged).

Example (pre-flight reachable, the API path is blocked by a WAF rule):
```
smoke network: pass
smoke azdo: fail network-blocked
smoke bifrost: skipped azdo-failed
Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run install.sh.
Done.
```

## 10. `install.ps1` (1.2.0, F-011; ADR-0014)

Windows front end with the same behaviour as `install.sh`. Hosts: Windows PowerShell 5.1 and
PowerShell 7+ (`pwsh`). No modules. Also runs under `pwsh` on Linux / macOS (used by CI tests).

### 10.1 Command line

```
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Org <org> -Project <project> -Repo <repo>
           [-Path <path>] [-Branch <branch>] [-Mode defaults|enforce] [-NoSmoke]
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Help
```
(`pwsh` in place of `powershell` works the same; `& .\install.ps1 ...` from a console session too.)

| Argument | Contract |
|---|---|
| `-Org`, `-Project`, `-Repo`, `-Path`, `-Branch`, `-Mode` | Names match **case-insensitively and exactly** (no abbreviation such as `-Or`). Take the **next** argument as value, even if it looks like a parameter. Last occurrence wins. Value-taking name as the last argument -> usage error. An empty value counts as absent (env / default apply). |
| `-NoSmoke` | No value. Same meaning as `--no-smoke`. Repeatable. |
| `-Help`, `-h`, `-?`, `--help` (any case) | Print the usage text (10.3) to stdout, exit 0. No checks, no writes, `node` / `az` not run. Scanned first, wins wherever it appears. |
| Anything else | Usage error, exit 2, argument text never echoed: unknown names (`-ApiKey`, `-Key`, `-Pat`, `-BifrostKey`, GNU-style `--org`), `-Name:value` forms, positional arguments, and (in-process `&` calls only) an array value or a non-string, non-numeric object value. Numbers are converted with the invariant culture. |

There is no parameter for the virtual key and none for a PAT.

### 10.2 Inputs, order, exit codes

- Environment: exactly section 2 (`KILO_AZDO_*` fallbacks and defaults `/kilo.jsonc`, `main`,
  `defaults`; key only from `KILO_BIFROST_KEY`; PAT variables only tested for non-emptiness).
  On Windows `PATHEXT` is used by command lookup.
- Order: section 3 steps 1-4 with these PowerShell specifics:
  1. help scan; 2. parse (`unknown option or argument.` -> exit 2); 3. merge, missing inputs ->
  `install.ps1: error: missing required input -Org (or KILO_AZDO_ORG).` (one line per missing
  input, then `Run install.ps1 -Help for usage.`, exit 2); a value or the key containing a NUL
  character -> `install.ps1: error: an input contains a NUL character.`, exit 2;
  4. prerequisites (all reported, then exit 1), same fixed texts as section 7 with the
  `install.ps1: error:` prefix:
     - command lookup = first `Get-Command -CommandType Application` result in PATH order; on
       Windows only `.exe`, `.cmd`, `.bat`, `.com` results count (an extensionless file is ignored);
     - Node version from `<node> -p process.versions.node`, >= 22.18; the `found <version>` text is
       the trimmed first line if it matches `^[0-9A-Za-z.+-]{1,32}$`, else `unknown`;
     - credentials: PAT variable non-empty, else `<az> account show --output none` exits 0
       (output discarded; `az` is `az.cmd` on Windows);
  5. helper lookup: `<directory of install.ps1>/install-helper.ts` must be an existing file, else
     `install.ps1: error: installer sources are missing (expected install-helper.ts next to install.ps1).`,
     exit 3, nothing written;
  6. (Windows only) `XDG_CONFIG_HOME` non-empty -> warning (10.4), continue;
  7. records `org, project, repo, path, branch, mode, apiKey, smoke, frontend=install.ps1`
     encoded as UTF-8 **without BOM** (text that is not valid Unicode ->
     `install.ps1: error: an input is not valid Unicode text.`, exit 2), written to the stdin of
     `<node> "<helper>"` started with `System.Diagnostics.Process` (stdout / stderr inherited,
     not captured); stdin closed after the bytes; the helper's exit code is returned unchanged.
- Exit codes: section 3 table (0-4), unchanged. Any unexpected PowerShell exception ->
  `install.ps1: error: internal error.`, exit 3 (no exception text, no stack trace).
- No value of `KILO_BIFROST_KEY` or a PAT appears in any argv: `node` gets only `-p
  process.versions.node` or the helper path; `az` gets only `account show --output none`.

### 10.3 Usage text (stdout, exit 0)

```
Usage: install.ps1 -Org <org> -Project <project> -Repo <repo> [-Path <path>] [-Branch <branch>] [-Mode defaults|enforce] [-NoSmoke]
       install.ps1 -Help

Installs the Azure DevOps remote-config plugin and your personal Kilo config.
Inputs can also come from KILO_AZDO_ORG, KILO_AZDO_PROJECT, KILO_AZDO_REPO,
KILO_AZDO_PATH, KILO_AZDO_BRANCH and KILO_AZDO_MODE (parameters win).
Your Bifrost virtual key is read from KILO_BIFROST_KEY (there is no parameter for it).
After installing, a smoke test reads the shared config from Azure DevOps and calls Bifrost GET <baseURL>/models; -NoSmoke skips it.
Requires Node.js 22.18 or later and either `az login` or AZDO_PAT.
Exit codes: 0 ok, 1 prerequisite, 2 usage, 3 file system, 4 installed but smoke test failed.
Run it with: powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 ...
```

### 10.4 Output

- All front-end text is fixed ASCII written with `[Console]::Out` / `[Console]::Error`, line
  ending of the platform (CRLF on Windows). Helper lines (section 7, with the `install.ps1`
  variants of section 4) are LF and pass through unmodified.
- Windows-only warning when `XDG_CONFIG_HOME` is non-empty (stderr, before the helper runs):
  `install.ps1: warning: XDG_CONFIG_HOME is set: make sure only your account can read that folder, because kilo.jsonc holds your Bifrost virtual key.`
- Never printed: same list as section 7.

### 10.5 File format

`install.ps1` is ASCII-only (bytes 0x20-0x7E plus LF), no BOM, LF line endings
(`.gitattributes`: `*.ps1 text eol=lf`), no `param()` block. It writes no file itself.
