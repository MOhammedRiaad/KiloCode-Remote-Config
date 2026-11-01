# ADR-0008: Config hook wiring, cache, fallback, logging and never-crash (`runConfigHook`)
- Status: accepted; sections 2 (missing-settings fallback), 4 (cache content and read) and 5
  (read codes) amended by ADR-0018 (cycle-0019, T-013: cache bound to its settings); log table
  extended by ADR-0020 (cycle-0023, F-021: L-HINT-NETWORK / L-HINT-CREDENTIALS after L-CACHE / L-NONE)
- Date: 2026-10-31
- Cycle / item: cycle-0008 / F-006

## Context

FR-6 / FR-7 / FR-9 / FR-10 / AC-3 / AC-4 / AC-6 / AC-7 / AC-8 / AC-9, startup steps 2-6. The
helpers shipped so far (`parseJsonc` ADR-0003, `resolvePlaceholders` ADR-0004, `mergeConfig`
ADR-0005, `resolveSettings` ADR-0006, `fetchRemoteConfig` ADR-0007) are not called by the
plugin yet; the `config` hook is a no-op. This ADR wires them, adds the local cache
(`<home>/.cache/kilo-azdo/remote-config.json`) and the logging through Kilo's logger, and fixes
the never-crash rules. The trust boundary for the settings sources and for fetched / cached
content is ADR-0009.

Constraints:
- FR-11 / ADR-0001: single file, `node:` imports only, zero runtime deps. FR-11 lint: no
  slash-star / star-slash sequence anywhere in code, strings or regex literals (ADR-0007 section 12).
- ADR-0002: no named function exports; tests reach helpers only via `__internals`, which never
  has a `server` key.
- ADR-0001 section 2: tests never touch the network or the real home directory.
- Kilo awaits the `config` hook during startup (ADR-0001 section 5). A hook that hangs blocks Kilo.
- Kilo's `client` is the generated SDK client. `client.app` is a class instance and `log` is a
  **prototype method** that uses `this`. It returns a promise (an HTTP call to Kilo's in-process
  server), which may not settle quickly during startup.
- PO decisions (cycle 0008): the cache holds the shared config **before** placeholder resolution;
  missing settings use the same cache fallback as a failed fetch; non-object roots are rejected;
  cache writes are atomic.

## Decision

### 1. Seam: `__internals.runConfigHook`

The whole hook body is a module-local async function, exposed as the 6th `__internals` key:
`{ parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings, fetchRemoteConfig, runConfigHook }`.

```ts
async function runConfigHook(input: unknown, options: unknown, config: unknown, deps?: unknown): Promise<void>;
```

The default export wires it without deps:

```ts
const AzdoRemoteConfig: PluginServer = async (input, options) => {
  return { config: (config) => runConfigHook(input, options, config) };
};
```

- `server` does **no** I/O, no logging, and contains nothing that can throw. All work happens in
  the hook.
- `runConfigHook` never rejects (outer `try` / `catch` without binding).
- `runConfigHook` is a function inside `__internals` (like the other helpers), not a named
  export, and the key is not `server`. ADR-0002 holds.

`deps` (module-local type `HookDeps`, every key optional, read with `readOwn`; non-record-like
`deps` -> `{}`):

| Key | Used for | Default (key absent / `undefined`) | Present but wrong type |
|---|---|---|---|
| `env` | `resolveSettings`, `fetchRemoteConfig`, `resolvePlaceholders` | each helper's own default (`process.env` at call time) | passed through; each helper's own rule applies (non-record-like -> empty env) |
| `fetch`, `runAz`, `setTimeout`, `clearTimeout` | `fetchRemoteConfig` | that helper's default | passed through (ADR-0007: wrong `fetch` -> `network`, wrong `runAz` -> `auth-unavailable`) |
| `homedir` | cache path and `{file:~/...}` | `os.homedir` | cache **unavailable**; `~/` placeholders unresolved. Never falls back to the real home. |
| `readFile` | `{file:}` placeholder reader | the guarded reader (ADR-0004) | passed through to `resolvePlaceholders` |
| `fs` | cache I/O (section 4) | real `node:fs` sync functions | non-record-like -> cache **unavailable**; a missing or non-function method -> that operation fails. Never falls back to the real fs. |

