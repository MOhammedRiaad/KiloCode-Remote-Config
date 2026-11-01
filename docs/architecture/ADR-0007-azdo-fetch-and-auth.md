# ADR-0007: Azure DevOps fetch and authentication (`fetchRemoteConfig`)
- Status: accepted; sections 1 (codes), 8 (fetch-rejection mapping) and 10 step 1 (non-2xx
  classification) amended by ADR-0020 (cycle-0023, F-021: `network-unreachable`, `network-blocked`)
- Date: 2026-10-30
- Cycle / item: cycle-0007 / F-005

## Context

FR-2 / FR-3 / FR-8 / FR-10 / FR-11: the plugin downloads the shared `kilo.jsonc` from an Azure
DevOps Git repo with the Items API (`api-version=7.1`, branch-scoped, `includeContent=true`). It
authenticates with a PAT (`pat` option / `KILO_AZDO_PAT`, then `AZDO_PAT`, then
`AZURE_DEVOPS_EXT_PAT`, Basic auth) or, when there is no PAT, with an Entra token from
`az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` (Bearer). The
fetch is bounded by `timeoutMs` (default 5000). No failure may stop Kilo.

Inputs: the `settings` object returned by `resolveSettings` (ADR-0006, contract 2d). Its
org/project/repo/path/branch have already been validated against a deny-list, but cycle 0006
security finding 1 showed that lone UTF-16 surrogates (`"\ud800"`) pass that validation and make
`encodeURIComponent` throw `URIError`.

Constraints:
- Single file, `node:` imports only, zero npm deps (FR-11, ADR-0001). The FR-11 lint
  (`backend/tools/check-fr11.mjs`) is regex based: its comment stripper removes everything
  between a slash-star and the next star-slash, and removes whole lines that start with `//`.
  A slash-star or star-slash sequence inside code, a string or a regex literal would therefore
  hide code from the import check (or break it).
- `tsconfig` targets ES2022, so `String.prototype.isWellFormed` (ES2024) is not in the type
  library. The plugin must also run on Bun.
- Helpers reach tests only through `__internals` (ADR-0002). No new named exports.
- Parsing, placeholders, merge, cache and logging are F-006. This helper only returns raw text.
- Tests never touch the network or a real `az` (ADR-0001 section 2).

## Decision

### 1. Signature and result

A module-local async function, exposed as the 5th `__internals` key:
`{ parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings, fetchRemoteConfig }`.

```ts
type FetchErrorCode =                                    // module-local
  | "invalid-settings" | "auth-unavailable" | "timeout" | "too-large"
  | "bad-response" | "network" | `http-${number}`;
type FetchResult = { ok: true; text: string } | { ok: false; error: FetchErrorCode };

interface FetchInit {                                     // what the helper passes to fetch
  method: "GET";
  headers: Record<string, string>;                        // plain object, see section 5
  redirect: "manual";
  signal: AbortSignal;
}
type FetchLike = (url: string, init: FetchInit) => Promise<Response>;
interface AzRunResult { exitCode: number | null; stdout: string }
type AzRunner = (args: readonly string[], options: { timeoutMs: number }) => Promise<AzRunResult>;
interface FetchDeps {                                     // module-local
  fetch?: FetchLike;                                      // default: globalThis.fetch (call time)
  env?: Readonly<Record<string, string | undefined>>;    // default: process.env (call time)
  runAz?: AzRunner;                                       // default: execFile runner (section 7)
  setTimeout?: (callback: () => void, ms: number) => unknown;   // default: globalThis.setTimeout
  clearTimeout?: (handle: unknown) => void;                     // default: globalThis.clearTimeout
}

async function fetchRemoteConfig(settings: unknown, deps?: unknown): Promise<FetchResult>;
```

- `error` is **exactly** one of the fixed codes. `http-<status>` is `"http-" + String(status)`
  where `status` is an integer from 100 to 599 that is not 2xx (so `http-401`, `http-404`,
  `http-500`, `http-302`). Nothing else is ever part of `error`: no message, no value, no
  `cause`, no extra properties. Results are fresh plain objects with exactly the keys
  `ok` + `text` or `ok` + `error`.
- The function **never throws and never rejects**. Its whole body runs in a `try` whose
  `catch` (without binding) returns `{ ok: false, error: "network" }` (fallback for anything
  unforeseen). It contains no `throw` statement.
