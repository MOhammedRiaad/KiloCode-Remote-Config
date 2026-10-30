# ADR-0003: JSONC parser (single-pass scanner, no input in error messages)
- Status: accepted
- Date: 2026-10-30
- Cycle / item: cycle-0003 / F-001

## Context

FR-4 / AC-5: the shared `kilo.jsonc` contains `//` and `/* */` comments, trailing commas and
`https://` URLs. The plugin must parse it with zero npm dependencies (FR-11), inside the single
plugin file, and the parser is later reused by the C1 validator (through `__internals`).
Parser errors may be logged (FR-9), so they must never echo config content: although the shared
file should hold no secrets, a resolved or mis-committed value must not leak into logs.

ADR-0002 forbids named function exports; pure helpers reach tests only via `__internals`.

## Decision

1. **Name and exposure.** A module-local function
   `function parseJsonc(text: string): unknown` (not exported by name) is exposed as
   `__internals.parseJsonc`. `__internals` becomes `{ parseJsonc }`. No other export changes.
2. **Algorithm: one linear pass producing a same-length "clean" string, then `JSON.parse`.**
   A hand-written character scanner with states *code / string / line comment / block comment*:
   - In *string* state (entered at `"`), a backslash consumes the next character verbatim
     (so `\"` and `\\` are handled); the string ends at the next unescaped `"`. Content is
     copied unchanged. EOF inside a string -> error "unterminated string".
   - `//` in code state starts a line comment that ends before the next `\n` or `\r` (or EOF).
   - `/*` in code state starts a block comment that ends after the first `*/`. EOF before
     `*/` -> error "unterminated block comment".
   - Comment characters are replaced by a space, **except** `\n` and `\r`, which are kept, so
     the output has the same length and line structure as the input (positions map 1:1).
   - **Trailing commas:** in code state, a `,` whose next significant character (skipping
     whitespace and comments) is `}` or `]` is replaced by a space.
   - Everything else in code state is copied unchanged; validity is left to `JSON.parse`.
   - A single leading BOM (U+FEFF) is ignored (Windows editors).
   Regex-based stripping was rejected: it cannot reliably respect string boundaries
   (escaped quotes, a string ending in `\\`).
3. **Errors.** Every failure throws a plain `Error` whose message starts with
   `"Invalid JSONC: "` and contains **only fixed text plus 1-based line/column numbers** -
   never any substring of the input. In particular the `SyntaxError` from `JSON.parse` is
   caught and **replaced** (its V8/Bun message echoes input fragments); it is not attached as
   `cause`. Non-string input throws `TypeError("Invalid JSONC: input must be a string")`.
4. **Lenient edge cases (documented, not tested either way):** `[,]` / `{,}` become `[]` / `{}`
   because the lone comma is "trailing". Everything stricter than that is left to `JSON.parse`.
5. **Result.** Returns whatever `JSON.parse` returns (`unknown`); no reviver, no schema
   validation (schema checks belong to the C1 validator and later F-items).

## Consequences

- O(n) time, O(n) memory, no recursion -> no stack-depth risk from the scanner itself.
- Same-length output makes our own error positions exact; JSON.parse positions are not used
  (format differs between V8 and Bun), so malformed-JSON errors carry no position.
- The parser is pure and deterministic, so it is fully unit-testable via `__internals`.
- `__proto__` keys are produced by `JSON.parse` as own data properties (no pollution at parse
  time); the merge item (F-003) must still treat such keys defensively.

## Alternatives considered

- **`jsonc-parser` (Microsoft) npm package**: correct and battle-tested but violates FR-11.
- **Regex strip** (`/\/\/.*|\/\*[\s\S]*?\*\//g`): breaks on URLs and escaped quotes in strings.
- **`Bun.JSONC` / `JSON5`**: not available on Node (the test runtime) / is a dependency.
- **Full recursive-descent JSON parser**: more code and more risk than delegating to `JSON.parse`.
