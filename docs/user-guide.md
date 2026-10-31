# User guide

## Current status

The Kilo azdo-remote-config plugin is at an early stage (T-001 skeleton, F-001 JSONC parser, F-002 placeholders, F-003 merge helper, F-004 settings resolution, F-005 Azure DevOps fetch).
There is nothing to install or configure for end users yet.

What exists today:
- A stub plugin file, `backend/plugin/azdo-remote-config.ts`. If Kilo loaded it, it would start
  normally and change nothing: it makes no network calls, reads no files and writes no logs.
- An internal JSONC parser (F-001). It is not used by the plugin yet, so it has no user-visible
  effect today. Once the fetch step is built, the shared `kilo.jsonc` will be parsed with it, so the
  file may contain `//` and `/* */` comments, trailing commas and `https://` URLs inside strings.

- An internal placeholder resolver (F-002). It is not used by the plugin yet, so it has no
  user-visible effect today. The rules below describe how it will treat the shared `kilo.jsonc`
  once it is wired in.

- An internal merge helper (F-003). It is not used by the plugin yet, so it has no user-visible
  effect today. The rules below describe how the shared config will be merged into your Kilo config
  once it is wired in.

- An internal settings resolver (F-004). It is not used by the plugin yet, so it has no
  user-visible effect today: setting any `KILO_AZDO_*` variable or plugin option changes nothing at
  runtime. The section below describes how settings will be resolved once it is wired in.

- An internal Azure DevOps fetch function (F-005). It is not used by the plugin yet, so it has no
  user-visible effect today: the plugin still makes no network calls. The section "Fetching the
  shared config" below describes how it will behave once wired in.

Not yet available (planned, see `factory/VISION.md`): using the parser, resolver and merge helper on a fetched file, calling the fetch from the plugin,
merging it into Kilo, the local cache, the bootstrap installers and key provisioning.

Supported Kilo version range (pinned): `>=7.2.0 <8.0.0`.

## Placeholders in the shared config (not active yet)

The resolver is implemented but the plugin does not call it yet. When it is wired in, string values
in the shared config may use:

- `{env:NAME}`: the value of environment variable `NAME`. An unset or empty variable is unresolved.
- `{file:path}`: the trimmed contents of a file (surrounding whitespace, including a BOM, is removed).

Rules for `{file:}` paths:
- `~/...` (or `~\...`) is relative to your home directory.
- Absolute paths are used as they are.
- Relative paths, a bare `~` and `~user` are never resolved, because the shared file is remote and
  has no base directory. Use `~/` or an absolute path.
- Paths starting with two slashes or backslashes (UNC-style such as `\\host\share\f`) are never resolved
  and are not read.
- Only regular files of at most 1 MiB are read. Directories, pipes, devices, larger files and
  unreadable or empty files are unresolved.

Names and paths are used exactly as written (no trimming, no case folding). A resolved value is not
scanned again, so an environment variable containing `{file:...}` does not trigger a file read.
Text such as `{env:}` or `{other:x}` is not a placeholder and stays as is.

Unresolved placeholders:
- If a string is exactly one placeholder and it is unresolved, the setting is dropped (the key is
  omitted, the array element is removed).
- Inside a longer string, an unresolved placeholder becomes an empty string: `pre-{env:MISSING}-post`
  becomes `pre--post`.
- The resolver reports the unresolved entries as `env:NAME` / `file:path`, as written. These are
  names only, never values.

Security: the shared config can make the plugin read any environment variable and any file your
user can read, and put the content into Kilo's config. Keep the shared repository PR-gated and
reviewed. No allowlist exists yet.

## How the shared config will be merged (not active yet)

The merge helper exists but the plugin does not call it yet. When it is wired in, the shared config
is merged into your Kilo config in one of two modes. Only the exact, lowercase string `enforce`
selects enforce mode; any other value (including `ENFORCE`, an empty value or none) means `defaults`.

- Settings that you do not have locally are added from the shared config, in both modes.
- `defaults`: where you and the shared config both set a value, your value stays.
- `enforce`: where both set a value, the shared value wins. Exception: if your local value is an
  object or array that contains an `apiKey` anywhere inside it, it is kept, so a local key is never lost.