- It never writes to `settings`, `deps`, the env or any global.
- No types or constants are exported.

### 2. Reading `settings` and `deps` (own data properties only)

- All reads of `settings` and `deps` use the existing `readOwn` helper (ADR-0006 section 2):
  own data properties only, getters never invoked, throwing proxies count as absent. `settings.pat`
  is an own non-enumerable data property, which `readOwn` reads correctly.
- `settings` that is not record-like (`isRecordLike`) -> `invalid-settings`.
- `deps` that is not record-like (including `null`, `undefined`, a string) is treated as `{}`
  (all defaults). This matches `resolveSettings`.
- **Injected-but-wrong deps never fall back to a real default.** For each of `fetch` and `runAz`:
  absent (`undefined`) -> default; a function -> used; anything else (`null`, a string, ...) ->
  the dependency is **unavailable**: `fetch` unavailable -> `network` (fetch is not called);
  `runAz` unavailable -> `auth-unavailable` when the az path is needed. This guarantees a test
  that passes a wrong fake can never reach the real network or the real `az`. `env` uses the
  existing `selectEnv(deps)` (non-record-like injected env -> empty env).
  `setTimeout` / `clearTimeout`: a function -> used; anything else -> the global one (harmless).
- The default `fetch` is `globalThis.fetch`, read at call time; if it is not a function ->
  `network`.

### 3. Settings validation (before any dependency is called)

Done first; on failure the result is `invalid-settings` and **neither fetch, runAz, the timers
nor the env are touched**.

| Field | Rule (value read with `readOwn`) |
|---|---|
| org, project, repo | string, `isWellFormedText`, and `acceptName(value) === value` |
| path | string, `isWellFormedText`, and `acceptPath(value) === value` (so it already starts with `/`) |
| branch | string, `isWellFormedText`, and `acceptBranch(value) === value` |
| timeoutMs | if `inTimeoutRange(value)` it is used; anything else -> `DEFAULT_TIMEOUT_MS` (5000). Never an error. |

`acceptName` / `acceptPath` / `acceptBranch` / `inTimeoutRange` are the existing ADR-0006
validators, reused. Requiring `accept(value) === value` means a hand-built settings object gets
the same protection as one from `resolveSettings` (defence in depth), and a value that would need
trimming or normalisation is rejected rather than silently changed.

### 4. Lone surrogates: explicit well-formedness guard (not URIError catching)

Decision: a module-local helper `isWellFormedText(text: string): boolean` implemented with a
`charCodeAt` loop (a high surrogate 0xD800-0xDBFF must be immediately followed by a low surrogate
0xDC00-0xDFFF; a low surrogate 0xDC00-0xDFFF not preceded by a high one is invalid). It is used
in two places:

1. **`fetchRemoteConfig`** (section 3): a non-well-formed org/project/repo/path/branch ->
   `invalid-settings`, before any encoding. URL building is still inside the outer `try`, so
   even an unexpected `URIError` could not escape; but the guard, not the catch, is the
   specified behaviour.
2. **Amendment to `resolveSettings` (contract 2d, ADR-0006 section 4):** `acceptName`,
   `acceptBranch` and `acceptPath` additionally return `undefined` when
   `!isWellFormedText(trimmed)`. The effect is warning **W2** for that source and fall-through to
   the next source / default, exactly like any other disallowed character. `checkPat`, `mode`
   and `timeoutMs` are unchanged. Done by backend task BE-1.

Why a hand-written helper and not `String.prototype.isWellFormed()`: it is ES2024, the
project's `tsconfig` targets ES2022 (no typings), and Bun/Node version coverage would become a
runtime concern. A 10-line loop is portable and testable. Why not only catching `URIError`: it
would hide the reason (a generic failure late in the pipeline), and the user would get no
settings warning naming the bad setting.

### 5. URL and headers

URL built by string concatenation, each interpolated value passed through `encodeURIComponent`
(not `URLSearchParams`, which encodes space as `+`). Exact template and parameter order:

```
"https://dev.azure.com/" + enc(org) + "/" + enc(project)
  + "/_apis/git/repositories/" + enc(repo) + "/items"
  + "?path=" + enc(path)
  + "&versionDescriptor.version=" + enc(branch)
  + "&versionDescriptor.versionType=branch"
  + "&includeContent=true"
  + "&api-version=7.1"
```

