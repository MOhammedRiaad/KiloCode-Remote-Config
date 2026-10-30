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
  and `__internals` (test seam, currently `{ parseJsonc }`).
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

Authoritative contract: `docs/architecture/contracts/plugin-interface.md`, ADR-0002 and ADR-0003 (`docs/architecture/ADR-0003-jsonc-parser.md`).
