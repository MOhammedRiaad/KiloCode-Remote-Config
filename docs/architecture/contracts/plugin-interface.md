# Contract: `azdo-remote-config` plugin interface

- Version: 0.7.0 (F-006, cycle-0008: `__internals.runConfigHook`, new section 2f, section 3 hook
  behaviour normative, section 5 cache and logs normative, trust boundary ADR-0009; 0.6.0 was F-005, cycle-0007: `__internals.fetchRemoteConfig`, new section 2e, section 2d
  amended (well-formed UTF-16 rule), sections 4 and 5 normative for the fetch; 0.5.0 was F-004,
  cycle-0006: `__internals.resolveSettings`, section 2d, section 4 now normative; 0.4.0 was F-003, cycle-0005: `__internals.mergeConfig`, section 2c; 0.3.1 was F-002
  rework 1, cycle-0004: default `{file:}` reader guard and UNC rejection; 0.3.0 was F-002,
  cycle-0004; 0.2.0 was F-001, cycle-0003; 0.1.0 was T-001, cycle-0002)
- Owner: Architect. Implemented by: `backend/plugin/azdo-remote-config.ts`.
- This product has **no HTTP API of its own** and no frontend; this typed contract replaces an
  OpenAPI document. It defines (1) what Kilo passes to the plugin, (2) what the plugin returns,
  (3) the plugin options schema, and (4) the outbound calls the plugin makes.

## 1. Types declared inside the plugin file (structural, no `@kilocode/plugin` import)

```ts
/** Kilo log levels accepted by client.app.log. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Minimal subset of the Kilo plugin input that this plugin uses. Everything else is ignored. */
export interface PluginInput {
  client?: {
    app?: {
      log?: (args: {
        body: { service: string; level: LogLevel; message: string; extra?: Record<string, unknown> };
      }) => unknown | Promise<unknown>;
    };
  };
  directory?: string;
  worktree?: string;
  [key: string]: unknown;
}

/** Raw plugin options from the `plugin` tuple; validated later by F-features (FR-1). */
export type PluginOptions = Record<string, unknown> | undefined;

/** Kilo's resolved config: an arbitrary JSON object mutated in place. */
export type KiloConfig = Record<string, unknown>;

export interface Hooks {
  config: (config: KiloConfig) => Promise<void>;
}

export type PluginServer = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;
```

## 2. Module exports (see ADR-0002)

| Export | Kind | Value / contract |
|---|---|---|
| `default` | object | `{ id: "azdo-remote-config", server: PluginServer }` |
| `PLUGIN_ID` | string const | `"azdo-remote-config"` (also the logger `service` name, FR-9) |
| `SUPPORTED_KILO_RANGE` | string const | `">=7.2.0 <8.0.0"` |
| `__internals` | plain object | Test/validator seam. `{ parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings, fetchRemoteConfig, runConfigHook }` since F-006 (sections 2a, 2b, 2c, 2d, 2e, 2f), in that key order; later F-items add further pure helpers. Never has a `server` key; never itself a function. |
| types | `export type` / `export interface` | as in section 1 |

No other named exports: the runtime named exports are exactly `PLUGIN_ID`, `SUPPORTED_KILO_RANGE`
and `__internals` (plus `default`). No named export may be a function. Helpers inside
`__internals` are module-local functions (not exported by name). Their helper types (e.g.
`PlaceholderDeps`, `PlaceholderResult`, `Settings`, `SettingsDeps`, `SettingsResult`, `FetchDeps`,
`FetchResult`, `AzRunner`, `HookDeps`, `CacheFs`, `SharedCheck`) and constants (e.g. `MAX_MERGE_DEPTH`, `DEFAULT_TIMEOUT_MS`,
`MAX_RESPONSE_BYTES`, `AZ_TOKEN_ARGS`, `MAX_CACHE_BYTES`, `MAX_LOGGED_PLACEHOLDERS`) are module-local too
and are not exported.

Imports (FR-11, ADR-0001, ADR-0004): the plugin file may import only `node:` built-ins. Since
F-002 it imports `readFileSync` and `statSync` from `node:fs`, `homedir` from `node:os`, and
`isAbsolute` and `join` from `node:path`. Since F-005 it also imports `execFile` from
`node:child_process` (the only new import). Since F-006 it also imports `mkdirSync`, `renameSync`,
`unlinkSync` and `writeFileSync` from `node:fs` (no other new import). `Buffer`, `TextDecoder`, `AbortController` and
`fetch` are used as globals.

## 2a. `__internals.parseJsonc` (F-001, FR-4, ADR-0003)

```ts
function parseJsonc(text: string): unknown;
```

Access: `import { __internals } from "../../plugin/azdo-remote-config.ts"; __internals.parseJsonc(src)`.