Only keys whose value is not `undefined` are put into the deps objects handed to the helpers, so
each helper applies its own default for an omitted key.

### 2. Flow (normative order)

```
0. log = makeLogger(input)                                   (section 5)
1. config not a plain object (isPlainObject, ADR-0005)       -> L-BADCONFIG, return (nothing fetched)
2. { settings, missing, warnings } = resolveSettings(options, { env })
   each warning -> L-SET (warn), in order
3. if missing.length > 0:  L-MISSING (warn); reason = "missing-settings"   (no fetch, no az)
   else: r = await fetchRemoteConfig(settings, { fetch, env, runAz, setTimeout, clearTimeout })
         r.ok  -> v = validateShared(r.text)  (section 3)
                  v.ok -> shared = v.value, source = "remote"
                  else -> reason = v.error ("invalid-jsonc" | "invalid-shape")
         !r.ok -> reason = r.error (fixed FetchErrorCode)
4. source == "remote": L-REMOTE (info); w = writeCache(shared); w failed -> L-CACHE-WRITE (warn)
   otherwise:          c = readCache()
                       c.ok -> shared = c.value, source = "cache", L-CACHE (warn, names reason)
                       else -> L-NONE (error, names reason and c.error), return
5. { value, unresolved } = resolvePlaceholders(shared, { env, homedir, readFile })
   unresolved non-empty -> L-UNRESOLVED (warn)
6. applyShared(config, value, settings.mode)  (section 6)
   true -> L-APPLIED (info); false -> L-MERGE (error)
any unexpected throw anywhere -> L-UNEXPECTED (error)
```

- The cache is never written on the fallback path (step 4 only writes after a validated fetch).
- Placeholders are resolved on **every** run from the chosen (remote or cached) unresolved
  config; resolved values are never written to disk.
- The only mutation of `config` is in step 6, which is transactional, so on every path `config`
  is either unchanged or fully merged.
- Reason codes (`<reason>`): any `FetchErrorCode` (ADR-0007) | `missing-settings` |
  `invalid-jsonc` | `invalid-shape`.

### 3. Validation of fetched and cached content (`validateShared`, module-local)

Fetched text and cache file content are untrusted (ADR-0009). Both go through the same function:

```ts
type SharedCheck = { ok: true; value: Record<string, unknown> } | { ok: false; error: "invalid-jsonc" | "invalid-shape" };
function validateShared(text: unknown): SharedCheck;
```

1. `text` not a string, or `parseJsonc(text)` throws (any error, including `RangeError`) ->
   `invalid-jsonc`. The error is discarded.
2. Parsed root not a plain object (`isPlainObject`: arrays, strings, numbers, booleans, `null`
   rejected) -> `invalid-shape`.
3. A container at nesting level 64 or deeper (root = level 0; same rule as ADR-0004 / ADR-0005)
   -> `invalid-shape`. So content that would make `resolvePlaceholders` or `mergeConfig` throw is
   never cached or merged.
4. Otherwise `{ ok: true, value }`.

Invalid content is never cached and never merged. Size caps are applied before parsing: 1 MiB
for the HTTP body (ADR-0007), `MAX_CACHE_BYTES` for the cache file (section 4).

### 4. Cache

