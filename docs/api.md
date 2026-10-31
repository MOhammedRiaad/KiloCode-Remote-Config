# API reference

This product has no HTTP API. It is a Kilo plugin.

## Plugin interface (current: stub)

File: `backend/plugin/azdo-remote-config.ts`. Default export, Kilo v1 plugin module shape:

```ts
export default { id: "azdo-remote-config", server }
// server(input, options?) => Promise<{ config(config) => Promise<void> }>
```

- `config` hook: receives Kilo's resolved config; in the current stub it does nothing.
- Named exports: `PLUGIN_ID` (`"azdo-remote-config"`), `SUPPORTED_KILO_RANGE` (`">=7.2.0 <8.0.0"`)
  and `__internals` (test seam, now `{ parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings, fetchRemoteConfig }`).
- The plugin settings (`org`, `project`, `repo`, `path`, `branch`, `mode`, `pat`, `timeoutMs`) are
  not read by the hook yet; see `resolveSettings` below. `fetchRemoteConfig` is not called by the hook either.

## `parseJsonc` (internal)

Reachable only as `__internals.parseJsonc`; it is not a named export and the `config` hook does not
call it yet. Signature: `parseJsonc(text: string): unknown`.

Accepted syntax, on top of standard JSON:
- `// line comments` (end at `
` or `
`) and `/* block comments */`.
- Trailing commas before `}` or `]`, including when comments sit between the comma and the bracket.
- A leading BOM (U+FEFF) is ignored.
- Comment markers inside strings are literal, so `"https://example.com"` is preserved; escaped
  quotes and backslashes in strings are handled.

It returns whatever `JSON.parse` returns, with no schema validation. A lone comma such as `[,]` or
`{,}` is treated as a trailing comma and yields `[]` / `{}`.

Errors: every failure throws an `Error` whose message starts with `Invalid JSONC: `. Messages hold
only fixed text and 1-based line/column numbers, never any part of the input.

| Cause | Message |
|-------|---------|
| Unterminated string | `Invalid JSONC: unterminated string starting at line 2, column 9` |
| Unterminated block comment | `Invalid JSONC: unterminated block comment starting at line 1, column 3` |
| Any other invalid JSON | `Invalid JSONC: malformed JSON` (no position) |
| Non-string argument | `TypeError`: `Invalid JSONC: input must be a string` |

Example:
```ts
__internals.parseJsonc('{ // c
 "url": "https://x.test", }'); // { url: "https://x.test" }
```

## `resolvePlaceholders` (internal)

Reachable only as `__internals.resolvePlaceholders`; it is not a named export and the `config` hook
does not call it yet. Synchronous.

```ts
resolvePlaceholders(input: unknown, deps?: {
  env?: Readonly<Record<string, string | undefined>>; // default: process.env
  homedir?: () => string;                              // default: os.homedir
  readFile?: (path: string) => string;                 // default: guarded reader (below)
}): { value: unknown; unresolved: string[] }
```

Syntax: `{env:NAME}` and `{file:path}` (regex `\{(env|file):([^{}\r\n]+)\}`). Anything else is literal
text. The name or path is used verbatim.

`{env:NAME}` resolves only if `NAME` is an own property of `env` with a non-empty string value.

