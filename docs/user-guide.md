# User guide

## Current status

The Kilo azdo-remote-config plugin is active. When Kilo starts it fetches one shared `kilo.jsonc` from
Azure DevOps, validates it, caches it, and merges it into your Kilo config. If anything fails, Kilo
starts normally with your local config; the plugin never crashes Kilo.

Also available: a [validator](#validating-the-shared-config-platform-engineers) for the shared config. Not yet available (planned, see `factory/VISION.md`): the bootstrap installers, key provisioning and the Azure Pipelines PR gate (F-008).

Supported Kilo version range (pinned): `>=7.2.0 <8.0.0`.

## How it works at startup

1. Settings are read (see "Plugin settings"). If `org`, `project` or `repo` is missing, no request is made.
2. The shared file is fetched from Azure DevOps (see "Fetching the shared config") and validated: it must
   be valid JSONC with an object at the top and be nested fewer than 64 levels.
3. A valid result is saved to the cache. If the fetch or validation fails, the cache is used instead.
4. Placeholders are resolved and the shared config is merged into your Kilo config in `defaults` or
   `enforce` mode. The merge is all or nothing: on an error your config is left unchanged.

If there is neither a usable fetch nor a usable cache, Kilo runs with local config only.

## Cache

Location: `~/.cache/kilo-azdo/remote-config.json` (under your home directory). The directory is created
with mode 0700 and the file with mode 0600 on POSIX systems, and it is replaced atomically (temp file,
then rename). It holds the last valid shared config, still containing placeholders such as `{env:NAME}`
(never their values) and without any `apiKey`. It is written only after a successful, validated fetch, and
is at most 2 MiB. It is read only when the fetch fails. To reset it, delete the file.

## Trust boundary

Settings (`org`, `project`, `repo`, `pat`, ...) are taken only from the global Kilo config's plugin
options, `KILO_AZDO_*` environment variables, and `az`. A project-level Kilo config in a repository
you open cannot choose where the shared config is fetched from or which credentials are used. Fetched and
cached content is treated as untrusted and validated before it is cached or merged. The shared file itself
is still trusted to the extent described in the security notes below, so keep its repository PR-gated.

## Troubleshooting log messages

The plugin logs through Kilo's logger with service `azdo-remote-config`. Messages are fixed text; they
never contain setting values, URLs, paths, PATs or tokens. `<reason>` is a fetch error code (see
"Fetching the shared config"), `missing-settings`, `invalid-jsonc` or `invalid-shape`.

| Level | Message | Meaning |
|-------|---------|---------|
| info | `Loaded shared config from Azure DevOps.` | Fetch and validation succeeded. |
| info | `Applied shared config from <remote or cache> in <defaults or enforce> mode.` | The merge finished. |
| warn | `Remote config skipped: missing required settings: <names>.` | Set the named settings (`org`, `project`, `repo`). |
| warn | `Remote config unavailable (<reason>); using cached config.` | Fetch failed; the cache was used. For example `http-401` means a bad or expired PAT. |
| warn | `Could not update the config cache (<code>).` | Code is `cache-unavailable`, `cache-too-large` or `cache-write-failed`. The fetched config is still applied. |
| warn | `Unresolved placeholders: <names>.` | `{env:}` or `{file:}` entries that could not be resolved (names only). |
| warn | (a setting warning) | An invalid option or variable was ignored; see "Plugin settings". |
| error | `Remote config unavailable (<reason>) and no usable cache (<code>); continuing with local config only.` | Code is `cache-unavailable`, `cache-missing`, `cache-unreadable` or `cache-invalid`. Fix the cause of `<reason>`. |
| error | `Could not apply the shared config; local config left unchanged.` | The merge failed and was rolled back. |
| error | `Shared config not applied: the Kilo config is not an object.` | Unexpected Kilo config. |
| error | `Remote config failed unexpectedly; continuing with local config only.` | Internal error, caught. |

If Kilo provides no logger, the plugin stays silent.

## Placeholders in the shared config

String values in the shared config may use:

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

## How the shared config is merged

The shared config is merged into your Kilo config in one of two modes. Only the exact, lowercase string `enforce`
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

## Plugin settings

Each setting can come from a plugin option
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

## Fetching the shared config

The plugin downloads the
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

## Validating the shared config (platform engineers)

Before you merge a change to the shared `kilo.jsonc`, check it with the validator. It is a
command-line tool in this repository; it reads the files and reports problems. It does not fetch
anything and does not need a PAT. Running it automatically on every pull request in the Azure DevOps
repo comes with F-008; until then, run it by hand.

### Run it
From the repository root (Node.js 22.18 or newer):

```bash
node backend/validator/validate-kilo-config.ts path/to/kilo.jsonc
node backend/validator/validate-kilo-config.ts --allowed-hosts bifrost.yourcompany.internal path/to/kilo.jsonc
node backend/validator/validate-kilo-config.ts --help
```

| Argument | Meaning |
|---|---|
| `<file>...` | One or more JSONC files (at least one). Processed in order. |
| `--allowed-hosts <list>` | Comma-separated host names. Turns on the `base-url-host` check: every `provider.<id>.options.baseURL` must be an `https` URL, with no user name or password, on one of these hosts. The flag may be repeated. An empty or invalid list is a usage error. |
| `--` | Everything after it is a file name, even if it starts with `-`. |
| `--help`, `-h` | Print usage and exit 0. |

Reading from stdin (`-`) is not supported.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | All files were read and none has errors. Warnings are allowed. |
| 1 | All files were read and at least one has an error. |
| 2 | Usage error, a file could not be read, or an internal error. Takes precedence over 1. |

### Output
One line per finding, then one verdict line per file, then a summary:

```
kilo.jsonc: error api-key at provider.bifrost.options.apiKey: apiKey must never be in the shared config
kilo.jsonc: invalid (1 errors, 0 warnings)
validate-kilo-config: 1 files checked: 0 valid, 1 invalid, 0 unreadable.
```

Unreadable files are reported on stderr as `<file>: io-error: ...`; usage errors also go to stderr.
At most 200 findings are printed per file. The validator never prints a value from the file (no
string values, URLs or secrets), only rule ids, locations such as `provider.bifrost.options.baseURL`
or `line 12`, and fixed messages.

### Rules
Errors (exit 1):

| Rule | Fires when |
|---|---|
| `file-too-large` | The file is larger than 1 MiB (the plugin's fetch limit). |
| `invalid-encoding` | The file is not valid UTF-8. |
| `invalid-jsonc` | The file does not parse as JSONC. |
| `root-not-object` | The top level is not a JSON object. |
| `too-deep` | Nesting reaches 64 levels. |
| `prototype-key` | A key is `__proto__`, `constructor` or `prototype` (the plugin drops these). |
| `api-key` | Any key named `apiKey` (any case), at any depth. |
| `secret-pattern` | A key, a string value or any line of the text (comments included) contains `sk-bf-` followed by a letter or digit. |
| `schema-type` | A known Kilo setting has the wrong type (for example `provider` is not an object). Unknown keys are never errors. |
| `base-url-host` | Only with `--allowed-hosts`: a `baseURL` is not an https URL on an allowed host. |

Warnings (exit stays 0):

| Rule | Fires when |
|---|---|
| `prototype-member-name` | A key shadows an `Object.prototype` member such as `toString` or `valueOf`. |
| `file-placeholder-unresolvable` | A `{file:PATH}` placeholder can never resolve; use `~/...` or an absolute path. |
| `plugin-ignored` | The file has a top-level `plugin` key, which the merge ignores. |

The type checks use a vendored subset of Kilo's schema (`backend/validator/kilo-schema-subset.json`)
pinned to the supported Kilo range `>=7.2.0 <8.0.0`.

## Example shared config

`backend/shared-config/kilo.jsonc` is a commented starting point. It defines one provider, `bifrost`
(`@ai-sdk/openai-compatible`), with `baseURL` `https://bifrost.yourcompany.internal/v1` (replace the
host with your own gateway) and the models `azure/gpt-5` and `azure/gpt-5-mini`. It contains no
`apiKey`: each developer keeps their own virtual key in a personal config. It validates with exit 0
and no warnings, with or without `--allowed-hosts bifrost.yourcompany.internal`.