| Aspect | Decision |
|---|---|
| Path | `join(home, ".cache", "kilo-azdo", "remote-config.json")`, `home = homedir()`. `homedir` throwing, or returning a non-string, an empty string, or a non-absolute path (`isAbsolute`) -> cache unavailable (`cache-unavailable`); no fs call is made. `XDG_CACHE_HOME` is not consulted (FR-7 fixes the path). |
| Content | `JSON.stringify(sanitizeShared(shared), null, 2) + "\n"`, where `sanitizeShared` is ADR-0005 phase 1. Placeholders are **not** resolved (PO decision). Sanitising first also keeps any shared `apiKey` value (which is never applied, ADR-0005) and prototype keys off the disk. |
| Size cap | `MAX_CACHE_BYTES = 2 * 1024 * 1024` (2 MiB; exactly 2 MiB allowed). The serialised JSON of a validated config fetched within the 1 MiB body cap fits; anything larger is not written (`cache-too-large`). On read, a file larger than the cap is not read (`cache-unreadable`). |
| Write (only after a validated fetch) | 1. `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })` (an existing directory is not re-chmodded). 2. `tmp = file + "." + process.pid + "-" + Date.now() + "-" + counter + ".tmp"` in the **same directory** (counter is a module-local integer incremented per write). 3. `fs.writeFileSync(tmp, data, { encoding: "utf8", mode: 0o600, flag: "wx" })` (exclusive create: never follows or reuses an existing path or symlink). 4. `fs.renameSync(tmp, file)` (atomic replace on the same volume; replaces a symlink at `file` instead of following it). On any throw in steps 1-4: `fs.unlinkSync(tmp)` guarded (only if step 3 was reached), result `cache-write-failed`. A partially written cache can never be observed at `file`. |
| File mode | 0600 on POSIX through the `mode` of the exclusive create (umask can only remove bits). Windows ignores the mode; the file inherits the user-profile ACL. Tests assert the mode only when `process.platform !== "win32"`. |
| Read (fallback path only) | 1. `st = fs.statSync(file)`: throws with `code === "ENOENT"` -> `cache-missing`; any other throw -> `cache-unreadable`. 2. `!st.isFile()` or `st.size > MAX_CACHE_BYTES` -> `cache-unreadable`. 3. `fs.readFileSync(file, "utf8")`: throws or non-string -> `cache-unreadable`. 4. `validateShared(text)`: failure -> `cache-invalid`. A corrupt cache is never merged and is left in place (it is overwritten by the next successful fetch). |
| Error objects | Only `code` is read (guarded, compared to `"ENOENT"`); messages and paths are never read, copied or logged. |
| Write result codes | `cache-unavailable`, `cache-too-large`, `cache-write-failed`. |
| Read result codes | `cache-unavailable`, `cache-missing`, `cache-unreadable`, `cache-invalid`. |

The `fs` seam (module-local type `CacheFs`): `mkdirSync`, `writeFileSync`, `renameSync`,
`unlinkSync`, `statSync`, `readFileSync`, called as plain functions (unbound) with exactly the
arguments above. Default: the real functions imported from `node:fs` (new imports:
`mkdirSync`, `renameSync`, `unlinkSync`, `writeFileSync`).

### 5. Logging

**API.** Kilo's logger is `input.client.app.log({ body: { service, level, message } })`
(ADR-0001 section 5). `makeLogger(input)` returns `log(level, message): void`:
- Reads `input.client`, then `.app`, then `.log` with **ordinary property access** inside `try`
  (the SDK uses class instances with prototype methods, so `readOwn` would miss `log`; `input` is
  the trusted Kilo host object). Missing at any step or `log` not a function -> a silent no-op
  logger (no `console` fallback).
- Calls `log.call(app, { body: { service: "azdo-remote-config", level, message } })` with a fresh
  object each time. **No `extra`** is ever passed. Only `level` and `message` vary.
- **Fire and forget**: the hook never awaits the logger. A synchronous throw is caught; a
  returned thenable gets a rejection handler (attached inside `try`). So a throwing, rejecting or
  never-settling logger can neither crash nor hang Kilo's startup.