- Objects present on both sides are merged key by key. Arrays are replaced as a whole, not combined.
- Your own `apiKey` is never changed or removed, in either mode.
- An `apiKey` in the shared file (any capitalisation, at any depth) is ignored and never applied.
- The top-level `$schema` and `plugin` keys of the shared file are ignored. Nested keys with those
  names are normal settings.
- Keys named `__proto__`, `constructor` or `prototype` in the shared file are skipped.
- Settings you have that the shared file does not mention are left alone.
- A shared config nested 64 or more levels deep is rejected with
  `Config merge: config nested too deeply`; your config is left unchanged in that case.

Security: the merge ignores a shared `apiKey`, but the shared file can still set `baseURL` or
`headers` for a provider that uses your local `apiKey`, which could send your key to another host.
Keep the shared repository PR-gated and reviewed.

## Plugin settings (not active yet)

The resolver exists but the plugin does not call it yet. Each setting can come from a plugin option
or from an environment variable. Precedence per setting: plugin option, then environment variable,
then default.

| Setting | Env variable | Default |
|---------|--------------|---------|
| `org` | `KILO_AZDO_ORG` | none (required) |
| `project` | `KILO_AZDO_PROJECT` | none (required) |
| `repo` | `KILO_AZDO_REPO` | none (required) |
| `path` | `KILO_AZDO_PATH` | `/kilo.jsonc` |
| `branch` | `KILO_AZDO_BRANCH` | `main` |
| `mode` | `KILO_AZDO_MODE` | `defaults` |
| `pat` | `KILO_AZDO_PAT` | none |
| `timeoutMs` | `KILO_AZDO_TIMEOUT_MS` | `5000` |

- `org`, `project` and `repo` have no defaults (`repo` no longer defaults to `kilo-config`). If one
  is still unset after resolution it is reported as missing.
- Values are trimmed. An unset or whitespace-only value is skipped silently.
- `org`, `project`, `repo`: no control characters, none of `/ \ ? # %`, and not `.` or `..`.
- `branch`: no control characters, no spaces, none of `\ ? # %`, no `..` or `//`, and it must not
  start or end with `/`.
- `path`: a leading `/` is added if missing (`teams/a/kilo.jsonc` becomes `/teams/a/kilo.jsonc`).
  No control characters, none of `\ ? # %`, and no empty, `.` or `..` segments.
- `mode`: exactly `defaults` or `enforce`, lowercase.
- `timeoutMs`: a whole number from 1 to 2147483647 (milliseconds). A number or a string of digits.
- `pat`: any non-empty string. Settings resolution reads only the plugin option and `KILO_AZDO_PAT`;
  the `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT` and `az` fallbacks are applied by the fetch step (next section).

An invalid value is ignored with a warning and the next source is tried (option, then environment
variable, then default). Warnings contain fixed text and the setting name only, never the value, so a
PAT is never exposed through them. Example: an invalid `mode` option with `KILO_AZDO_MODE=enforce`
set resolves to `enforce`, plus a warning about the option.

## Fetching the shared config (not active yet)

The fetch function exists but the plugin does not call it yet. When it is wired in, it downloads the
shared file with one HTTPS GET to `https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items`
for the configured `path` and `branch`. Redirects are never followed.

Credentials, first usable one wins:
1. The `pat` plugin option, or `KILO_AZDO_PAT`.
2. Environment variable `AZDO_PAT`.
3. Environment variable `AZURE_DEVOPS_EXT_PAT`.
4. An Entra token from the Azure CLI (`az account get-access-token`), used only if no PAT is usable.

A PAT is skipped silently if it is empty or contains whitespace or non-printable or non-ASCII
characters. If no credential works, the fetch fails with `auth-unavailable` and no request is sent.

Limits: the whole operation (az, request and reading the body) must finish within `timeoutMs`
(default 5000 ms), and the response body may be at most 1 MiB.

Failures are reported as one fixed code, never with values, URLs or secrets: `invalid-settings`,
`auth-unavailable`, `timeout`, `too-large`, `bad-response`, `network`, or `http-<status>` (for
example `http-401`). See [API](api.md) for details.

This page will describe setup and settings once the remaining features ship.