`{file:path}`:
- Starts with two path separators (`//`, `\\`, mixed): unresolved, nothing is read or expanded.
- Starts with `~/` or `~\`: joined to `homedir()`.
- Absolute (`path.isAbsolute`): used as is.
- Anything else (relative, bare `~`, `~user`): unresolved, no read.
- The default reader reads only regular files (symlinks are followed) of at most 1 048 576 bytes;
  directories, FIFOs, devices and larger files are unresolved. An injected `readFile` is called
  without this guard.
- Content is trimmed; an empty result is unresolved. Any error from `homedir` or `readFile` is
  discarded, never rethrown or logged.

Result:
- A string that is exactly one placeholder and unresolved is dropped: object key omitted, array
  element removed, root `value` is `undefined`.
- Otherwise an unresolved placeholder becomes `""`.
- A single pass is made; resolved values are never re-scanned.
- `unresolved` lists `env:NAME` / `file:path` as written, de-duplicated, in first-occurrence order.
  It holds names and paths only, never values.
- The input is not mutated. Objects and arrays are copied; `__proto__`, `constructor` and
  `prototype` keys are kept as plain own data keys and do not touch prototypes.
- Containers nested 64 or more levels deep (also cyclic input) throw
  `Error("Placeholder resolution: config nested too deeply")`. This is the only error thrown.

Example:
```ts
const { value, unresolved } = __internals.resolvePlaceholders(
  { apiKey: "{env:KEY}", token: "{file:~/.tok}", url: "https://{env:HOST}/v1", rel: "{file:rel.txt}" },
  { env: { KEY: "k1" }, homedir: () => "/home/u", readFile: () => "tok\n" },
);
// value:      { apiKey: "k1", token: "tok", url: "https:///v1" }
// unresolved: ["env:HOST", "file:rel.txt"]
```

Security: resolved values are secrets and exist only in `value`; callers must not log them. The
shared config can read any env variable and any user-readable file, so it must be PR-gated.

## `mergeConfig` (internal)

Reachable only as `__internals.mergeConfig`; it is not a named export and the `config` hook does not
call it yet. Synchronous, returns `undefined`.

```ts
mergeConfig(target: unknown, shared: unknown, mode?: unknown): void
```

Mode: only the exact string `"enforce"` enforces. Anything else (`undefined`, `"ENFORCE"`, `""`,
`null`, numbers) behaves as `"defaults"`.

Rules:
- `target` is mutated in place; it is never replaced, and existing nested plain objects keep their
  identity. `shared` is not mutated. Nothing reachable from `target` afterwards is reachable from `shared`.
- If `target` or `shared` is not a plain object (prototype `Object.prototype` or `null`), nothing happens and nothing is thrown.
- Keys absent locally (or `undefined` locally) are added from `shared`, in both modes.
- Two plain objects are merged recursively, in both modes.
- Any other pair (arrays, `null`, scalar vs object): `defaults` keeps the local value; `enforce`
  writes the shared value, unless the local value is an array or plain object containing a key whose
  lowercase is `apikey` at any depth, in which case the local value is kept.
- Arrays are replaced as a whole, never concatenated.
- Keys of `shared` named `apikey` in any case are skipped at any depth; a local `apiKey` is never changed or removed.
- Top-level `$schema` and `plugin` keys of `shared` are skipped; nested ones are ordinary data.
- Keys `__proto__`, `constructor` and `prototype` of `shared` are skipped at any depth. `Object.prototype` is never modified.
- Keys of `target` not present in `shared` are untouched.
- A `shared` containing a container 64 or more levels deep (also cyclic) throws
  `Error("Config merge: config nested too deeply")`. The check runs before `target` is touched, so
  `target` is unchanged on this error.

Example:
```ts
const target = { model: "local/m", provider: { a: { options: { apiKey: "K" } } }, list: [1] };
__internals.mergeConfig(
  target,
  { model: "shared/m", $schema: "x", provider: { a: { options: { apiKey: "S", baseURL: "https://gw" } } }, list: [2], extra: true },
  "enforce",
);
// target: { model: "shared/m", provider: { a: { options: { apiKey: "K", baseURL: "https://gw" } } }, list: [2], extra: true }
```

Security: the shared `apiKey` is never applied, but the shared file can still set `baseURL` or
`headers` next to a local `apiKey`. The shared repository must be PR-gated.

## `resolveSettings` (internal)

Reachable only as `__internals.resolveSettings`; it is not a named export and the `config` hook does
not call it yet. Synchronous, never throws, no I/O, does not mutate `options`, `deps` or env.

```ts
resolveSettings(options?: unknown, deps?: { env?: Readonly<Record<string, string | undefined>> }): {
  settings: {
    org: string | undefined; project: string | undefined; repo: string | undefined;
    path: string; branch: string; mode: "defaults" | "enforce";
    pat: string | undefined;   // non-enumerable
    timeoutMs: number;
  };
  missing: Array<"org" | "project" | "repo">;
  warnings: string[];
}
```

`options` is the raw plugin options object (anything is accepted). `deps.env` defaults to
`process.env`, read at call time. If `options` is not an object (or is an array), it is ignored with
warning W0. Only own data properties are read; getters are never invoked.

Per setting the order is option, then env, then default. Absent, `null` or whitespace-only values are
skipped silently. Every string is trimmed. An invalid value is skipped with a warning and the next
source is tried.

| Setting | Env variable | Default | Valid when |
|---------|--------------|---------|------------|
| `org`, `project`, `repo` | `KILO_AZDO_ORG`, `KILO_AZDO_PROJECT`, `KILO_AZDO_REPO` | `undefined` | string; no control chars, none of `/ \ ? # %`, not `.` or `..` |
| `path` | `KILO_AZDO_PATH` | `/kilo.jsonc` | string; leading `/` added if missing; no control chars, none of `\ ? # %`; no empty, `.` or `..` segments |
| `branch` | `KILO_AZDO_BRANCH` | `main` | string; no control chars, no space, none of `\ ? # %`, no `..`, no `//`, no leading or trailing `/` |
| `mode` | `KILO_AZDO_MODE` | `defaults` | exactly `defaults` or `enforce` (case-sensitive) |
| `pat` | `KILO_AZDO_PAT` | `undefined` | non-empty string |
| `timeoutMs` | `KILO_AZDO_TIMEOUT_MS` | `5000` | integer 1..2147483647, as a number or a string of digits only |

Results:
- `missing` lists `org`, `project`, `repo` (in that order) whose final value is `undefined`. They have
  no defaults.
- `settings.pat` is an own non-enumerable, read-only property (present even when `undefined`), so
  `Object.keys(settings)` has 7 keys and `JSON.stringify(settings)` never contains the PAT.
  `KILO_AZDO_PAT` is the only PAT source for now; `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT` and `az`
  fallbacks arrive with F-005.