The URL is passed to `fetch` as a **string** (not a `URL` object), so tests compare it exactly.
Example (AC1): org `my org`, project `plat form`, repo `kilo-config`, path
`/teams/a b/kilo.jsonc`, branch `release/1` ->
`https://dev.azure.com/my%20org/plat%20form/_apis/git/repositories/kilo-config/items?path=%2Fteams%2Fa%20b%2Fkilo.jsonc&versionDescriptor.version=release%2F1&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`.

`init` passed to fetch is a fresh object with exactly these keys:
- `method: "GET"`
- `headers`: a fresh plain object with exactly, in this order,
  `Accept: "application/json"`, `Authorization: <section 6>`,
  `"X-TFS-FedAuthRedirect": "Suppress"` (documented Azure DevOps header that makes the service
  answer 401 instead of redirecting to an interactive sign-in page).
- `redirect: "manual"` (section 9)
- `signal`: the `AbortSignal` of the helper's own `AbortController` (section 8)

Exactly one fetch call per invocation; no retries.

### 6. Credential order, PAT rules and Basic encoding

Order (first usable wins; later sources are not read once one is usable):
1. `settings.pat` (already covers the plugin option and `KILO_AZDO_PAT`, ADR-0006)
2. env `AZDO_PAT`
3. env `AZURE_DEVOPS_EXT_PAT`
4. `az` Entra token (section 7)

Env values are read with `readOwn` from `selectEnv(deps)` (own data properties only; inherited,
accessor and throwing-proxy values count as absent). `KILO_AZDO_PAT` is **not** re-read here.

A PAT candidate is **usable** iff it is a string and, after `trim()`, it is non-empty and every
UTF-16 code unit is in 0x21..0x7E (visible ASCII: no space, no control character such as CR/LF/
NUL/DEL, no non-ASCII, therefore no lone surrogate). An unusable candidate (absent, empty,
whitespace-only, wrong type, or containing a disallowed character) is skipped silently and the
next source is tried. Azure DevOps PATs are alphanumeric, so this loses nothing real, and it rules
out copy-paste damage (a trailing CR/LF inside the value) as well as non-ASCII encoding
ambiguity.

Header: `"Basic " + Buffer.from(":" + pat, "utf8").toString("base64")` using the global `Buffer`
(Node and Bun; no import). Base64 output only contains `A-Z a-z 0-9 + / =`, so the header value
cannot carry CR/LF and header injection is impossible by construction; the visible-ASCII rule is
an additional input-quality guard. With any usable PAT, `runAz` is **never** invoked.

### 7. `az` fallback

When no PAT is usable, `runAz` is called **once** with the constant argument array
`AZ_TOKEN_ARGS`:

```
["account", "get-access-token", "--resource", "499b84ac-1321-427f-aa17-267ca6975798",
 "--query", "accessToken", "--output", "tsv"]
```

and `{ timeoutMs }`. The call is raced against the deadline (section 8). The token is accepted
iff the runner resolved (did not throw synchronously, did not reject, did not time out) to a
record-like value whose own `exitCode` is exactly `0` and own `stdout` is a string, and
`stdout.trim()` is non-empty, at most 16384 characters, and every character is in the token68
set `A-Z a-z 0-9 - . _ ~ + /` with optional trailing `=` (checked with `charCodeAt`, not a regex).
Otherwise -> `auth-unavailable`, and **no HTTP request is sent**. Header:
`"Bearer " + token`. The token, stdout, stderr and any runner error are never logged, stored or
returned.

**Default runner** (`defaultRunAz`, module-local), built on `execFile` from
`node:child_process` (the only new import) and **never** with `shell: true`:
- Options: `{ timeout: timeoutMs, maxBuffer: 65536, windowsHide: true, encoding: "utf8",
  cwd: homedir() }` (no `shell` key, so it defaults to false; no `env` key, so the child inherits
  the environment, which `az` needs).
