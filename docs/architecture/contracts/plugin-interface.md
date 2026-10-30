# Contract: `azdo-remote-config` plugin interface

- Version: 0.4.0 (F-003, cycle-0005: `__internals.mergeConfig`, section 2c; 0.3.1 was F-002
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
| `__internals` | plain object | Test/validator seam. `{ parseJsonc, resolvePlaceholders, mergeConfig }` since F-003 (sections 2a, 2b, 2c), in that key order; later F-items add further pure helpers. Never has a `server` key; never itself a function. |
| types | `export type` / `export interface` | as in section 1 |

No other named exports: the runtime named exports are exactly `PLUGIN_ID`, `SUPPORTED_KILO_RANGE`
and `__internals` (plus `default`). No named export may be a function. Helpers inside
`__internals` are module-local functions (not exported by name). Their helper types (e.g.
`PlaceholderDeps`, `PlaceholderResult`) and constants (e.g. `MAX_MERGE_DEPTH`) are module-local too
and are not exported.

Imports (FR-11, ADR-0001, ADR-0004): the plugin file may import only `node:` built-ins. Since
F-002 it imports `readFileSync` and `statSync` from `node:fs`, `homedir` from `node:os`, and
`isAbsolute` and `join` from `node:path`.

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
| Wiring | Not called by the `config` hook yet (F-006 wires it, logs `unresolved`, and catches everything). |

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
| Wiring | Not called by the `config` hook yet (F-006). |

## 3. Behaviour contract

### `server(input, options)`
- MUST resolve (never reject) for any `input` (including `{}`) and any `options`
  (including `undefined`, `null`, non-objects).
- MUST NOT perform network or filesystem I/O in T-001 (stub). Later items do the fetch here or
  lazily in `config`; either way all errors are caught (FR-10).
- Returns an object whose `config` property is a function.

### `hooks.config(config)`
- Called by Kilo once with the fully resolved config; Kilo awaits it.
- MUST resolve (never reject) for any argument.
- **T-001 stub:** a no-op. After the call, `config` is deep-equal to its state before the call
  and is the same object reference (no replacement, no added/removed keys).
- **Later (F-006):** mutates `config` in place per FR-6 through `mergeConfig` (section 2c); never
  replaces the object.

## 4. Plugin options schema (FR-1) - informative, implemented by a later item

| Option | Type | Env fallback | Default |
|---|---|---|---|
| `org` | string | `KILO_AZDO_ORG` | none (required for fetch) |
| `project` | string | `KILO_AZDO_PROJECT` | none (required for fetch) |
| `repo` | string | `KILO_AZDO_REPO` | `kilo-config` |
| `path` | string | `KILO_AZDO_PATH` | `/kilo.jsonc` |
| `branch` | string | `KILO_AZDO_BRANCH` | `main` |
| `mode` | `"defaults" \| "enforce"` | `KILO_AZDO_MODE` | `defaults` |
| `pat` | string (secret) | `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT` | none -> `az` Entra token |
| `timeoutMs` | positive integer | `KILO_AZDO_TIMEOUT_MS` | `5000` |

The exact validation rules are fixed by the item that implements FR-1.

## 5. Outbound calls (informative, later items)

- **Azure DevOps Git Items API** (FR-2):
  `GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items?path={path}&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`
  with `Authorization: Basic base64(":" + pat)` or `Authorization: Bearer <entra token>` (FR-3),
  aborted after `timeoutMs` (FR-8).
- **`az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`** (FR-3)
  when no PAT is configured.
- **Cache file** `~/.cache/kilo-azdo/remote-config.json` (FR-7).
- **Logs** only via `input.client.app.log` with `service: "azdo-remote-config"`; never secret
  values (FR-9).