| Aspect | Contract |
|---|---|
| Purity | No I/O, no logging, no globals mutated, deterministic. |
| Accepted syntax | Strict JSON (RFC 8259) plus: `//` line comments, `/* */` block comments (may span lines, may be at EOF without a newline), trailing commas before `}` / `]` (whitespace and comments may sit between the comma and the bracket, at any nesting depth), one optional leading BOM (U+FEFF). |
| Strings | Content between unescaped `"` is never altered: `//`, `/*`, `*/`, `,}` and `,]` inside strings are data. `\"` and `\\` escapes are honoured (a string ending in `\\` closes at the following `"`). |
| Return | The value `JSON.parse` returns for the comment/trailing-comma-free text (`unknown`; any JSON value including primitives). |
| Non-string input | Throws `TypeError` with message `Invalid JSONC: input must be a string`. |
| Unterminated string | Throws `Error`: `Invalid JSONC: unterminated string starting at line L, column C`. |
| Unterminated block comment | Throws `Error`: `Invalid JSONC: unterminated block comment starting at line L, column C`. |
| Anything else invalid (incl. empty / whitespace-only input) | Throws `Error`: `Invalid JSONC: malformed JSON`. The underlying `SyntaxError` is discarded (not set as `cause`). |
| Error message rule | Every message starts with `Invalid JSONC: ` and contains only fixed text and 1-based line / column numbers (UTF-16 code units; `\n` starts a new line, `\r\n` counts as one line break). **No substring of the input ever appears in a message.** |
| Lenient, unspecified | `[,]` and `{,}` may parse as empty containers. Callers must not rely on either outcome. |

## 2b. `__internals.resolvePlaceholders` (F-002, FR-5, ADR-0004)

```ts
interface PlaceholderDeps {                              // module-local, not exported
  env?: Readonly<Record<string, string | undefined>>;   // default: process.env, read at call time
  homedir?: () => string;                                // default: os.homedir, called lazily
  readFile?: (path: string) => string;                   // default: guarded reader (see table)
}
const MAX_PLACEHOLDER_FILE_BYTES = 1024 * 1024;          // module-local, 1 MiB, not exported
interface PlaceholderResult { value: unknown; unresolved: string[] } // module-local

function resolvePlaceholders(input: unknown, deps?: PlaceholderDeps): PlaceholderResult;
```

Access: `__internals.resolvePlaceholders(parsed, { env, homedir, readFile })`. Each omitted
dep uses its default. Synchronous.