- POSIX (`process.platform !== "win32"`): `execFile("az", args, options, cb)`.
- Windows: `az` is installed as `az.cmd`, a batch file. Node refuses to spawn `.cmd`/`.bat`
  files without a shell (CVE-2024-27980 fix: `EINVAL`), and `execFile("az")` would not find
  `az.cmd` anyway. Decision: run the command interpreter explicitly, still without
  `shell: true`:
  `execFile(comspec, ["/d", "/s", "/c", AZ_TOKEN_ARGS_JOINED], options, cb)` where
  `AZ_TOKEN_ARGS_JOINED = "az " + AZ_TOKEN_ARGS.join(" ")` and `comspec` is the own string value
  of `process.env.ComSpec` if it `isAbsolute`, else `"cmd.exe"`.
  - Security: every token on that command line is a module constant (letters, digits, `-`,
    spaces); no setting, env value or other input is ever placed on it. So cmd.exe
    metacharacter injection is impossible; `/d` disables AutoRun, `/s /c` is the same quoting
    form Node uses internally for `shell: true`.
  - Binary planting: both cmd.exe (for `az`) and libuv (for a bare `cmd.exe`) search the
    current directory before `PATH` on Windows. Kilo's cwd is the user's (possibly untrusted)
    project, so `cwd: homedir()` is set for the child on every platform; a planted `az.cmd` /
    `az.exe` in a project folder is never picked up.
- Callback: `error` absent -> `{ exitCode: 0, stdout }`; `error` with a numeric `code` ->
  `{ exitCode: code, stdout: "" }`; any other error (ENOENT, timeout kill, maxBuffer exceeded,
  signal) -> `{ exitCode: null, stdout: "" }`. The error object is never inspected further,
  copied or logged.
- Wrapped in `new Promise(...)` so a synchronous throw from `execFile` becomes a rejection
  (-> `auth-unavailable`). It never rejects with data.
- On Windows a timeout kill terminates `cmd.exe`; a still-running `az` grandchild may finish on
  its own. Accepted: the helper itself returns within the deadline.

### 8. One deadline for the whole operation

- One `AbortController` and one timer per invocation. The timer is started (via the injected or
  global `setTimeout`, delay exactly `timeoutMs`) after settings validation and dependency
  resolution, **before** the `az` call / fetch. When it fires it sets a `timedOut` flag, calls
  `controller.abort()` and resolves an internal `deadline` promise.
- Every await on an external promise (`runAz`, `fetch`, each `reader.read()`) is
  `Promise.race([op, deadline])`. So the helper returns within about `timeoutMs` even when a fake
  or a real dependency ignores the signal. External calls are wrapped as
  `new Promise((resolve) => resolve(fn(...)))` so synchronous throws become rejections; `race`
  attaches handlers, so a losing promise that rejects later never becomes an unhandled rejection.
- Mapping: deadline during `runAz` -> `auth-unavailable`; deadline during fetch or body read ->
  `timeout`. A fetch / read rejection while `timedOut` is set -> `timeout`; otherwise -> `network`.
- The timer is cleared in a `finally` on every path (clearTimeout errors swallowed), so nothing
  keeps the Kilo process alive. The timer is not `unref`-ed.
- Budget: `az` + HTTP + body share the single `timeoutMs` (default 5000, FR-8). This is the
  conservative choice for Kilo startup latency.

### 9. Redirects

`redirect: "manual"`: fetch never follows a redirect, so the `Authorization` header can never be
sent to another host. In Node and Bun a manual redirect yields the 3xx response itself, which is
non-2xx -> `http-3xx` (for example `http-302`, which is diagnosable). An `opaqueredirect`
response (status 0, browser semantics) -> `bad-response`. `"error"` was rejected because it
collapses into `network` and hides the cause.

### 10. Response handling (order)

1. `status = response.status`. Integer 200..299 -> continue. Integer 100..599 otherwise ->
   `http-<status>`. Anything else -> `bad-response`. On any non-success return the body is
   cancelled (guarded, not awaited, errors swallowed).
2. **Declared size**: `response.headers.get("content-length")`; if it is a string of ASCII digits
   only and `Number(value) > MAX_RESPONSE_BYTES` -> `too-large` without reading the body.
   Other values are ignored (the real length is still enforced).
3. **Streamed size**: `response.body` must have a `getReader` function (else `bad-response`).
   Read chunks with `reader.read()` (each raced with the deadline). Each chunk must be a
   `Uint8Array` (else `bad-response`). Keep a running byte total; as soon as it exceeds
   `MAX_RESPONSE_BYTES = 1048576` (1 MiB; exactly 1 MiB is allowed) -> cancel the reader
   (guarded) and return `too-large`. Never buffer more than the cap plus one chunk.
