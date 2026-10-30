# Architect report — cycle 0003 — F-001: Plugin: JSONC parser

## Inputs read
- `factory/runs/cycle-0003/01-product-owner.md` (selected item and 7 ACs)
- `factory/VISION.md` (FR-4, FR-9, FR-11, AC-5, Appendix A)
- `docs/architecture/ADR-0001-tech-stack.md`, `ADR-0002-plugin-module-shape.md`,
  `contracts/plugin-interface.md`, `overview.md`
- `backend/plugin/azdo-remote-config.ts`, `backend/tools/check-fr11.mjs`,
  `backend/test/plugin/azdo-remote-config.smoke.test.ts`, `backend/package.json`,
  `backend/tsconfig.json`, `scripts/ci.sh`

## Work done

### Design summary
- **Function:** `function parseJsonc(text: string): unknown` is a module-local function in
  `backend/plugin/azdo-remote-config.ts`, in section 3 "Pure helpers" of the file layout.
  It is **not** exported by name, as ADR-0002 requires. It is exposed only as
  `export const __internals = { parseJsonc };`.
- **Test access:** `import { __internals } from "../../plugin/azdo-remote-config.ts";`
- **Algorithm (ADR-0003):** the parser makes one linear pass with four states: code, string, line comment and block comment. The pass builds a "clean" string of the same length as the input, which then goes to `JSON.parse`:
  - Comment characters become spaces, but `\n` and `\r` are kept.
  - A trailing comma becomes a space when the next significant character is `}` or `]`. Whitespace and comments are skipped when looking for that character.
  - String contents are copied verbatim, and `\` escapes the next character.
  - A leading BOM is ignored.
- **Errors:**
  - Every message starts with `Invalid JSONC: ` and contains only fixed text plus line and column numbers. No substring of the input ever appears in a message.
  - The `SyntaxError` from `JSON.parse` is replaced by `Invalid JSONC: malformed JSON`. It is not chained as `cause`, because V8 and Bun messages echo input fragments.
  - The scanner itself reports two errors: `unterminated string starting at line L, column C` and `unterminated block comment starting at line L, column C`.
  - Input that is not a string throws `TypeError`.
- The parser is **not** wired into the config hook. That is F-006. The hook stays a no-op, and the existing smoke tests must still pass.

## Backend tasks

All paths are under `backend/`. Follow ADR-0001 and ADR-0003, and contract section 2a in
`docs/architecture/contracts/plugin-interface.md`.

**BE-1: Implement `parseJsonc`** (AC-1..AC-5)
- Modify `plugin/azdo-remote-config.ts`:
  - Add the module-local `function parseJsonc(text: string): unknown` exactly as specified in ADR-0003 section 2 and contract section 2a.
  - Track the start line and column of the open string or block comment so the parser can report them.
  - Lines and columns are 1-based. Columns count UTF-16 code units. A new line starts after `\n`. A `\r` immediately followed by `\n` does not add an extra line; a lone `\r` counts as a line break.
- Use erasable TypeScript only, with no `enum` and no classes with parameter properties. Add no imports; the parser needs no imports at all.
- Avoid the literal two-character sequences `/*` and `*/` in **code and string literals**. Compare characters individually instead, e.g. `ch === "/" && next === "*"`, or use char codes. Reason: `tools/check-fr11.mjs` strips `/* ... */` spans with a regex before scanning for imports. A `"/*"` string literal would make the lint skip a region of the file, which is the lint-evasion class tracked by T-002. Normal source comments are fine.
- Wrap the `JSON.parse` call in try/catch and throw `new Error("Invalid JSONC: malformed JSON")`. Do not set `cause`.
- Keep the file LF-only, because `scripts/check-lf.sh` checks it.

**BE-2: Expose via `__internals`** (ADR-0002)
- In the same file, change the export to `export const __internals = { parseJsonc };`.
- Update the doc comment on `__internals`.
- Add no other named exports. `default`, `PLUGIN_ID` and `SUPPORTED_KILO_RANGE` stay unchanged.

**BE-3: Tests**
- Create `test/plugin/jsonc.test.ts`, using `node:test` and `node:assert/strict`, with no network or filesystem access. Each test below maps to an AC:
  1. AC-1 tests:
     - `//` line comments, including one after a value on the same line.
     - A multi-line `/* */` block comment.
     - A `//` comment at EOF with no trailing newline.
     - A `/* */` comment at EOF with no trailing newline.
     - Each result must `deepEqual` the comment-free document.
  2. AC-2 tests:
     - Trailing commas in an object and in an array.
     - Nested trailing commas, e.g. `{"a":[1,2,],"b":{"c":1,},}`.
     - A comma followed by whitespace, newlines and `//` and `/* */` comments before the closing bracket.
  3. AC-3 tests: the string values `"https://host/path"`, `"/* not a comment */"` and `"a,}b"` (plus `",]"`) must come back exactly.
  4. AC-4 tests:
     - `{"a": "say \"hi\" // x", "p": "C:\\"} // trailing`, written in the test as a TS string with correct escaping. The expected results are `a === 'say "hi" // x'` and `p === "C:\\"`, i.e. one backslash at runtime.
     - `["\\", "//"]` must parse to two elements.
  5. AC-5 tests, using `assert.throws(fn, (e) => ...)`:
     - Unterminated string: the message matches `/^Invalid JSONC: unterminated string/` and contains `line 1`.
     - Unterminated block comment spanning lines: the message matches `/unterminated block comment/` and reports the correct start line.
     - Malformed JSON, e.g. `{"a" 1}`: the message equals `Invalid JSONC: malformed JSON`.
     - Empty string: throws an Error.
     - Non-string input, e.g. `undefined as unknown as string`: throws a `TypeError`.
     - **Canary test:** for each invalid case, embed `SECRET-CANARY-42` in the input and assert that the message does not contain `SECRET-CANARY` and that `e.cause` is `undefined`.
  6. AC-6 test: parse the VISION Appendix A text verbatim (copy it into the test as a constant). Assert:
     - `provider.bifrost.options.baseURL === "https://bifrost.yourcompany.internal/v1"`.
     - `Object.keys(provider.bifrost.models)` deep-equals `["azure/gpt-5", "azure/gpt-5-mini"]`.
     - The object has no `apiKey`.
  7. Extra tests, not tied to an AC: a leading BOM is ignored; CRLF input parses; plain strict JSON parses identically to `JSON.parse`.