- `warnings` holds only the fixed texts below, never an input value. Order: W0 first, then by
  setting (`org` .. `timeoutMs`), option before env. `<src>` is `plugin option <name>` or
  `environment variable <ENV> (<name>)`.

| Id | Text |
|----|------|
| W0 | `Ignored plugin options: expected an object.` |
| W1 | `Ignored <src>: expected a string.` |
| W2 | `Ignored <src>: contains characters or segments that are not allowed.` |
| W3 | `Ignored <src>: expected "defaults" or "enforce".` |
| W4 | `Ignored <src>: expected a whole number of milliseconds from 1 to 2147483647.` |

Example:
```ts
const { settings, missing, warnings } = __internals.resolveSettings(
  { org: "acme", project: "p", mode: "Enforce", path: "teams/a/kilo.jsonc" },
  { env: { KILO_AZDO_REPO: "cfg", KILO_AZDO_MODE: "enforce", KILO_AZDO_TIMEOUT_MS: "8000" } },
);
// settings: { org: "acme", project: "p", repo: "cfg", path: "/teams/a/kilo.jsonc",
//             branch: "main", mode: "enforce", timeoutMs: 8000 }   (pat hidden, undefined)
// missing:  []
// warnings: ['Ignored plugin option mode: expected "defaults" or "enforce".']
```

## `fetchRemoteConfig` (internal)

Reachable only as `__internals.fetchRemoteConfig`; the `config` hook does not call it yet. Async; the
promise always resolves and never rejects, whatever the arguments.

```ts
fetchRemoteConfig(settings: unknown, deps?: {
  fetch?: (url: string, init: { method: "GET"; headers: Record<string, string>; redirect: "manual"; signal: AbortSignal }) => Promise<Response>;
  env?: Readonly<Record<string, string | undefined>>;   // default: process.env
  runAz?: (args: readonly string[], options: { timeoutMs: number }) => Promise<{ exitCode: number | null; stdout: string }>;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }>
```

`settings` is the `settings` object from `resolveSettings`. A non-function `fetch` or `runAz` in `deps`
counts as unavailable (`network` / `auth-unavailable`); it never falls back to the real one.

Request: one `GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items?path=...&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`,
every value URL-encoded. Headers: `Accept: application/json`, `Authorization`, `X-TFS-FedAuthRedirect: Suppress`.
`redirect: "manual"`, so redirects are never followed.

Authentication, first usable wins:

| Order | Source | Header |
|-------|--------|--------|
| 1 | `settings.pat` (plugin option, else `KILO_AZDO_PAT`) | `Basic base64(":" + pat)` |
| 2 | env `AZDO_PAT` | same |
| 3 | env `AZURE_DEVOPS_EXT_PAT` | same |
| 4 | `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken --output tsv` (run once) | `Bearer <token>` |

A PAT is usable if it is a string, non-empty after trim, with only printable ASCII (0x21-0x7E); others
are skipped silently. With a usable PAT `az` is never run. The az token must come from exit code 0, be
at most 16384 characters and use only `A-Z a-z 0-9 - . _ ~ + /` (optional trailing `=`); otherwise the
result is `auth-unavailable` and no request is made.

Limits: one deadline of `settings.timeoutMs` (5000 if invalid) covers az, the request and the body
read. The body is capped at 1 048 576 bytes (exactly 1 MiB is allowed), checked via `content-length`
and while streaming.

Result: success is `{ ok: true, text }`, where `text` is the `content` string of the JSON response,
unmodified and not parsed. Failure is `{ ok: false, error }` with exactly one code. Results never
contain messages, URLs, headers, PATs, tokens or response text.

| Code | Cause |
|------|-------|
| `invalid-settings` | org/project/repo/path/branch missing or invalid, or `settings` not an object (checked first; nothing else runs) |
| `auth-unavailable` | no usable PAT and the `az` token is unavailable or invalid |
| `timeout` | deadline reached |
| `too-large` | body over 1 MiB |
| `bad-response` | status outside 100..599, no readable body, invalid UTF-8 or JSON, not an object, or `content` not a string |
| `network` | `fetch` unavailable or failed, or body read error |
| `http-<status>` | non-2xx status, e.g. `http-401`, `http-404`, `http-302` |

Example:
```ts
const { settings } = __internals.resolveSettings({ org: "acme", project: "p", repo: "cfg" });
const r = await __internals.fetchRemoteConfig(settings);
if (r.ok) { /* r.text is the raw kilo.jsonc text */ } else { /* r.error, e.g. "http-401" */ }
```

Security: the PAT is never logged or returned. Tests inject fakes; none call the network or `az`.

Authoritative contract: `docs/architecture/contracts/plugin-interface.md` (v0.6.0), ADR-0007 (`docs/architecture/ADR-0007-azdo-fetch-and-auth.md`), ADR-0006 (`docs/architecture/ADR-0006-settings-resolution.md`), ADR-0002, ADR-0003 (`docs/architecture/ADR-0003-jsonc-parser.md`), ADR-0004 (`docs/architecture/ADR-0004-placeholder-resolution.md`) and ADR-0005 (`docs/architecture/ADR-0005-config-merge.md`).
