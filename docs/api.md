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
  and `__internals` (test seam, currently `{ parseJsonc, resolvePlaceholders }`).
- The plugin settings (`org`, `project`, `repo`, `path`, `branch`, `mode`, `pat`, `timeoutMs`) are
  not read yet.

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

Authoritative contract: `docs/architecture/contracts/plugin-interface.md` (v0.3.1), ADR-0002, ADR-0003 (`docs/architecture/ADR-0003-jsonc-parser.md`) and ADR-0004 (`docs/architecture/ADR-0004-placeholder-resolution.md`).
