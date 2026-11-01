# API reference

This product has no HTTP API. It is a Kilo plugin.

## Plugin interface

File: `backend/plugin/azdo-remote-config.ts`. Default export, Kilo v1 plugin module shape:

```ts
export default { id: "azdo-remote-config", server }
// server(input, options?) => Promise<{ config(config) => Promise<void> }>
```

- `config` hook: receives Kilo's resolved config and calls `runConfigHook(input, options, config)`, which mutates `config` in place (merge) and never rejects. `server` itself does no I/O and does not log.
- Named exports: `PLUGIN_ID` (`"azdo-remote-config"`), `SUPPORTED_KILO_RANGE` (`">=7.2.0 <8.0.0"`)
  and `__internals` (test seam, now `{ parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings, fetchRemoteConfig, runConfigHook }`).
- The plugin settings (`org`, `project`, `repo`, `path`, `branch`, `mode`, `pat`, `timeoutMs`) are
  read by the hook through `resolveSettings` (below), and the shared file is fetched with `fetchRemoteConfig`.
  See `runConfigHook` at the end of this page.

## `parseJsonc` (internal)

Reachable only as `__internals.parseJsonc`; it is not a named export and the `config` hook
uses it. Signature: `parseJsonc(text: string): unknown`.

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
uses it. Synchronous.

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

Reachable only as `__internals.mergeConfig`; it is not a named export and the `config` hook
uses it. Synchronous, returns `undefined`.

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

Reachable only as `__internals.resolveSettings`; it is not a named export and the `config` hook
uses it. Synchronous, never throws, no I/O, does not mutate `options`, `deps` or env.

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

Reachable only as `__internals.fetchRemoteConfig`; the `config` hook calls it. Async; the
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
| `network-unreachable` | `fetch` rejected (or threw synchronously) before the deadline: DNS failure, refused or reset connection |
| `network-blocked` | HTTP 407, HTTP 470 (any `Content-Type`), or HTTP 403 whose `Content-Type` is not JSON (for example an HTML firewall/WAF block page); the body is not read |
| `timeout` | deadline reached (a firewall silently dropping packets ends here) |
| `too-large` | body over 1 MiB |
| `bad-response` | status outside 100..599, no readable body, invalid UTF-8 or JSON, not an object, or `content` not a string |
| `network` | catch-all: no usable `fetch`, internal error, or body stream read error |
| `http-401` | status 401, whatever the content type |
| `http-403` | status 403 with a JSON `Content-Type` (a real Azure DevOps permission or IP-policy answer) |
| `http-<status>` | any other non-2xx status, e.g. `http-404`, `http-302` |