- Extend `test/plugin/azdo-remote-config.smoke.test.ts` (ADR-0002 guard) with three checks:
  - `Object.keys(mod.__internals)` includes `parseJsonc`.
  - `mod.__internals` has no `server` key.
  - Every named export of `mod` other than `default` is a non-function.

**BE-4: Gate** (AC-7)
- `bash scripts/ci.sh` exits 0. That covers `npm run lint` (check-fr11), `typecheck`, `test` and the LF check.
- `package.json` keeps no `dependencies`, and no new devDependencies are added.

## Frontend tasks
- None. The item is backend-only and the product has no frontend (ADR-0001).

## Security notes (for the Security engineer)
- **Data exposure (FR-9):** parser error messages must never contain input content. Check the following:
  - The `SyntaxError` from `JSON.parse` is replaced, not wrapped.
  - There is no `cause` chain.
  - The canary test exists for every invalid case.
- **DoS:** the scan is O(n) and iterative, with no regex backtracking over the input. `JSON.parse` nesting depth is the engine's concern. The input is a single trusted-ish config file fetched with auth, so no size cap is added here. F-005 or F-006 may add a response-size limit.
- **Prototype pollution:** `JSON.parse` creates `__proto__` keys as own data properties, so nothing is polluted at parse time. F-003 (merge) must skip or own-define `__proto__`, `constructor` and `prototype` keys. This is recorded as a follow-up.
- **Lint integrity:** the parser source must not contain `/*` or `*/` inside code or string literals, because of the check-fr11 comment-stripping regex (BE-1). Review should verify this.
- No authn/z surface, no I/O and no logging in this item.

## Files changed
- `docs/architecture/ADR-0003-jsonc-parser.md`: new ADR covering parser name and exposure, the algorithm, the error-message policy and lenient edge cases.
- `docs/architecture/contracts/plugin-interface.md`: version 0.2.0. `__internals` is now `{ parseJsonc }`, and new section 2a holds the full `parseJsonc` contract.
- `docs/architecture/overview.md`: references ADR-0003; C2 status is now "stub + JSONC parser".

## Verification
- Documentation-only changes. No product code was touched. I did not run `bash scripts/ci.sh`; the engineers run it in BE-4.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/tools/check-fr11.mjs:17 | The regex comment stripping also matches `/*` and `*/` inside string literals, so a parser that contains such literals would hide part of the file from the import scan. This is already tracked as T-002. | Mitigated for this item by the BE-1 coding rule; the real fix is in T-002. |

## Assumptions made (no human available)
- **Function name `parseJsonc`, exposed only via `__internals`.** This follows ADR-0002 and keeps the name the PO suggested.
- **Error messages carry no position for malformed JSON.** Position formats from `JSON.parse` differ between V8 and Bun and come with input snippets.
- **A leading BOM is accepted.** Windows editors often write one, and this does not affect any AC.
- **`[,]` and `{,}` are left unspecified.** This keeps the scanner simple. Such input is harmless, and the C1 validator can be stricter later.
- **Malformed and empty input throw a plain `Error`, not a custom subclass.** The plugin catches all errors anyway (FR-10).

## Follow-ups for the backlog
- **F-003 (merge):** add an AC that `__proto__`, `constructor` and `prototype` keys from the remote config cannot pollute prototypes.
- **F-005 / F-006:** consider a maximum response size before parsing (defense-in-depth).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0003/02-architect.md
summary: F-001 design: module-local parseJsonc(text): unknown exposed via __internals (ADR-0003, contract 0.2.0); 4 backend tasks, no frontend.