| Aspect | Contract |
|---|---|
| Placeholder grammar | A match of the regex `\{(env\|file):([^{}\r\n]+)\}` (backslash before the pipe is only Markdown table escaping): `{`, then `env` or `file`, then `:`, then one or more characters that are not `{`, `}`, CR or LF, then `}`. Name/path used verbatim (no trim). Non-matching text (e.g. `{env:}`, `{foo:x}`, unclosed `{env:X`) is literal and unchanged. |
| Multiple per string | Every placeholder in a string is resolved, left to right, in one pass. Resolved values are **not** re-scanned (an env value containing `{file:...}` stays literal). `$` sequences in values are copied literally. |
| `{env:NAME}` | Resolved iff `NAME` is an **own** property of `env` whose value is a **non-empty** string. Otherwise unresolved (inherited members such as `constructor` never resolve). |
| `{file:PATH}` UNC rejection | Checked first. If the first two characters of `PATH` as written are both `/` or `\` (regex `^[\\/]{2}`: `\\host\share\x`, `//host/share/x`, `\\.\pipe\x`, `\\?\C:\x`, `\/x`, `/\x`), the placeholder is unresolved and **neither `homedir` nor `readFile` is called**. Applies to the default and to injected readers. Not re-applied to the expanded `~/` target. |
| `{file:PATH}` target | `~/rest` or `~\rest` (tilde followed by a forward or back slash) -> `join(homedir(), rest)` (`node:path` join). `isAbsolute(PATH)` -> `PATH`. Anything else (relative path, bare `~`, `~user`) -> unresolved, and `readFile` is **not called**. |
| Default reader (only when `deps.readFile` is omitted) | `(p) => { const st = statSync(p); if (!st.isFile() \|\| st.size > MAX_PLACEHOLDER_FILE_BYTES) throw new Error("unreadable"); return readFileSync(p, "utf8"); }`. Only regular files of at most 1 048 576 bytes are read (exactly 1 MiB is allowed). Directories, FIFOs / pipes, character or block devices (e.g. `/dev/zero`, `/dev/urandom`, `/dev/stdin`), sockets, files over the cap, and symlinks to any of these -> unresolved, and they return promptly (no blocking open, no unbounded read). `statSync` follows symlinks and runs before any open. The thrown error is discarded like every reader error. |
| Injected reader | Called as is: no stat, no file-type check, no size cap. The UNC and relative-path rules still apply before it is called. |
| `{file:PATH}` value | `readFile(target).trim()`. Unresolved if `homedir()` or `readFile()` throws (including the default reader's guard), the reader returns a non-string, or the trimmed value is empty. |
| Whole-string unresolved | If the string is **exactly one** placeholder and it is unresolved, the value is dropped: an object key is omitted (`!("x" in out)`), an array element is removed (`["{env:SET}","{env:MISSING}","keep"]` -> `["abc","keep"]`), and a root string gives `value: undefined`. |
| Partial unresolved | Any other string: each unresolved placeholder becomes `""` (`pre-{env:MISSING}-post` -> `pre--post`; `{env:A}{env:B}` both missing -> `""`, kept). |
| `unresolved` | `"env:" + NAME` / `"file:" + PATH`, using the name or path **as written** (never a value, never an expanded path). De-duplicated, in first-occurrence order (depth-first, object key order, array index order, left to right). Empty array when everything resolved. |
| Other values | Numbers, booleans, `null` and strings without placeholders are returned unchanged. |
| Containers | Arrays -> new array. Any other non-null object -> new ordinary object (prototype `Object.prototype`) with the input's own enumerable string keys in their original order. Every key is written with `Object.defineProperty` (enumerable, writable, configurable), so `__proto__`, `constructor` and `prototype` stay own data properties of the result. `Object.prototype` is never modified. |
| Purity | Input never mutated. No logging, no global state. The only I/O is through `homedir` / `readFile`. |
| Secret safety | Errors from `homedir`/`readFile` are caught without binding and discarded. They are never rethrown, never set as `cause`, and never copied into `value` or `unresolved`. File contents appear only in `value`, and only on success. |
| Depth cap / throws | The root container is level 0. A container at level 64 or deeper (that is, more than 64 nested containers) throws `Error("Placeholder resolution: config nested too deeply")`. A cyclic input throws the same error. This is the **only** error the function may throw. 64 nested arrays resolve; 65 throw. |
| Wiring | Since F-006 called by `runConfigHook` (2f) on the chosen remote or cached config with the hook's `env`, `homedir`, `readFile` deps; `unresolved` is logged as L-UNRESOLVED (names only, sanitised). |

## 2c. `__internals.mergeConfig` (F-003, FR-6, AC-6, AC-7, ADR-0005)

```ts
const MAX_MERGE_DEPTH = 64;                                  // module-local, not exported
function mergeConfig(target: unknown, shared: unknown, mode?: unknown): void;
```

Access: `__internals.mergeConfig(kiloConfig, resolvedShared, "defaults" | "enforce")`. Synchronous.
Returns `undefined`.

| Aspect | Contract |
|---|---|
| Effect | Mutates `target` in place. Never replaces `target`, never replaces an existing nested plain object of `target` (references such as `target.provider` stay identical). No I/O, no logging, no global state. |
| Mode | `mode === "enforce"` (strict, case-sensitive) -> enforce. Any other value (including `undefined`, `"ENFORCE"`, `""`, `null`, numbers) -> defaults. |
| Plain object | `typeof v === "object" && v !== null && !Array.isArray(v)` and prototype is `Object.prototype` or `null`. Everything else (arrays, `null`, primitives, Date, Map, class instances) is a leaf. |
| Non-object inputs | `target` or `shared` not a plain object -> return, nothing changed, no throw. |
| Phase 1 (sanitize) | Deep clone of `shared` into fresh arrays and ordinary objects (`Object.keys`, `Object.defineProperty` writes). Runs completely before `target` is touched. |
| Skipped keys, any depth | Key with `key.toLowerCase() === "apikey"`; keys `__proto__`, `constructor`, `prototype` (exact). Applies inside objects nested in arrays as well. |
| Skipped keys, top level only | `$schema`, `plugin` (exact). Nested keys with these names are ordinary data. |
| Non-JSON values in `shared` | `undefined`, function, symbol, bigint, non-plain object: omitted as an object value; `null` as an array element. |
| Absent locally | `target` has no own property `k`, or its own value is `undefined` -> the sanitized shared value is written, in both modes. |
| Both plain objects | Recurse into the existing `target[k]`, in both modes. |
| Conflict (any other pair, incl. arrays, `null`, object vs scalar) | `defaults`: keep local. `enforce`: write the sanitized shared value, **unless** the local value is an array or plain object containing (any depth, own enumerable keys, through arrays and plain objects) a key whose lowercase is `apikey`; then keep local. The scan treats level >= 64 (deep or cyclic local) as "contains". The scan never throws. |
| Arrays | Leaves; replaced wholesale, never concatenated or merged by index. |
| Writes | Only `Object.defineProperty(t, k, { value, enumerable: true, writable: true, configurable: true })`; own-property checks via `Object.prototype.hasOwnProperty.call`. New keys appended in shared key order; existing keys keep position. |
| Untouched | Keys of `target` not present in the sanitized shared tree are never read, written or deleted. Own keys `__proto__` / `constructor` / `prototype` of `target` are left alone. |
| apiKey (AC-6) | A local `apiKey` at any depth is never changed or removed in either mode; a shared `apiKey` is never added. |
| Aliasing | After the call no object or array reachable from `target` is reachable from `shared`; `shared` is not mutated (deep-equal before and after). |
| Pollution | `Object.prototype` is never modified; the prototype of `target` and of every nested object is never changed. |
| Depth cap / throws | Phase 1: root container is level 0; a container at level 64 or deeper in `shared` throws `Error("Config merge: config nested too deeply")`. Cyclic `shared` throws the same error. 64 nested containers merge; 65 throw. On this throw `target` is unchanged. This is the only error the function itself throws. |
| Out of contract | Frozen / sealed / non-configurable `target` properties: `Object.defineProperty` may throw `TypeError`. F-006 catches everything. |
| Wiring | Since F-006 `runConfigHook` (2f) uses phase 1 (`sanitizeShared`) for the cache content and a journaled variant of phase 2 (`applyShared`, ADR-0008 section 6) with rollback; `mergeConfig` itself is unchanged. |

## 2d. `__internals.resolveSettings` (F-004, FR-1, FR-8, settings half of FR-3, ADR-0006)

```ts
type Mode = "defaults" | "enforce";                       // module-local
type RequiredSetting = "org" | "project" | "repo";        // module-local
interface Settings {                                      // module-local
  org: string | undefined; project: string | undefined; repo: string | undefined;
  path: string; branch: string; mode: Mode;
  pat: string | undefined;                                // own NON-enumerable property
  timeoutMs: number;
}
interface SettingsDeps { env?: Readonly<Record<string, string | undefined>> } // default process.env
interface SettingsResult { settings: Settings; missing: RequiredSetting[]; warnings: string[] }
const DEFAULT_PATH = "/kilo.jsonc"; const DEFAULT_BRANCH = "main";            // module-local
const DEFAULT_TIMEOUT_MS = 5000; const MAX_TIMEOUT_MS = 2147483647;          // module-local

function resolveSettings(options?: unknown, deps?: SettingsDeps): SettingsResult;
```

Access: `__internals.resolveSettings(options, { env })`. Synchronous. `options` is the raw second
element of the Kilo plugin tuple (anything).

| Aspect | Contract |
|---|---|
| Purity | No I/O, no logging, no global state; never writes to `options`, `deps` or env. |
| Options shape | Used iff non-null, non-array object (checked inside `try`). `undefined` / `null` -> no options, no warning. Anything else -> no options + W0. |
| Env | `deps.env` if it is a non-null, non-array object; `process.env` (read at call time) if `deps` or `deps.env` is `undefined`; any other `deps.env` -> empty env. |
| Reads | Only the 8 fixed option keys and 8 fixed env names. Each read: `Object.getOwnPropertyDescriptor` inside `try`; only own **data** properties count (inherited, accessor, or throwing-trap -> absent; getters never invoked). Other keys (incl. own `__proto__` / `constructor` / `prototype`) are never read or copied. |
| Precedence | Per setting: option, then env, then default. Absent (`undefined` / `null` / not own) or empty (whitespace-only string) -> skip silently. Invalid -> skip with warning. First valid value wins. |
| Defaults | org / project / repo / pat: `undefined`. path `/kilo.jsonc`, branch `main`, mode `defaults`, timeoutMs `5000`. |
| Trim | Every string value is `trim()`-ed before validation; the trimmed value is returned. |
| Well-formed (since 0.6.0) | org, project, repo, branch and path must also be well-formed UTF-16 after trim (`isWellFormedText`: every 0xD800-0xDBFF code unit is immediately followed by a 0xDC00-0xDFFF one, and no 0xDC00-0xDFFF unit stands alone). Otherwise W2 and fall-through, like any disallowed character. pat, mode, timeoutMs unchanged. |
| org, project, repo | string; valid iff non-empty, well-formed, no control chars (code unit <= 0x1F or 0x7F), none of `/ \ ? # %`, not exactly `.` or `..`. Else W1 (non-string) / W2. |
| branch | string; valid iff non-empty, well-formed, no control chars, no space, none of `\ ? # %`, no `..`, no `//`, does not start or end with `/`. Else W1 / W2. |
| path | string; prepend `/` if missing; valid iff well-formed, no control chars, none of `\ ? # %`, and every segment after the leading `/` (split on `/`) is non-empty and not `.` / `..`. `teams/a/kilo.jsonc` -> `/teams/a/kilo.jsonc`; `/`, `/a/`, `/a//b`, `/a/../b`, `./x` -> W2. Else W1 / W2. |
| mode | exactly `defaults` or `enforce` after trim (case-sensitive). Anything else (any type) -> W3. |
| pat | string; valid iff non-empty after trim. No charset check. Non-string -> W1. |
| timeoutMs | number: `Number.isInteger(v) && 1 <= v <= 2147483647`. string: trimmed matches `^[0-9]+$` and `Number(trimmed)` in 1..2147483647. Anything else (incl. `0`, negatives, `NaN`, `Infinity`, `2.5`, `"1e3"`, `"abc"`, booleans, objects) -> W4. |
| `settings` | Fresh ordinary object; keys created in order org, project, repo, path, branch, mode, pat, timeoutMs. `pat` is defined with `enumerable: false, writable: false, configurable: false` (also when `undefined`), so `Object.keys(settings)` has 7 keys and `JSON.stringify(settings)` never contains the PAT. |
| `missing` | `["org","project","repo"]` filtered to those whose final value is `undefined`, in that order. |
| `warnings` | Only the fixed texts below. W0 first, then by setting order org..timeoutMs, option before env. At most one per setting and source. |
| Throws | Never (no `throw` statement; all reads of untrusted input guarded). |
| Secret safety | No input value (PAT or other) ever appears in `missing` or `warnings`. |
| Wiring | Since F-006 called first by `runConfigHook` (2f); `warnings` logged at warn (L-SET), `missing` names logged (L-MISSING) and the fetch skipped. `AZDO_PAT` / `AZURE_DEVOPS_EXT_PAT` / `az` are handled by `fetchRemoteConfig` (section 2e), not here. |

Warning texts. `<src>` is `plugin option <name>` or `environment variable <ENV> (<name>)`, where
`<name>` is the camelCase setting name and `<ENV>` the env var from section 4:

| Id | Text |
|---|---|
| W0 | `Ignored plugin options: expected an object.` |
| W1 | `Ignored <src>: expected a string.` |
| W2 | `Ignored <src>: contains characters or segments that are not allowed.` |
| W3 | `Ignored <src>: expected "defaults" or "enforce".` |
| W4 | `Ignored <src>: expected a whole number of milliseconds from 1 to 2147483647.` |

## 2e. `__internals.fetchRemoteConfig` (F-005, FR-2, FR-3, FR-8, FR-10, ADR-0007)

```ts
type FetchErrorCode =                                    // module-local
  | "invalid-settings" | "auth-unavailable" | "timeout" | "too-large"
  | "bad-response" | "network" | `http-${number}`;
type FetchResult = { ok: true; text: string } | { ok: false; error: FetchErrorCode };
interface FetchInit { method: "GET"; headers: Record<string, string>; redirect: "manual"; signal: AbortSignal }
type FetchLike = (url: string, init: FetchInit) => Promise<Response>;
interface AzRunResult { exitCode: number | null; stdout: string }
type AzRunner = (args: readonly string[], options: { timeoutMs: number }) => Promise<AzRunResult>;
interface FetchDeps {
  fetch?: FetchLike;                                     // default globalThis.fetch (call time)
  env?: Readonly<Record<string, string | undefined>>;   // default process.env (call time)
  runAz?: AzRunner;                                      // default execFile runner, no shell
  setTimeout?: (callback: () => void, ms: number) => unknown;  // default globalThis.setTimeout
  clearTimeout?: (handle: unknown) => void;                    // default globalThis.clearTimeout
}
const MAX_RESPONSE_BYTES = 1024 * 1024;                  // 1 MiB; exactly 1 MiB allowed
const AZ_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
const AZ_TOKEN_ARGS = ["account", "get-access-token", "--resource", AZ_RESOURCE,
                       "--query", "accessToken", "--output", "tsv"];   // module-local, frozen
const MAX_TOKEN_CHARS = 16384;

async function fetchRemoteConfig(settings: unknown, deps?: unknown): Promise<FetchResult>;
```

Access: `await __internals.fetchRemoteConfig(resolveSettings(opts).settings, { fetch, env, runAz })`.

| Aspect | Contract |
|---|---|
| Never throws | The returned promise always resolves, for any `settings` / `deps` (incl. `null`, primitives, throwing proxies, throwing or never-settling fakes). No `throw` statement. Catch-all fallback: `{ ok: false, error: "network" }`. |
| Result | Fresh plain object: `{ ok: true, text }` or `{ ok: false, error }`, no other keys. `error` is exactly one fixed code; `http-<status>` uses the integer status 100..599 (non-2xx). No message, value, URL, header, PAT, token, stdout or underlying error text ever appears in a result. |
| Purity | Never writes to `settings`, `deps`, env or globals. No logging. |
| Reads | `settings` and `deps` keys via `readOwn` (own data properties only; getters never invoked). `settings` not record-like -> `invalid-settings`. `deps` not record-like -> `{}`. |
| Deps | `fetch` / `runAz`: `undefined` -> default; function -> used; any other value -> **unavailable** (`fetch` -> `network` with no call; `runAz` -> `auth-unavailable` when needed). Never falls back to a real default for a wrong injected value. `env`: `selectEnv` rule of 2d (non-record-like injected -> empty env). `setTimeout` / `clearTimeout`: non-function -> global. Default `fetch` not a function -> `network`. Order: settings check first, then fetch availability, then timer, then credentials. |
| 1. Settings check | Before anything else (no fetch, no runAz, no env read, no timer). org/project/repo: string, well-formed, `acceptName(v) === v`. path: string, well-formed, `acceptPath(v) === v`. branch: string, well-formed, `acceptBranch(v) === v`. Any failure -> `invalid-settings`. `timeoutMs`: `inTimeoutRange(v)` ? v : 5000. |
| 2. URL | String concatenation, every value through `encodeURIComponent`: `https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items?path={path}&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`. Passed to fetch as a string. Example: org `my org`, project `plat form`, repo `kilo-config`, path `/teams/a b/kilo.jsonc`, branch `release/1` -> `https://dev.azure.com/my%20org/plat%20form/_apis/git/repositories/kilo-config/items?path=%2Fteams%2Fa%20b%2Fkilo.jsonc&versionDescriptor.version=release%2F1&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`. |
| 3. Deadline | One `AbortController` + one timer (`setTimeout(cb, timeoutMs)`), started after steps 1-2, before credentials. Covers az + fetch + whole body read. Every await on runAz / fetch / `reader.read()` is raced with the deadline. Timer always cleared in `finally`. |
| 4. Credentials | First usable of: `settings.pat`, env `AZDO_PAT`, env `AZURE_DEVOPS_EXT_PAT` (own data properties). Usable = string whose `trim()` is non-empty and only code units 0x21..0x7E; unusable values are skipped silently. Header `Basic ` + `Buffer.from(":" + pat, "utf8").toString("base64")`. With a usable PAT `runAz` is never called. |
| 5. az | No usable PAT: `runAz(AZ_TOKEN_ARGS, { timeoutMs })` exactly once. Token accepted iff resolved value is record-like, own `exitCode === 0`, own `stdout` string, `stdout.trim()` non-empty, <= 16384 chars, chars only `A-Z a-z 0-9 - . _ ~ + /` with optional trailing `=`. Else (sync throw, rejection, deadline, non-zero/null exit, empty, bad chars) -> `auth-unavailable` and **fetch is not called**. Header `Bearer ` + trimmed token. |
| 6. Request | Exactly one `fetch(url, init)`. `init` keys exactly: `method: "GET"`, `headers` (plain object with exactly, in order: `Accept: "application/json"`, `Authorization`, `X-TFS-FedAuthRedirect: "Suppress"`), `redirect: "manual"`, `signal`. Sync throw / rejection -> `network` (or `timeout` if the deadline fired). Deadline first -> `timeout`; the signal is aborted. |
| 7. Status | `response.status` integer 200..299 -> continue; integer 100..599 otherwise -> `http-<status>` (3xx included, redirects are never followed); anything else -> `bad-response`. Body cancelled (guarded) on early return. |
| 8. Size | `content-length` header made of ASCII digits only and > 1048576 -> `too-large` without reading. Body read through `response.body.getReader()` (missing -> `bad-response`; non-`Uint8Array` chunk -> `bad-response`); running total > 1048576 -> reader cancelled, `too-large`. Read error -> `network` (`timeout` if the deadline fired). Cap applies before decoding and parsing. |
| 9. Body | `TextDecoder("utf-8", { fatal: true })`; decode error, `JSON.parse` error, parsed value not record-like, or own `content` not a string -> `bad-response`. Else `{ ok: true, text: content }` (exact string, not trimmed, not parsed). |
| Default runAz | `execFile` from `node:child_process`, never `shell: true`, options `{ timeout: timeoutMs, maxBuffer: 65536, windowsHide: true, encoding: "utf8", cwd: homedir() }`. POSIX: file `az`, args as given. Windows (`process.platform === "win32"`): file = own absolute `process.env.ComSpec` or `"cmd.exe"`, args `["/d", "/s", "/c", "az " + args.join(" ")]` (args are the constant `AZ_TOKEN_ARGS`; no input ever reaches the command line). Callback: no error -> `{ exitCode: 0, stdout }`; numeric `error.code` -> `{ exitCode: code, stdout: "" }`; other error -> `{ exitCode: null, stdout: "" }`. Wrapped so it never rejects with data. Not covered by tests (no real az). |
| Wiring | Since F-006 called by `runConfigHook` (2f) when `missing` is empty; an error code is logged verbatim as `<reason>` (L-CACHE / L-NONE), then the cache fallback applies. |

## 2f. `__internals.runConfigHook` (F-006, FR-6, FR-7, FR-9, FR-10, ADR-0008, ADR-0009)

```ts
interface CacheFs {                                       // module-local; methods called unbound
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown;
  writeFileSync(path: string, data: string, options: { encoding: "utf8"; mode: number; flag: "wx" }): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  statSync(path: string): { isFile(): boolean; size: number };
  readFileSync(path: string, encoding: "utf8"): string;
}
interface HookDeps {                                      // module-local; all optional
  env?: Readonly<Record<string, string | undefined>>;    // -> resolveSettings, fetchRemoteConfig, resolvePlaceholders
  fetch?: FetchLike; runAz?: AzRunner;                    // -> fetchRemoteConfig
  setTimeout?: (callback: () => void, ms: number) => unknown; clearTimeout?: (handle: unknown) => void;
  homedir?: () => string;                                 // cache path + {file:~/}; default os.homedir
  readFile?: (path: string) => string;                    // -> resolvePlaceholders
  fs?: CacheFs;                                           // default: real node:fs sync functions
}
type SharedCheck = { ok: true; value: Record<string, unknown> } | { ok: false; error: "invalid-jsonc" | "invalid-shape" };
const MAX_CACHE_BYTES = 2 * 1024 * 1024;                  // exactly 2 MiB allowed
const MAX_LOGGED_PLACEHOLDERS = 20; const MAX_LOGGED_NAME_CHARS = 200;

async function runConfigHook(input: unknown, options: unknown, config: unknown, deps?: unknown): Promise<void>;
```

Access: `await __internals.runConfigHook(fakeInput, options, kiloConfig, { env, fetch, runAz, homedir, fs, readFile })`.
The default export's hook is exactly `(config) => runConfigHook(input, options, config)` (no deps).

| Aspect | Contract |
|---|---|
| Never rejects | For any arguments (including `null`, primitives, frozen or proxied objects, throwing / rejecting / hanging-logger fakes). Outer `try` / `catch` without binding -> L-UNEXPECTED. |
| Deps | Read with `readOwn`; non-record-like `deps` -> `{}`. Absent key -> each helper's default. `homedir` present but not a function, or `fs` present but not record-like -> cache unavailable (never the real home / fs). A missing or non-function `fs` method -> that operation fails. `env`, `fetch`, `runAz`, `setTimeout`, `clearTimeout`, `readFile` passed through (each helper's own rules, 2b / 2d / 2e). Only non-`undefined` keys are passed on. |
| Order | 0 logger; 1 `config` not a plain object -> L-BADCONFIG, return; 2 `resolveSettings(options, {env})`, each warning -> L-SET; 3 `missing` non-empty -> L-MISSING, reason `missing-settings`, **no fetch, no runAz**; else `fetchRemoteConfig(settings, {fetch, env, runAz, setTimeout, clearTimeout})`, then `validateShared(text)`; 4 remote ok -> L-REMOTE, write cache (failure -> L-CACHE-WRITE); otherwise read cache: ok -> L-CACHE, else L-NONE and return; 5 `resolvePlaceholders(shared, {env, homedir, readFile})`, unresolved -> L-UNRESOLVED; 6 transactional merge with `settings.mode` -> L-APPLIED or L-MERGE (ADR-0008 section 2). |
| Reasons | `<reason>` = a `FetchErrorCode` (2e) \| `missing-settings` \| `invalid-jsonc` \| `invalid-shape`. |
| Validation | `validateShared(text)`: non-string or `parseJsonc` throws -> `invalid-jsonc`; root not a plain object, or a container at level >= 64 (root 0) -> `invalid-shape`. Applied to fetched text and to cache text alike. Invalid content is never cached, never merged. |
| Cache path | `join(homedir(), ".cache", "kilo-azdo", "remote-config.json")`. `homedir` throws / non-string / empty / not `isAbsolute` -> `cache-unavailable`, no fs call. |
| Cache content | `JSON.stringify(sanitizeShared(shared), null, 2) + "\n"` of the validated **unresolved** shared config (2c phase 1: no `apiKey`, no prototype keys, no top-level `$schema` / `plugin`). Never contains a resolved placeholder value. Serialised size > `MAX_CACHE_BYTES` (UTF-8 bytes) -> `cache-too-large`, not written. |
| Cache write | Only after a validated fetch. `mkdirSync(dir, {recursive: true, mode: 0o700})`; `writeFileSync(tmp, data, {encoding: "utf8", mode: 0o600, flag: "wx"})` with `tmp = file + "." + pid + "-" + Date.now() + "-" + counter + ".tmp"` in the same directory; `renameSync(tmp, file)`. Any throw -> guarded `unlinkSync(tmp)` (if the temp write was attempted), `cache-write-failed`. Never writes to `file` directly. POSIX mode 0600. |
| Cache read | Only on the fallback path. `statSync(file)` throw with `code === "ENOENT"` -> `cache-missing`, other throw -> `cache-unreadable`; not `isFile()` or `size > MAX_CACHE_BYTES` -> `cache-unreadable`; `readFileSync(file, "utf8")` throw / non-string -> `cache-unreadable`; `validateShared` fails -> `cache-invalid`. The cache is never modified on this path. |
| Merge | `applyShared(config, resolved, settings.mode)`: sanitize, journaled phase-2 merge, on any throw roll back in reverse (`Reflect.deleteProperty` for new keys, `Reflect.defineProperty(previous)` otherwise). Result: `config` is the same reference and is either deep-equal to its original or fully merged (frozen / sealed / non-extensible / non-configurable targets). |
| Logger | `input.client.app.log` read with ordinary property access in `try` (SDK class instances: `log` may be a prototype method); called as `log.call(app, { body: { service: "azdo-remote-config", level, message } })`; never awaited; sync throw caught; a returned thenable gets a rejection handler. Missing / non-function -> silent. **No `extra`**, no other argument. |
| Log text | Only the fixed messages of section 2f-L below. Never a value, `err.message`, URL, path, token, PAT, or the `settings` object. |
| Server | `server(input, options)` does no I/O and no logging; returns `{ config }`. |

