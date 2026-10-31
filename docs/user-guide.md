# User guide

## Current status

The Kilo azdo-remote-config plugin is active. When Kilo starts it fetches one shared `kilo.jsonc` from
Azure DevOps, validates it, caches it, and merges it into your Kilo config. If anything fails, Kilo
starts normally with your local config; the plugin never crashes Kilo.

Also available: a [validator](#validating-the-shared-config-platform-engineers) for the shared config. Also available: a [personal config template](#personal-config-template-engineers). Also available: the [macOS/Linux installer](#installing-on-macos-and-linux-engineers) and the [Windows installer](#installing-on-windows-engineers). Not yet available (planned, see `factory/VISION.md`): key provisioning and the Azure Pipelines PR gate (F-008).

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
anything and does not need a PAT. To run it automatically on every pull request, set up the shared
config repo as described in [Setting up the shared config repo](#setting-up-the-shared-config-repo-platform-engineers).
You can also run it by hand.

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

## Setting up the shared config repo (platform engineers)

This repository ships a template and an assemble tool for the Azure DevOps repo that holds the
shared config (the examples call it `kilo-config`). The tool builds the repo contents; you push them
and create the pipeline and branch policies yourself. Nothing in this repository creates or contacts
Azure DevOps for you, and this guide does not mean such a repo or its policies already exist in your
organization.

### 1. Assemble the repo tree
From the repository root (Node.js 22.18 or newer):

```bash
node backend/tools/assemble-shared-repo.ts ./kilo-config-out
node backend/tools/assemble-shared-repo.ts --help
```

It writes 9 files, byte-identical copies of the sources: `.gitattributes`, `azure-pipelines.yml`,
`kilo.jsonc`, `package.json`, `set-branch-policies.sh`, `validator/validate-kilo-config.ts`,
`validator/kilo-config-rules.ts`, `validator/kilo-schema-subset.json` and
`plugin/azdo-remote-config.ts` (the validator reuses the plugin). On success it prints
`assemble-shared-repo: wrote 9 files`.

What it refuses (exit 2): no argument, more than one argument, an unknown option, or an output
directory that exists and is not empty (or is a symlink). It never overwrites or deletes anything.
Exit 1: a source file is missing, or writing failed (the message carries only an error code).

### 2. Push it to Azure Repos
Create an empty Git repo in your Azure DevOps project, then from the output directory:

```bash
cd kilo-config-out
git init -b main && git add . && git commit -m "Initial shared config"
git remote add origin <your Azure Repos clone URL>
git push -u origin main
```

Edit `kilo.jsonc` for your gateway before real use (it is an example).

### 3. Create the pipeline and set KILO_ALLOWED_HOSTS
In Azure DevOps, create a pipeline from the existing `azure-pipelines.yml` in that repo and note its
numeric build definition id (it is in the pipeline URL as `definitionId=`).

Set the pipeline variable `KILO_ALLOWED_HOSTS` to the comma-separated host names allowed in
`provider.*.options.baseURL` (for example your Bifrost host). The file contains a default value that
is a placeholder (`bifrost.yourcompany.internal`); set the real value in the pipeline's variables
settings. The gate runs the validator with `--allowed-hosts`, so it fails closed: if the variable is
empty or missing, the validator reports a usage error (exit 2) and the build fails.

The pipeline uses an `ubuntu-latest` agent, `UseNode@1` (22.x, and the script checks for 22.18 or
later), installs nothing from npm, and validates `kilo.jsonc` and every `teams/*/kilo.jsonc`.

### 4. Create the branch policies with set-branch-policies.sh
Azure Repos Git ignores the `pr:` block in the YAML, so the PR trigger is a blocking build-validation
policy on `main`. The script creates three policies on `main`: minimum approver count 1 (creator vote
does not count, downvotes not allowed, votes reset on new pushes), a required reviewer group, and
the blocking build validation for your pipeline.

Get the repository GUID (not the name):

```bash
az repos show --repository kilo-config --org https://dev.azure.com/<org> --project <project> --query id -o tsv
```

Preview first, then run:

```bash
bash set-branch-policies.sh --org <org> --project <project> --repository-id <guid> \
  --reviewer-group <group> --build-definition-id <n> --dry-run
bash set-branch-policies.sh --org <org> --project <project> --repository-id <guid> \
  --reviewer-group <group> --build-definition-id <n>
```

| Flag | Meaning |
|---|---|
| `--org` | Organization name, `https://dev.azure.com/<org>` or `https://<org>.visualstudio.com`. |
| `--project` | Project name. |
| `--repository-id` | Repository GUID (see above). |
| `--reviewer-group` | Required reviewer, passed to `az` as is. A group identity GUID is recommended; a display name must match exactly one identity. |
| `--build-definition-id` | Numeric id of the pipeline from step 3. |
| `--dry-run` | Print the three `az` commands (one per line) instead of running them. `az` is not needed. |
| `--help`, `-h` | Print usage. |

Only the `--flag value` form is accepted. The branch is fixed to `main`. There is no token flag:
authenticate with `az login` (with the `azure-devops` extension) or the `AZURE_DEVOPS_EXT_PAT`
environment variable. The script needs `bash` and `az`.

| Exit | Meaning |
|---|---|
| 0 | Dry run printed, all three policies created, or `--help`. |
| 1 | `az` not found, or an `az` call failed. Later policies are not created; ones already created stay. |
| 2 | Usage error. `az` was never invoked. |

Re-running creates duplicate policies. Remove duplicates in the Azure DevOps UI; automated
idempotent handling is planned (T-023). The script never prints `az` output or environment values.

### Security caveat: a PR can change its own gate
The pipeline file and the validator live in the same repo as the config they check. A pull request
can therefore change `azure-pipelines.yml` or the validator in the same change that it is validated
with. Mitigate this:

- Restrict the "Bypass policies when completing pull requests" and "Edit policies" permissions to a
  small trusted group.
- Keep the platform team as a blocking required reviewer on `main` (this is what the
  required-reviewer policy does), and review changes to `azure-pipelines.yml`, `validator/` and
  `plugin/` with extra care.

### What the gate checks
The validator rules listed in [Validating the shared config](#validating-the-shared-config-platform-engineers)
run on `kilo.jsonc` and `teams/*/kilo.jsonc`: no secrets or `apiKey`, valid JSONC and types, no
unsafe keys, and (because `KILO_ALLOWED_HOSTS` is set) every `baseURL` is https on an allowed host.
Errors fail the build; warnings do not. The `teams/` folder is optional.

## Personal config template (engineers)

`backend/personal-config/kilo.jsonc` is the starting point for your own Kilo config. The shared config
holds team settings; this file holds the two things that are yours: where the plugin finds the shared
config, and your own Bifrost virtual key.

### What it contains
- `$schema`: `https://app.kilo.ai/config.json`.
- `plugin`: one entry, `./azdo/azdo-remote-config.ts`, with the options `org`, `project`, `repo`,
  `path` (`/kilo.jsonc`), `branch` (`main`) and `mode` (`defaults`). There is no `pat` option.
- `provider.bifrost.options.apiKey`: the placeholder `sk-bf-<your-virtual-key>`.
- Comments that repeat the placement rules below.

### Where it goes
Copy it to `~/.config/kilo/kilo.jsonc` (the global Kilo config directory) and nowhere else. Never put it
in a project directory and never commit it to a repository, because it holds your virtual key. A
project-level config cannot choose where the shared config comes from (see "Trust boundary"). On
macOS and Linux, [`install.sh`](#installing-on-macos-and-linux-engineers) does this copy for you. The
Windows, [`install.ps1`](#installing-on-windows-engineers) does it.
The plugin path `./azdo/azdo-remote-config.ts` is relative to the Kilo config directory, so the plugin
file must be at `~/.config/kilo/azdo/azdo-remote-config.ts`, which `install.sh` also sets up.

### What to fill in
1. `org`, `project`, `repo`: the Azure DevOps organization, project and repository that hold the shared
   `kilo.jsonc`. The template values (`contoso`, `platform`, `kilo-config`) are examples; replace them.
2. `path`, `branch`, `mode`: change them only if your platform team says so. See "Plugin settings".
3. `apiKey`: replace `sk-bf-<your-virtual-key>` with your own Bifrost virtual key. Never share it.

### Azure DevOps credentials
Do not put a PAT in this file. Set the `AZDO_PAT` environment variable, or sign in with `az login`
(see "Fetching the shared config").

### Merge behaviour
Your `apiKey` is never changed in either mode, and the shared file's `plugin` and `$schema` are ignored.
The shared `baseURL` and models are added around your key.

The validator reports this file's placeholder as an `api-key` error and a `plugin-ignored` warning.
That is expected: the validator is a gate for the shared config, not for personal files.

## Installing on macOS and Linux (engineers)

`backend/installer/install.sh` sets up your machine in one command and then checks that it works with a smoke test. For Windows see [below](#installing-on-windows-engineers);
key provisioning is out of scope.

### Before you start
- Node.js 22.18 or newer on your PATH.
- Azure DevOps credentials: either run `az login` (Azure CLI installed), or set `AZDO_PAT` (also
  accepted: `AZURE_DEVOPS_EXT_PAT`, `KILO_AZDO_PAT`) to a PAT with Code (Read) scope. If a PAT variable
  is set, `az` is not checked. The installer never prints or stores the PAT.
- A checkout of this repository. Run the script from the checkout; it finds the plugin and template
  relative to its own location.

### Run it
```bash
bash backend/installer/install.sh --org contoso --project platform --repo kilo-config
KILO_BIFROST_KEY="sk-bf-..." bash backend/installer/install.sh --org contoso --project platform --repo kilo-config
```

| Flag | Env fallback | Default |
|---|---|---|
| `--org` | `KILO_AZDO_ORG` | required |
| `--project` | `KILO_AZDO_PROJECT` | required |
| `--repo` | `KILO_AZDO_REPO` | required |
| `--path` | `KILO_AZDO_PATH` | `/kilo.jsonc` |
| `--branch` | `KILO_AZDO_BRANCH` | `main` |
| `--mode` (`defaults` or `enforce`) | `KILO_AZDO_MODE` | `defaults` |
| `--no-smoke` | none | smoke test runs |

A flag wins over the environment variable. Flags take their value as the next argument (`--org x`, not
`--org=x`). `--help` prints usage. Your Bifrost virtual key is passed only through `KILO_BIFROST_KEY`;
there is deliberately no flag for it, so it stays out of your process list. Without the variable, an
existing key is kept, or the placeholder `sk-bf-<your-virtual-key>` is written and the installer tells
you to set it (re-run with the variable, or edit the file).

### What it writes
- `~/.config/kilo/azdo/azdo-remote-config.ts`: a copy of the plugin (mode 0644).
- `~/.config/kilo/kilo.jsonc`: your personal config, mode 0600. Created from the template, or updated:
  the azdo plugin entry is replaced (other plugins and settings are kept) and your `apiKey` is kept
  unless `KILO_BIFROST_KEY` is set. Comments in an existing file are lost on update.
- Before changing an existing `kilo.jsonc`, a backup `~/.config/kilo/kilo.jsonc.bak-<timestamp>` (mode
  0600). Backups contain your old keys. Delete old backups once you have checked the result.
- If `XDG_CONFIG_HOME` is set (absolute path), `$XDG_CONFIG_HOME/kilo` is used instead of `~/.config/kilo`.
- Nothing is written to `~/.config/kilo/plugin/`: Kilo auto-loads that folder and would load the plugin
  twice. If it already holds an `azdo-remote-config` file, the installer warns you to remove it.

Re-running is safe: unchanged files are not rewritten, and no backup is made when nothing changes.

### Exit codes
| Code | Meaning |
|---|---|
| 0 | Installed, updated, or already up to date |
| 1 | Prerequisite missing: Node.js (or too old), or no Azure DevOps credentials. Nothing written |
| 2 | Usage or input error: unknown option, missing org/project/repo, rejected value, bad `KILO_BIFROST_KEY`, relative `XDG_CONFIG_HOME`. Nothing written |
| 3 | Existing config or file system problem: `kilo.jsonc` is not valid JSONC, has an unexpected shape, or a target is a symlink; I/O error |
| 4 | Installed, but the smoke test failed. The installation is kept and not changed |

### Smoke test
After a successful install, the installer runs two checks and prints one line each:

```
smoke azdo: pass
smoke bifrost: pass
```

1. `azdo`: fetches the shared config from Azure DevOps the same way the plugin does (PAT, else `az` token) and parses it.
2. `bifrost`: calls `GET <baseURL>/models` with your virtual key. The `baseURL` comes from the shared config and must be `https`; redirects are not followed.

Each line is `pass`, `fail <code>` or `skipped <code>`. `skipped` never causes exit 4. Bifrost is skipped
when `azdo` failed (`azdo-failed`), when your key is still the placeholder (`no-key`; the installer
prints a hint to set `KILO_BIFROST_KEY` and re-run), or when the key is a `{env:...}` / `{file:...}`
reference (`key-reference`). Each check waits at most `KILO_AZDO_TIMEOUT_MS` (default 5000 ms), so the
test takes up to about twice that. The smoke test writes no file, and your key, PAT and tokens are never printed.

Use `--no-smoke` on machines that cannot reach the network (it makes no request). Exit codes 1, 2 and 3 never run the smoke test.

Troubleshooting by code (a `fail` or `skipped` code on the line):

| Code | Check | Meaning and fix |
|---|---|---|
| `invalid-settings` | azdo | org, project, repo, path or branch was rejected; check the flags |
| `auth-unavailable` | azdo | no PAT and no usable `az login`; set `AZDO_PAT` or run `az login` |
| `timeout` | both | no answer in time; check VPN/network or raise `KILO_AZDO_TIMEOUT_MS` |
| `http-<status>` | azdo | Azure DevOps answered with that status (401/403 credentials or scope, 404 wrong org/project/repo/path/branch) |
| `<status>` (e.g. `401`) | bifrost | Bifrost answered with that status; 401 usually means a wrong or revoked virtual key; 3xx means a redirect, which is not followed |
| `too-large` | both | response over 1 MiB |
| `bad-response` | both | answer was not the expected JSON object |
| `network` | both | connection or DNS failure |
| `invalid-jsonc` | azdo | the shared config is not valid JSONC |
| `invalid-shape` | azdo | the shared config root is not an object |
| `no-base-url` | bifrost | shared config has no `provider.bifrost.options.baseURL` string |
| `invalid-base-url` | bifrost | `baseURL` is not a URL, or has credentials, query or fragment |
| `insecure-base-url` | bifrost | `baseURL` is not `https`; the key is never sent over plain http |
| `invalid-key` | bifrost | key is too long or has characters outside printable ASCII |
| `internal` | both | unexpected error |

## Installing on Windows (engineers)

`backend/installer/install.ps1` is the Windows counterpart of `install.sh`. It is a thin front end:
it checks your inputs and prerequisites, then runs the same Node helper (`install-helper.ts`), so the
result, exit codes and smoke test are the same. It works on Windows PowerShell 5.1 and PowerShell 7+.

### Before you start
- Node.js 22.18 or newer on your PATH (use a normal `node.exe` install).
- Azure DevOps credentials: `az login`, or `AZDO_PAT` (also `AZURE_DEVOPS_EXT_PAT`, `KILO_AZDO_PAT`).
- A checkout of this repository. The script finds the helper at `$PSScriptRoot\install-helper.ts`, so
  it must run from the checkout. Piping it (`irm ... | iex`) is not supported.

### Run it
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File backend\installer\install.ps1 -Org contoso -Project platform -Repo kilo-config
$env:KILO_BIFROST_KEY = "sk-bf-..."; powershell -File backend\installer\install.ps1 -Org contoso -Project platform -Repo kilo-config
```

| Parameter | Env fallback | Default |
|---|---|---|
| `-Org` | `KILO_AZDO_ORG` | required |
| `-Project` | `KILO_AZDO_PROJECT` | required |
| `-Repo` | `KILO_AZDO_REPO` | required |
| `-Path` | `KILO_AZDO_PATH` | `/kilo.jsonc` |
| `-Branch` | `KILO_AZDO_BRANCH` | `main` |
| `-Mode` (`defaults` or `enforce`) | `KILO_AZDO_MODE` | `defaults` |
| `-NoSmoke` | none | smoke test runs |
| `-Help` | none | prints usage |

Parameter names are case-insensitive but must be exact. An unknown or positional argument exits 2. A
parameter wins over its environment variable. There is no parameter for the key or a PAT: the virtual
key is read only from `KILO_BIFROST_KEY`.

### What it writes
Files go to `%USERPROFILE%\.config\kilo` (`azdo\azdo-remote-config.ts` and `kilo.jsonc`), with the same
content, backups and idempotence as `install.sh`. `kilo.jsonc` is byte-identical to what `install.sh`
writes (its update header still says "Rewritten by install.sh"). The installer sets no file permissions
(no chmod or ACL changes); protection relies on the ACLs your profile folder already inherits. If
`XDG_CONFIG_HOME` is set, the installer prints a warning (it does not move the target).

### Exit codes and smoke test
Exit codes 0 to 4 and the smoke test lines are the same as for [macOS and Linux](#exit-codes);
`-NoSmoke` skips the smoke test.

### Troubleshooting
- "running scripts is disabled" or a similar execution policy error: start it with
  `powershell -NoProfile -ExecutionPolicy Bypass -File ...`. If the file came from a download or zip,
  run `Unblock-File backend\installer\install.ps1` once.
- Exit 1: Node.js missing or older than 22.18, or no `az login` and no PAT variable.
- Exit 2: a typo in a parameter name, a missing `-Org`/`-Project`/`-Repo`, or a positional argument.
- Runs fail in odd ways when `node` is a `.cmd` shim (for example from some version managers): a `%`
  in the checkout path, or spaces in both the shim path and the helper path, can break the run. Use a
  normal `node.exe` install or move the checkout to a path without `%` or spaces.

## Example shared config

`backend/shared-config/kilo.jsonc` is a commented starting point. It defines one provider, `bifrost`
(`@ai-sdk/openai-compatible`), with `baseURL` `https://bifrost.yourcompany.internal/v1` (replace the
host with your own gateway) and the models `azure/gpt-5` and `azure/gpt-5-mini`. It contains no
`apiKey`: each developer keeps their own virtual key in a personal config. It validates with exit 0
and no warnings, with or without `--allowed-hosts bifrost.yourcompany.internal`.
