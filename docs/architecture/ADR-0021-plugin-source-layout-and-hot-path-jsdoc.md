# ADR-0021: Plugin source layout (TOC, numbered sections), hot-path JSDoc and the move-only proof
- Status: accepted
- Date: 2026-11-01
- Cycle / item: cycle-0026 / T-037
- Amends: ADR-0001 sections 6, 7 and 8 (layout rule, new dev-only tool and test); ADR-0007
  section 12 and ADR-0008 section 8 (comment style: `/** ... */` JSDoc blocks are now allowed under
  the rules below); `overview.md` "Internal structure of C2". No contract change:
  `contracts/plugin-interface.md` keeps its version (no behaviour change).

## Context

`backend/plugin/azdo-remote-config.ts` has grown to about 1450 lines. The USER asked whether to split
it and chose to KEEP ONE FILE (FR-11 unchanged: one TypeScript file, `node:` imports only, zero
runtime dependencies, copied verbatim by the installer) and to organise it inside, plus JSDoc on all
hot paths. The change must be provably move-and-comment only. Earlier ADRs banned slash-star /
star-slash anywhere in the plugin because `tools/check-fr11.mjs` strips block comments with a naive
non-greedy regex before it scans import specifiers; a stray `/*` in a string or regex literal could
hide code from that scan.

## Decision

### 1. Fixed section list (TOC and banners match 1:1, in this order)

| # | Title (exact text) | Contents |
|---|---|---|
| 1 | `Imports, public types and plugin identity (ADR-0001, ADR-0002)` | `node:` imports; exported types `LogLevel`, `PluginInput`, `PluginOptions`, `KiloConfig`, `Hooks`, `PluginServer`; `PLUGIN_ID`, `SUPPORTED_KILO_RANGE` |
| 2 | `Shared guards and helpers` | `noop`, `attempt`, `readOwn`, `isRecordLike`, `isPlainObject` (used by three or more later sections) |
| 3 | `JSONC parser (ADR-0003)` | `BOM` .. `parseJsonc` |
| 4 | `Placeholder resolver (ADR-0004)` | unchanged block |
| 5 | `Config merge (ADR-0005)` | merge block without `isPlainObject` |
| 6 | `Settings resolution (ADR-0006, ADR-0009)` | settings block without `readOwn`, `isRecordLike` |
| 7 | `Fetch foundations: types, target, URL and deadline (ADR-0007)` | fetch types, `AZDO_HOST_PREFIX`, `failure`, target / URL / seam resolvers, `startDeadline`, `codeForInterrupted` |
| 8 | `Authentication: PAT and az CLI (ADR-0007)` | `AzRunResult`, `AzRunner`, `MAX_TOKEN_CHARS`, `AZ_*` constants, `resolveRunner` .. `resolveAuthorization`, `toAzResult`, `windowsCommandInterpreter`, `defaultRunAz` |
| 9 | `Response handling and failure classification (ADR-0007, ADR-0020)` | `MAX_RESPONSE_BYTES`, `MAX_EMPTY_CHUNKS`, `discard` .. `handleResponse` |
| 10 | `Fetch pipeline: fetchRemoteConfig (ADR-0007)` | `performRequest`, `runFetch`, `fetchRemoteConfig` |
| 11 | `Shared config validation (ADR-0008, ADR-0009)` | `SharedCheck`, `exceedsDepth`, `validateShared` |
| 12 | `Config cache bound to settings (ADR-0008, ADR-0018)` | cache types and constants, `REAL_FS`, `cacheCounter`, `cacheLocation` .. `readCache` |
| 13 | `Logging, fixed messages and hints (ADR-0008, ADR-0020)` | `HookLog`, every `LOG_*` constant, `MAX_LOGGED_*`, `makeLogger`, `hintFor`, `logHint`, `cleanName`, `listNames` |
| 14 | `Config hook: runConfigHook (ADR-0008)` | `Acquired`, `HookDeps`, `HOOK_DEP_KEYS`, `readHookDeps`, `pickDeps`, `acquireRemote`, `executeHook`, `runConfigHook` |
| 15 | `Exports: __internals, server and default export (ADR-0002)` | `__internals`, `AzdoRemoteConfig`, `export default` (always the last statement) |

Formats (exact):
- Header: the existing purpose comment (lines starting `// `), then a table of contents:
  a line `// Table of contents (one numbered section banner per entry, same numbers, titles and order):`
  followed by one line per section matching `^//   (\d+)\. (.+)$` (exactly three spaces).
- Banner: one line matching `^// ==== (\d+)\. (.+) ====$`, preceded and followed by a blank line.
  No other line may start with `// ====`; the old `// ---- x ----` markers are removed.
- Numbers run 1..15 without gaps. Adding or renaming a section later means updating the TOC, the
  banner, this table and `test/plugin/source-layout.test.ts` together.
- Types not marked `export` are module-local on purpose (ADR-0002). This is stated once in the
  header instead of the four repeated "Module-local types" comments.

### 2. Module-evaluation safety (no temporal dead zone)

Function declarations are hoisted; top-level `const` / `let` are not. The only top-level code that
runs at import time is the right-hand side of `const` / `let` initialisers and `export default`.
Verified import-time reads of another top-level binding (all others read only literals, imported
`node:` bindings, or hoisted function declarations, or read consts only when called):
- `AZ_TOKEN_ARGS` reads `AZ_RESOURCE`; `AZ_COMMAND_LINE` reads `AZ_TOKEN_ARGS`. These three stay
  in this relative order in section 8.