### 2f-L. Log messages (service `azdo-remote-config`)

| Id | Level | Exact message |
|---|---|---|
| L-SET | warn | the `resolveSettings` warning text verbatim (W0-W4, 2d) |
| L-MISSING | warn | `Remote config skipped: missing required settings: <names>.` (`missing.join(", ")`) |
| L-REMOTE | info | `Loaded shared config from Azure DevOps.` |
| L-CACHE-WRITE | warn | `Could not update the config cache (<writeCode>).` (`cache-unavailable` \| `cache-too-large` \| `cache-write-failed`) |
| L-CACHE | warn | `Remote config unavailable (<reason>); using cached config.` |
| L-NONE | error | `Remote config unavailable (<reason>) and no usable cache (<readCode>); continuing with local config only.` (`cache-unavailable` \| `cache-missing` \| `cache-unreadable` \| `cache-invalid`) |
| L-UNRESOLVED | warn | `Unresolved placeholders: <names>.` |
| L-APPLIED | info | `Applied shared config from <remote\|cache> in <defaults\|enforce> mode.` |
| L-MERGE | error | `Could not apply the shared config; local config left unchanged.` |
| L-BADCONFIG | error | `Shared config not applied: the Kilo config is not an object.` |
| L-UNEXPECTED | error | `Remote config failed unexpectedly; continuing with local config only.` |