4. Concatenate, decode with `new TextDecoder("utf-8", { fatal: true })` (a BOM is dropped);
   decoding error -> `bad-response`.
5. `JSON.parse` in `try` -> failure -> `bad-response`. The parsed value must be record-like and
   `readOwn(parsed, "content")` must be a string; else `bad-response`.
6. Success: `{ ok: true, text: content }`, the string exactly as decoded by `JSON.parse`
   (not trimmed, not parsed as JSONC). An empty string is returned as is (F-006 handles it).

The size cap applies to the HTTP body bytes, before decoding and before any JSON parse
(`parseJsonc` needs about 50x its input in memory, ADR-0003).

### 11. Secret safety

- Error results are constants; no `error.message`, response text, header, URL, PAT, token or
  stdout is ever copied into a result. `catch` clauses have no binding (or ignore it).
- The Authorization value exists only inside the `headers` object passed to `fetch`.
- The helper does no logging (F-006 logs only the error code).

### 12. FR-11 lint interaction (implementation rules for the plugin file)

- The only new import is `import { execFile } from "node:child_process";` (passes the `node:`
  check). `Buffer`, `TextDecoder`, `AbortController`, `fetch` and `process` are globals.
- No slash-star or star-slash sequence anywhere in the new code: not in comments, strings or
  regex literals. In particular never write an `Accept` value like star-slash-star; it is
  `application/json`. Character-set checks use `charCodeAt` ranges, not regex literals.
- New comments use `//` only. ASCII only. LF line endings. No `require(`, no dynamic import.
  (Amended by ADR-0021 section 4, T-037: whole-line `/** ... */` JSDoc blocks whose body contains
  neither slash-star nor star-slash are allowed; the ban stays for strings, regex literals and `//`
  comments.)
- Erasable TypeScript only (a template literal type is fine).

## Consequences

- F-006 gets a single `await fetchRemoteConfig(settings)` call that cannot throw, with an error
  code it can log verbatim and use to decide on the cache fallback.
- Every external interaction is injectable, so all eight ACs are tested with fakes; the default
  `execFile` runner and the global `fetch` are not exercised by tests (they cannot be without a
  real `az` or network). They are kept small and are reviewed by the security engineer.
- On Windows the plugin runs `cmd.exe` with a constant command line. This is the narrowest way to
  start `az.cmd` without `shell: true`.
- A PAT with unusual characters is silently skipped (falls through to the next source / `az`).
  The final error (`auth-unavailable` or `http-401`) tells the user that authentication failed,
  without echoing the value.
- `az` time counts against the same `timeoutMs` budget; a slow `az` can cause `auth-unavailable`.
- Contract bumped to 0.6.0 (section 2e new, 2d amended, sections 4 and 5 updated).

## Alternatives considered

- **Catch `URIError` only** (no well-formedness check): fewer lines but no setting-specific
  warning and an implicit control flow. Rejected; the catch-all remains as a backstop.
- **`String.prototype.isWellFormed`**: ES2024, not in the ES2022 type library. Rejected.
- **`URLSearchParams` for the query**: encodes space as `+` and changes ordering semantics.
  Rejected for exact, testable output.
- **`redirect: "follow"`** (default): could forward credentials to a redirected host (fetch
  strips `Authorization` cross-origin only in recent implementations). Rejected. **`"error"`**:
  safe but loses the status. Rejected.
- **`shell: true` / `exec("az ...")`**: spawns a shell with string parsing; even with constant
  arguments it violates the "no shell" rule and widens the attack surface. Rejected.
- **`execFile("az.cmd")` on Windows**: refused by current Node (`EINVAL`). Rejected.
- **Separate budgets for `az` and fetch** (worst case 2x `timeoutMs`): rejected for startup
  latency. **No timer seam** (real timers only): rejected because AC4 needs the default 5000 ms
  to be verifiable without waiting 5 seconds.
- **Raw item download (`$format=octetStream` / `Accept: text/plain`)**: would avoid the JSON
  wrapper, but the AC and FR-2 specify `includeContent=true` with `Accept: application/json`.
  Rejected.
- **Throwing on invalid PAT characters / dedicated error code**: adds a code for a rare
  misconfiguration; fall-through matches ADR-0006 semantics. Rejected.