**Message rule (FR-9, AC-8, AC-9).** Every message is one of the fixed templates below. The only
variable parts are: setting names from `missing` (fixed literals), the fixed `warnings` texts of
ADR-0006, fixed reason / cache codes, the mode (`defaults` | `enforce`), the source (`remote` |
`cache`), and placeholder **names** from `unresolved` (sanitised, below). Never values, never
`err.message`, never paths of the cache, URLs, settings objects, tokens or PATs.
`settings` is never passed to the logger, in whole or in part (only `settings.mode` as one of
the two literals).

| Id | Level | When | Exact message |
|---|---|---|---|
| L-SET | warn | each `warnings[i]` of `resolveSettings` | the warning text verbatim (W0-W4, ADR-0006) |
| L-MISSING | warn | `missing` non-empty | `Remote config skipped: missing required settings: <names>.` (`<names>` = `missing.join(", ")`, e.g. `org, project`) |
| L-REMOTE | info | validated remote content obtained | `Loaded shared config from Azure DevOps.` |
| L-CACHE-WRITE | warn | cache write failed | `Could not update the config cache (<writeCode>).` |
| L-CACHE | warn | remote unavailable, usable cache | `Remote config unavailable (<reason>); using cached config.` |
| L-NONE | error | remote unavailable, no usable cache | `Remote config unavailable (<reason>) and no usable cache (<readCode>); continuing with local config only.` |
| L-UNRESOLVED | warn | `unresolved` non-empty | `Unresolved placeholders: <names>.` |
| L-APPLIED | info | merge succeeded | `Applied shared config from <remote\|cache> in <defaults\|enforce> mode.` |
| L-MERGE | error | merge threw (rolled back) | `Could not apply the shared config; local config left unchanged.` |
| L-BADCONFIG | error | `config` is not a plain object | `Shared config not applied: the Kilo config is not an object.` |
| L-UNEXPECTED | error | outer catch | `Remote config failed unexpectedly; continuing with local config only.` |

(`\|` is Markdown table escaping only.)

**Placeholder names** come from the shared file and are untrusted text (they cannot contain
`{`, `}`, CR or LF, ADR-0004, but may contain other control characters). Before logging, each
name has every code unit `<= 0x1F`, `0x7F` and `0x80..0x9F` replaced by `?` and is cut to 200
code units (`MAX_LOGGED_NAME_CHARS`). At most 20 names (`MAX_LOGGED_PLACEHOLDERS`) are listed,
joined with `", "`; if there are more, `, and <n> more` is appended (`<n>` = remaining count).
A name is the placeholder as written (`env:NAME` / `file:PATH`), never its value.

### 6. Transactional merge (`applyShared`, module-local)

`mergeConfig` (ADR-0005) sanitises completely before touching `target`, but its phase 2 can
throw `TypeError` midway on a frozen, sealed or non-configurable nested object, leaving a partial
merge. FR-10 / AC-8 require "unchanged or fully merged". Decision:

- Refactor phase 2 (`mergeInto`) to take an optional **journal**. Before each
  `Object.defineProperty(t, k, ...)` it pushes `{ target: t, key: k, previous }`, where `previous`
  is `Object.getOwnPropertyDescriptor(t, k)` (or `undefined` when the key was absent).
  `mergeConfig` passes no journal; its contract and behaviour are unchanged.
- `applyShared(target, shared, mode): boolean`: `try { sanitize; mergeInto(target, sanitized,
  enforce, journal); return true } catch { rollback; return false }`. Rollback walks the journal
  in reverse: `previous === undefined` -> `Reflect.deleteProperty(target, key)`; otherwise
  `Reflect.defineProperty(target, key, previous)`; each step in its own `try`. A write that threw
  was never journaled, and every successful write had a configurable (or absent) original, so
  rollback restores the exact previous state for frozen, sealed, non-extensible and
  non-configurable targets. Exotic proxies with throwing traps are best effort.
- The mode literal passed is `settings.mode` (`"defaults"` | `"enforce"`).

### 7. Never-crash summary (FR-10)