`<names>` for L-UNRESOLVED: each `unresolved` entry with code units `<= 0x1F`, `0x7F`, `0x80..0x9F`
replaced by `?`, cut to 200 code units; at most 20 entries joined with `", "`, then
`, and <n> more` when entries were left out. Example: `Unresolved placeholders: env:MISSING.`

Example sequences:
- success, defaults: L-REMOTE, L-APPLIED (`Applied shared config from remote in defaults mode.`)
- fetch `timeout`, valid cache: L-CACHE (`Remote config unavailable (timeout); using cached config.`), L-APPLIED (`... from cache ...`)
- missing `org`, no cache: L-MISSING (`Remote config skipped: missing required settings: org.`), L-NONE (`Remote config unavailable (missing-settings) and no usable cache (cache-missing); continuing with local config only.`)

## 3. Behaviour contract

### `server(input, options)`
- MUST resolve (never reject) for any `input` (including `{}`) and any `options`
  (including `undefined`, `null`, non-objects).
- MUST NOT perform network or filesystem I/O and MUST NOT log (since F-006 all work is done
  lazily in the `config` hook; ADR-0008).
- Returns an object whose `config` property is a function.

### `hooks.config(config)`
- Called by Kilo once with the fully resolved config; Kilo awaits it.
- MUST resolve (never reject) for any argument.
- **Since F-006:** runs `runConfigHook(input, options, config)` (section 2f). Mutates `config` in
  place per FR-6 (section 2c rules, transactional); never replaces the object. After the call
  `config` is the same reference and is either unchanged or fully merged.
