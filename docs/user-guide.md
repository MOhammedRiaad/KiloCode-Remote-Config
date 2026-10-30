# User guide

## Current status

The Kilo azdo-remote-config plugin is at an early stage (T-001 skeleton, F-001 JSONC parser).
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

Not yet available (planned, see `factory/VISION.md`): using the parser and resolver on a fetched file, fetching the shared config from Azure DevOps,
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

This page will describe setup and settings once the remaining features ship.