| Failure | Handling |
|---|---|
| `options` null / non-object / hostile | `resolveSettings` (never throws; W0) |
| `fetch` rejecting / hanging, `runAz` failing | `fetchRemoteConfig` (never throws; fixed code; deadline) -> cache fallback |
| `parseJsonc` throwing, non-object root, too deep | `validateShared` -> `invalid-jsonc` / `invalid-shape` -> cache fallback, nothing cached |
| home unavailable, unwritable cache dir, write / rename throwing | `cache-unavailable` / `cache-write-failed`, temp cleanup, L-CACHE-WRITE; merge still happens |
| corrupt / missing cache | `cache-invalid` / `cache-missing` / `cache-unreadable` -> L-NONE, config unchanged |
| logger throwing / rejecting / hanging | `makeLogger` guards, fire and forget |
| frozen Kilo config | `applyShared` rollback -> L-MERGE, config unchanged |
| anything else | outer `catch` -> L-UNEXPECTED; `config` unchanged (merge is the last mutating step and is transactional) |

No `catch` binds or inspects an error except the cache `code` read. No message contains
`err.message`.

### 8. FR-11 lint and code rules

- New imports: `mkdirSync`, `renameSync`, `unlinkSync`, `writeFileSync` added to the existing
  `node:fs` import. Nothing else. No `node:crypto` (the temp name uses pid, time and a counter;
  `wx` makes collisions fail safely).
- No slash-star / star-slash anywhere (do not write glob-like strings such as a slash followed by
  a star). `//` comments, ASCII, LF, erasable TypeScript only.
- No named exports added. The header comment of the file is updated (the hook is no longer a
  no-op).

## Consequences

- The plugin does real work at runtime for the first time; F-010, F-014 and F-015 are unblocked.
- Every external interaction is injectable, so all eight ACs are tested with fakes and a temp
  home directory. The default wiring (real `os.homedir`, real `node:fs`) is checked by one
  child-process test with `HOME` / `USERPROFILE` pointed at a temp dir and no settings (no
  network is reached because the fetch is skipped).
- Logs are fire-and-forget, so log ordering on Kilo's side is best effort and a log may be lost if
  Kilo's server is not ready. Accepted: Kilo's startup is never blocked by logging.
- The cache holds the sanitised, unresolved shared config. Offline starts re-resolve
  `{env:}` / `{file:}` from the current machine.
- A shared `apiKey` (which should never exist, C1 validator F-007) is not written to disk.
- The obsolete T-001 stub tests ("hook is a no-op", "stub never logs") are replaced by tests of
  the new contract; they are superseded behaviour, not disabled tests.

## Alternatives considered

- **Await the logger**: preserves ordering but a hanging SDK call during startup would hang Kilo
  (Kilo awaits the hook). Rejected.
- **Pass details in `extra`**: more structure, but every extra key is another potential leak
  path and AC-9 serialises every argument. Rejected; messages carry only fixed tokens.
- **A `log` key in `deps`**: redundant; the fake `input.client.app.log` is the seam and also
  exercises the real adapter (including `this` binding). Rejected.
- **`__internals.createServer(deps)`** returning a server: works, but a server-producing function
  in `__internals` is closer to the legacy-loader hazard of ADR-0002. Rejected for
  `runConfigHook`.
- **Cache the resolved config**: would write `{env:}` / `{file:}` secrets to disk. Rejected (PO).
- **Cache the raw fetched text**: keeps comments, but writes whatever was fetched (including any
  shared `apiKey`) and needs the same validation anyway. Rejected for the sanitised JSON.
- **Non-atomic write / write-then-chmod**: a crash or a permissive window could leave a partial
  or world-readable file. Rejected.
- **Preflight writability check instead of a journal**: must duplicate the merge walk and still
  races with exotic objects. Rejected for journal + rollback.
- **Deep-clone the Kilo config, merge into the clone, copy back**: `structuredClone` fails on
  non-cloneable values and copying back is itself a non-atomic multi-write. Rejected.
- **Async `node:fs/promises`**: no benefit for a few small startup operations and a larger seam.
  Rejected for sync calls.