- The T-001 "no-op" behaviour is superseded.

## 4. Plugin options schema (FR-1) - normative since 0.5.0 (rules: section 2d, ADR-0006)

| Option | Type | Env fallback | Default |
|---|---|---|---|
| `org` | string | `KILO_AZDO_ORG` | none (required for fetch; listed in `missing`) |
| `project` | string | `KILO_AZDO_PROJECT` | none (required; listed in `missing`) |
| `repo` | string | `KILO_AZDO_REPO` | none (required; listed in `missing`). Supersedes the informative `kilo-config` default of 0.4.0. |
| `path` | string | `KILO_AZDO_PATH` | `/kilo.jsonc` |
| `branch` | string | `KILO_AZDO_BRANCH` | `main` |
| `mode` | `"defaults" \| "enforce"` | `KILO_AZDO_MODE` | `defaults` |
| `pat` | string (secret) | `KILO_AZDO_PAT`; then `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT` (read by `fetchRemoteConfig`, 2e) | none -> `az` Entra token (2e) |
| `timeoutMs` | positive integer (1..2147483647) or digit string | `KILO_AZDO_TIMEOUT_MS` | `5000` |

## 5. Outbound calls (Items API and az normative since 0.6.0, section 2e; cache and logs since 0.7.0, section 2f)