- `export default { id: PLUGIN_ID, server: AzdoRemoteConfig }` reads both; it stays the last
  statement of the file, after `AzdoRemoteConfig`.
- `SETTING_SPECS` references `checkMode`, `checkPat`, `checkTimeout` (function declarations,
  hoisted) and arrow functions that run only when called. `REAL_FS` reads imported `node:fs`
  bindings (always initialised). `__internals` reads function declarations only.
No module function is called at import time, so moving functions anywhere is safe. Any future
top-level initialiser that reads another top-level `const` must be placed after it.

### 3. Hot-path JSDoc standard

A hot path runs on every Kilo start (plugin load + config hook) or on every credential-bearing
request. The fixed list (35 names) is in T-037 and in `test/plugin/source-layout.test.ts`. Each
hot-path declaration line (`[export ][async ]function NAME` or `[export ]const NAME`) is directly
preceded by one `/** ... */` block (only whitespace between `*/` and the declaration; former `//`
comments above it are merged into the block) containing, in order:
1. a one-sentence purpose (first text line, ends with `.`);
2. `@param name - prose` per parameter and `@returns prose` (no `{Type}`: types live in TypeScript);
3. where applicable a `Codes:` and/or `Logs:` line naming the fixed `FetchErrorCode` / cache codes /
   `LOG_*` constants or log line ids (L-...) the function can produce;
4. a line starting `Invariants:` (for example: never throws (FR-10); no secret, URL, host or config
   value in any log (AC-9); body discarded unread on non-success; exactly one request per hook run;
   cache order and binding per ADR-0008 / ADR-0018; or what it may throw, for the pure helpers);
5. at least one `@see` in one of two forms: `@see ADR-NNNN` optionally followed by `section N`, or
   `@see contracts/<file>.md section <id>`. Referenced files and numbered headings must exist.
JSDoc describes the current code. ASCII only. No secrets or realistic examples: a Bifrost key only as
`sk-bf-<...>`, credentials only as `Basic <base64>` / `Bearer <token>`, URLs only as
`https://dev.azure.com/<org>/...`.

### 4. Comment-safety rule (amends ADR-0007 section 12 and ADR-0008 section 8)

`/** ... */` blocks are allowed only as whole-line comments: `/**` is the first non-blank text on
its line, `*/` is the last text on its line, and the body contains neither `/*` nor `*/` (so never
write glob-like text such as a slash followed by a star). Slash-star and star-slash remain banned in
strings, regex literals and `//` comments. This keeps the naive block-comment stripper in
`tools/check-fr11.mjs` exact. ASCII and LF (in the index) as before.

### 5. Dev-only checks (not shipped, plugin file never modified by them)

- `backend/test/plugin/source-layout.test.ts` (runs in `npm test`): reads the plugin as text and
  checks section 1 formats against the table above, the hot-path JSDoc presence (section 3), the
  comment-safety rule (section 4), ASCII, `@see` targets, a secret-like scan of all JSDoc blocks, and
  a fresh-process import (no ReferenceError, same exports, `default` keys `id`, `server`, same
  `__internals` keys in order). It contains negative controls on mutated copies of the source text.
- `backend/tools/compare-plugin-shape.mjs` (manual, NOT in `scripts/ci.sh` and not in `npm test`
  against real history, because any later legitimate behaviour change would fail it): compares a base
  version (`git show <ref>:backend/plugin/azdo-remote-config.ts`, or `--base-file`) with the working
  copy. A conservative tokenizer (no TypeScript compiler dependency) drops comments, keeps string,
  template and regex literal text verbatim, splits top-level statements (a token at column 0 at
  bracket depth 0 starts a statement) and normalises each statement as its tokens joined by one
  space. It compares sorted declaration names, export names, sorted `__internals` keys and the
  sorted multiset of normalised statements. Exit 0 PASS, 1 difference, 2 usage / tokenizer error;
  when git or the ref is unavailable it prints a SKIP line and exits 0. Plain Node, `node:` imports
  only, no shell, no writes. Its behaviour is covered by `backend/test/tools/compare-plugin-shape.test.ts`
  with synthetic base/head files only.
- `tools/check-fr11.mjs` is not changed; FR-11 rules 1-8 stay as they are.

## Consequences

- One file stays the shipped artefact; reviewers navigate by the TOC and banners.
- The layout test pins the 15 section titles and the 35 hot-path names: renaming a hot-path function
  or a section later requires updating the test in the same change (intended friction).
- The compare tool is reusable for any future pure refactor of the plugin (`--base-ref HEAD`).
- Token-joined normalisation ignores all whitespace between tokens, so reformatting a statement is
  not detected as a change; that is acceptable because whitespace between tokens has no runtime
  meaning in this file (no ASI-sensitive line breaks; statements end with `;` or `}`).

## Alternatives considered

- **Split into modules + bundle**: rejected by the USER (option A); would add a build step (FR-11).
- **TypeScript compiler API for the proof**: exact AST, but ties tooling to the `typescript` dev
  dependency's API; the conservative tokenizer is enough for this file (two regex literals, no
  division operator) and is covered by negative-control tests.
- **Permanent CI test against v0.16.1**: rejected; it would block every later behaviour change.
- **Extending `check-fr11.mjs` with the TOC check**: rejected; lint stays FR-11 only and the
  layout check lives in a test with negative controls.