Behaviour change: a rejected `fetch` used to be reported as `network`; it is now `network-unreachable`.
The request is still made once per start, with no probe. Contract: plugin-interface.md 0.9.1 section 2e
(rows 6, 7, 7a) and 2f-L; rationale in [ADR-0020](architecture/ADR-0020-plugin-fetch-network-classification.md) (amendment A1).
HTTP 470 is the Azure Firewall application-rule deny status. This is community-reported and unofficial; Microsoft does not document it. The plugin reads it as `network-blocked` whatever the `Content-Type`, without reading the body, so it gets the network hint.
`runConfigHook` logs one fixed hint after the error line for these codes; see
[the user guide](user-guide.md#troubleshooting-log-messages).
Not classified yet: HTML sign-in pages answered with 203.

Example:
```ts
const { settings } = __internals.resolveSettings({ org: "acme", project: "p", repo: "cfg" });
const r = await __internals.fetchRemoteConfig(settings);
if (r.ok) { /* r.text is the raw kilo.jsonc text */ } else { /* r.error, e.g. "http-401" */ }
```

Security: the PAT is never logged or returned. Tests inject fakes; none call the network or `az`.

## `runConfigHook` (internal)

Reachable as `__internals.runConfigHook`; it is what the default export's `config` hook runs.
Signature: `runConfigHook(input, options, config, deps?): Promise<void>`. It never rejects, for any arguments.

Order of work:
1. `config` must be a plain object, otherwise log and return.
2. `resolveSettings(options, { env })`; each warning is logged.
3. If required settings are missing (`org`, `project`, `repo`), log the missing-settings warning and the
   `cache-skipped` error, and return with `config` untouched. No network, no `az`, no file system access:
   the cache is not used.
4. `fetchRemoteConfig`, then validate the text (valid JSONC, root is an object, nesting below 64 levels).
   On success, write the cache envelope bound to the current settings (a failure to write only logs a warning).
5. If the fetch or validation fails, read and validate the cache, and apply it only if its binding equals the
   current settings. If there is no usable cache (including `cache-outdated` and `cache-mismatch`), log and
   return with `config` untouched.
6. Resolve placeholders, then merge into `config` in `settings.mode`, transactionally: on any error `config`
   is rolled back, so it is either unchanged or fully merged. Same object reference.

Cache: `~/.cache/kilo-azdo/remote-config.json`. Content is an envelope (contract 0.8.0 section 2f-C, ADR-0018):

```json
{
  "format": "kilo-azdo-cache-v1",
  "binding": { "org": "acme", "project": "p", "repo": "cfg", "path": "/kilo.jsonc", "branch": "main" },
  "config": { }
}
```

`config` is the sanitised, unresolved shared config
(no `apiKey`, no top-level `$schema` or `plugin`, no resolved placeholder values). The cache is applied on a failed
fetch only if all five `binding` fields exactly equal the current resolved settings (case-sensitive, after
`resolveSettings` normalisation). `mode`, `timeoutMs` and `pat` are never stored. A file without the
`kilo-azdo-cache-v1` format (the old format) is unusable (`cache-outdated`) until the next successful fetch rewrites it;
a binding that differs is `cache-mismatch`. Both are reported in the "no usable cache" error line with fixed text and
never log setting values. The binding is not an integrity check (ADR-0009 section 3). The file is pretty-printed JSON, at most
2 MiB. Written only after a validated fetch, to a temp file in the same directory and then renamed; directory mode
0700 and file mode 0600 on POSIX. Read only on the fallback path and never modified there.

Logging: `input.client.app.log` with `service: "azdo-remote-config"`, fire and forget, fixed messages only (no
`extra`). If no logger exists the plugin is silent. The messages are listed in the
[user guide](user-guide.md#troubleshooting-log-messages).

`deps` (all optional, for tests): `env`, `fetch`, `runAz`, `setTimeout`, `clearTimeout`, `homedir`, `readFile`, `fs`.

Example:
```ts
const config = { model: "local/model" };
await __internals.runConfigHook(
  { client: { app: { log: (m) => console.log(m.body.level, m.body.message) } } },
  { org: "acme", project: "p", repo: "cfg" },
  config,
);
// config now contains the shared settings (defaults mode), or is unchanged on failure
```

Trust boundary (ADR-0009): settings come only from the global plugin options, the process environment and
`az`; the fetched and cached content is treated as untrusted and validated before it is cached or merged.

Authoritative contract: `docs/architecture/contracts/plugin-interface.md` (v0.8.0), ADR-0018 (cache binding), ADR-0008 (`docs/architecture/ADR-0008-config-hook-wiring-cache-logging.md`), ADR-0009 (`docs/architecture/ADR-0009-settings-and-content-trust-boundary.md`), ADR-0007 (`docs/architecture/ADR-0007-azdo-fetch-and-auth.md`), ADR-0006 (`docs/architecture/ADR-0006-settings-resolution.md`), ADR-0002, ADR-0003 (`docs/architecture/ADR-0003-jsonc-parser.md`), ADR-0004 (`docs/architecture/ADR-0004-placeholder-resolution.md`) and ADR-0005 (`docs/architecture/ADR-0005-config-merge.md`).