- **Azure DevOps Git Items API** (FR-2):
  `GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items?path={path}&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`
  (every value `encodeURIComponent`-encoded), headers `Accept: application/json`,
  `Authorization: Basic base64(":" + pat)` or `Authorization: Bearer <entra token>` (FR-3),
  `X-TFS-FedAuthRedirect: Suppress`; `redirect: "manual"`; aborted after `timeoutMs` (FR-8);
  response body capped at 1 MiB; file text = JSON body `content` string.
- **`az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken --output tsv`**
  (FR-3) when no PAT is usable; `execFile` without a shell (`cmd.exe /d /s /c` with a constant
  command line on Windows), cwd = home directory, bounded by the same deadline.
- **Cache file** `~/.cache/kilo-azdo/remote-config.json` (FR-7), normative since 0.7.0: section 2f
  (sanitised unresolved shared config, dir 0700, file 0600 on POSIX, temp file + rename, read and
  validated only on the fallback path).
- **Logs** only via `input.client.app.log` with `service: "azdo-remote-config"`, normative since
  0.7.0: fixed messages of section 2f-L, no `extra`, fire and forget; never secret values (FR-9).
- **Trust boundary** (ADR-0009): settings only from the global Kilo config's plugin options and
  the process env; project-level configs unsupported; fetched and cached content validated as
  untrusted before caching / merging.
