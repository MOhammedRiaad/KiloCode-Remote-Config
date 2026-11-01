# Architect report - cycle 0026 - T-037: Organise the single plugin file (TOC, numbered section banners, co-located helpers) and JSDoc every hot path - zero behaviour change

## Inputs read
- factory/runs/cycle-0026/01-product-owner.md, T-037 in factory/backlog.json (7 ACs)
- backend/plugin/azdo-remote-config.ts (1456 lines, read in full), backend/tools/check-fr11.mjs,
  backend/package.json, backend/tsconfig.json, scripts/ci.sh, .gitattributes
- docs/architecture/ADR-0001 .. ADR-0020, overview.md, contracts/plugin-interface.md (headings 2, 2a-2f,
  2f-C, 2f-L, 3, 5), contracts/docs-check.md (kilo-range rule reads the plugin as text)
- Tests that touch the plugin source as text: test/installer/install-sh.test.ts and install-ps1.test.ts
  (byte copy of the working file - unaffected), test/tools/check-docs.test.ts (fixtures only)

## Work done
- New ADR-0021 (layout, TDZ analysis, JSDoc standard, comment-safety rule, dev-only checks).
- Amended ADR-0001 (status line, section 6 layout bullet, section 7 tool, section 8 dev-only command
  row), ADR-0007 section 12 and ADR-0008 section 8 (JSDoc blocks now allowed under ADR-0021 section 4),
  overview.md (C2 internal structure = the 15 sections; directory layout gains the tool and tests).
- No contract change (no behaviour change; plugin-interface.md version unchanged).

### Design summary
Keep ONE file (FR-11 unchanged). Header purpose comment + TOC, then 15 numbered banners in a
dependency-friendly order. Five cross-section helpers move up into a new section 2; the long fetch
block is split into four sections (foundations / auth / response / pipeline); the long hook block is
split into validation / cache / logging / hook. Everything else keeps its relative order. JSDoc is added
to 35 fixed hot paths. Proof: a dev-only tokenizer tool compares v0.16.1 with the working copy; a new
permanent layout test enforces TOC/banners/JSDoc/comment safety and a fresh-process import.

### 1. Sections (exact titles - copy verbatim; ADR-0021 section 1)
```
1. Imports, public types and plugin identity (ADR-0001, ADR-0002)
2. Shared guards and helpers
3. JSONC parser (ADR-0003)
4. Placeholder resolver (ADR-0004)
5. Config merge (ADR-0005)
6. Settings resolution (ADR-0006, ADR-0009)
7. Fetch foundations: types, target, URL and deadline (ADR-0007)
8. Authentication: PAT and az CLI (ADR-0007)
9. Response handling and failure classification (ADR-0007, ADR-0020)
10. Fetch pipeline: fetchRemoteConfig (ADR-0007)
11. Shared config validation (ADR-0008, ADR-0009)
12. Config cache bound to settings (ADR-0008, ADR-0018)
13. Logging, fixed messages and hints (ADR-0008, ADR-0020)
14. Config hook: runConfigHook (ADR-0008)
15. Exports: __internals, server and default export (ADR-0002)
```
File head (format is normative):
```
// azdo-remote-config: Kilo plugin that applies a remote Azure DevOps config.
// <existing purpose lines, ADR list updated to "ADR-0001 .. ADR-0021"; keep FR-11, ADR-0018 mentions>
// Types not marked export are module-local on purpose (ADR-0002).
//
// Table of contents (one numbered section banner per entry, same numbers, titles and order):
//   1. Imports, public types and plugin identity (ADR-0001, ADR-0002)
//   ...
//   15. Exports: __internals, server and default export (ADR-0002)

// ==== 1. Imports, public types and plugin identity (ADR-0001, ADR-0002) ====

import { execFile } from "node:child_process";
```
TOC line regex `^//   (\d+)\. (.+)$` (three spaces, also for 10-15). Banner regex `^// ==== (\d+)\. (.+) ====$`,
blank line before and after. Remove the old `// ---- ... ----` markers (lines 162, 283, 418, 633,
1091, 1186, 1316, 1357).

### 2. Move plan (line numbers = current v0.16.1 file)
Cut/paste WHOLE declarations together with their attached comments. Within each target section keep
the current relative order unless stated.

| Section | Contents, in order (source lines) |
|---|---|
| 1 | imports 8-11; types 13-40; `PLUGIN_ID` 42; `SUPPORTED_KILO_RANGE` 44 (line must stay byte-identical: check-docs `kilo-range` regex `^export const SUPPORTED_KILO_RANGE\s*=\s*"..."\s*;`) |
| 2 (moved up) | `noop` 717, `attempt` 708-715, `readOwn` 466-474, `isRecordLike` 476-483, `isPlainObject` 288-292 |
| 3 | `BOM` 46, then 48-160 unchanged |
| 4 | 164-281 unchanged (drop the "Module-local types" line 164) |
| 5 | 285-416 minus `isPlainObject` |
| 6 | 420-631 minus `readOwn`, `isRecordLike` (drop line 420 comment) |
| 7 | types 636-656 (`FetchErrorCode`, `FetchResult`, `FetchInit`, `FetchLike`), 665-684 (`FetchTarget`, `Outcome`, `Clock`, `Deadline`); `AZDO_HOST_PREFIX` 701; `failure` 704; `validField`, `readTarget`, `readTimeoutMs`, `buildItemsUrl` 719-758; `resolveFetch` 760-765; `resolveClock` 773-780; `startDeadline` 782-808; `codeForInterrupted` 879-882 |
| 8 | `AzRunResult` 658-661, `AzRunner` 663; consts `MAX_TOKEN_CHARS` 688, `AZ_RESOURCE` 689, `AZ_TOKEN_ARGS` 690-699, `AZ_COMMAND_LINE` 700, `AZ_MAX_BUFFER` 702 (THIS ORDER IS MANDATORY - TDZ); `resolveRunner` 767-771; `isVisibleAscii` .. `resolveAuthorization` 810-877; `toAzResult` 1058-1062; `windowsCommandInterpreter` 1064-1069; `defaultRunAz` 1071-1089 |
| 9 | `MAX_RESPONSE_BYTES` 686, `MAX_EMPTY_CHUNKS` 687; `discard` .. `handleResponse` 884-1009 (incl. `BodyReader`) |
| 10 | `performRequest` 1011-1027, `runFetch` 1029-1046, `fetchRemoteConfig` 1048-1056 |
| 11 | `SharedCheck` 1103; `exceedsDepth` 1165-1171; `validateShared` 1173-1184 |
| 12 | `CacheFs` 1094-1101; `CacheWriteCode`, `CacheReadCode`, `CacheWrite`, `CacheRead` 1104-1113; `CacheBinding` 1118-1124; `CacheLocation` 1188-1191; `CACHE_FORMAT`, `CACHE_BINDING_KEYS`, `CACHE_ROOT_KEYS`, `MAX_CACHE_BYTES` 1126-1129; `REAL_FS` 1133; `let cacheCounter` 1147; 1193-1314 unchanged |
| 13 | `HookLog` 1115; `LOG_*` 1135-1145 (incl. both hints); `MAX_LOGGED_PLACEHOLDERS`, `MAX_LOGGED_NAME_CHARS` 1130-1131; `makeLogger` 1318-1339; `hintFor` 1149-1158; `logHint` 1160-1163; `cleanName`, `listNames` 1341-1355 |
| 14 | `Acquired` 1114, `HookDeps` 1116, `HOOK_DEP_KEYS` 1132; 1359-1440 unchanged |
| 15 | `__internals` 1442-1450, `AzdoRemoteConfig` 1452-1454, `export default` 1456 (LAST statement) |

TDZ analysis (ADR-0021 section 2): the only import-time reads of other top-level bindings are
`AZ_TOKEN_ARGS <- AZ_RESOURCE`, `AZ_COMMAND_LINE <- AZ_TOKEN_ARGS`, and
`export default <- PLUGIN_ID, AzdoRemoteConfig`. `SETTING_SPECS` references hoisted function
declarations (`checkMode`, `checkPat`, `checkTimeout`) and call-time arrows; `REAL_FS` reads imported
`node:fs` bindings; `__internals` reads function declarations. No module function is called at import.
All other consts are literals / `Symbol()` / arithmetic. So the plan above cannot introduce a TDZ error;
the AC-6 fresh-import test guards it anyway.

Comment trimming: the four "Module-local types: deliberately not exported." lines become one header line.
Every `//` comment directly above a hot-path declaration is MERGED into its JSDoc (content kept; ADR /
FR / AC / F-/T- references kept verbatim, e.g. the "407, 470 (Azure Firewall deny, community-reported)"
note moves into codeForStatus's block). Other comments stay unchanged. Header ADR list updated.

Dead code: none. `tsconfig.json` has `noUnusedLocals: true` and `npm run typecheck` passes, so every
module-local declaration is referenced; exported names are API. REMOVE NOTHING.

### 3. Hot-path JSDoc: template and citations (ADR-0021 section 3)
```
/**
 * Picks the Authorization value for the one Items API request: a PAT as Basic, else an az bearer token.
 *
 * @param settings - resolved settings; only its own non-enumerable pat is read here.
 * @param deps - injected seams (env, runAz); absent members fall back to the real ones.
 * @param deadline - the operation-wide deadline that also bounds the az call.
 * @param timeoutMs - az child-process timeout in milliseconds.
 * @returns the header value, or undefined when no credential is usable (runFetch maps it to auth-unavailable).
 * Codes: none directly.
 * Invariants: never throws; the PAT or token never reaches a log, error or result code (AC-9).
 * @see ADR-0007 section 6
 * @see contracts/plugin-interface.md section 2e
 */
```
(Wording above is a format example; verify every sentence against the current code.)

| Hot path | @see (all targets verified to exist) |
|---|---|
| AzdoRemoteConfig | ADR-0002; contracts/plugin-interface.md section 3 |
| runConfigHook | ADR-0008 section 7; plugin-interface.md section 2f |
| executeHook | ADR-0008 section 2; ADR-0018 section 5; ADR-0020 section 4; plugin-interface.md section 2f-L |
| acquireRemote | ADR-0008 section 2; plugin-interface.md section 2f |
| resolveSettings | ADR-0006; ADR-0009 section 1; plugin-interface.md section 2d |
| fetchRemoteConfig | ADR-0007 section 1; ADR-0020; plugin-interface.md section 2e |
| runFetch | ADR-0007 section 3; plugin-interface.md section 2e |
| performRequest | ADR-0007 section 5; ADR-0007 section 9 |
| buildItemsUrl | ADR-0007 section 5; plugin-interface.md section 5 |
| resolveAuthorization, findPat, basicHeader | ADR-0007 section 6 |
| azAuthorization, defaultRunAz | ADR-0007 section 7 |
| startDeadline, codeForInterrupted | ADR-0007 section 8; ADR-0020 |
| handleResponse | ADR-0007 section 10; ADR-0020 |
| codeForStatus, readContentType, isJsonMediaType | ADR-0020 (amendment A1 for 470) |
| readCappedBody, extractContent | ADR-0007 section 10 |
| parseJsonc | ADR-0003; plugin-interface.md section 2a |
| resolvePlaceholders | ADR-0004; plugin-interface.md section 2b |
| mergeConfig | ADR-0005; plugin-interface.md section 2c |
| applyShared | ADR-0008 section 6; ADR-0005 |
| validateShared | ADR-0008 section 3; ADR-0009 section 2 |
| readCache, writeCache, checkCacheEnvelope, cacheBindingOf | ADR-0018 sections 1-4; plugin-interface.md section 2f-C |
| makeLogger | ADR-0008 section 5; plugin-interface.md section 2f-L |
| hintFor, logHint | ADR-0020 section 4 |
| __internals | ADR-0002; plugin-interface.md section 2 |

Accuracy notes: parseJsonc THROWS (`Invalid JSONC: ...`, no input text) and mergeConfig throws on over-deep
/ cyclic input - their Invariants line states what they throw, not "never throws". Codes/logs to name:
handleResponse/readCappedBody/extractContent/codeForStatus/codeForInterrupted - `bad-response`, `too-large`,
`network`, `network-unreachable`, `network-blocked`, `timeout`, `http-NNN`; runFetch - `invalid-settings`,
`network`, `auth-unavailable`; readCache - `cache-unavailable|missing|unreadable|invalid|outdated|mismatch`;
writeCache - `cache-unavailable|too-large|write-failed`; executeHook/runConfigHook - LOG_* constants and the
L- ids of contract 2f-L; hintFor - LOG_HINT_NETWORK / LOG_HINT_CREDENTIALS. `@param name - text` only, no `{Type}`.

### 4. Dev-only checks
A) `backend/test/plugin/source-layout.test.ts` (new, permanent, in `npm test`): reads the plugin as text
(normalise CRLF to LF first). Pins `EXPECTED_SECTIONS` (15 titles above) and `HOT_PATHS` (35 names).
Pure checker functions defined in the test, applied to the real source (expect no problems) AND to
mutated copies (negative controls):
- AC-1: TOC entries (header before first banner) == banners == EXPECTED_SECTIONS, numbers 1..15; any
  line starting `// ====` that does not match the banner regex fails; any `// ---- ` marker fails.
  Negatives: banner removed, two banners swapped, title edited, TOC entry removed.
- AC-2: each hot path declared exactly once by `^(?:export )?(?:async )?(?:function|const) NAME\b`;
  text between the preceding `*/` and the declaration is whitespace only; block has a purpose line
  (first non-tag text line, ends with `.`), a line starting `Invariants:`, at least one `@see`; no
  `@param {` / `@returns {`. Negatives: block stripped, Invariants removed, @see removed, name renamed.
- AC-3 + comment safety, over EVERY `/** */` block: whole file ASCII (0x09, 0x0A, 0x0D, 0x20-0x7E);
  `/**` first on its line, `*/` last on its line, body without `/*` or `*/`; no other `/*` or `*/` in
  the file; each `@see ADR-NNNN` resolves to `docs/architecture/ADR-NNNN-*.md` and `section N` to a
  `### N.` heading there; each `@see contracts/X.md section ID` resolves to an existing file with a
  `^#{2,3} ID\.` heading; secret scan: `/sk-bf-(?!<)/`, `/\b(?:Basic|Bearer)\s+(?=[A-Za-z0-9+\/._~-]*\d)[A-Za-z0-9+\/=._~-]{8,}/`,
  `/\b(?:Basic|Bearer)\s+[A-Za-z0-9+\/._~-]{4,}={1,2}/`, `/dev\.azure\.com\/(?!<)[A-Za-z0-9]/`.
  Negatives: a block with `sk-bf-` + 16 alphanumerics built by concatenation in the test, a bad ADR
  number, a missing contract section, a non-ASCII char, an inner `*/`.
- AC-6: `spawnSync(process.execPath, ["--input-type=module", "-e", script])` importing the plugin by
  file URL in a fresh process; asserts exit 0, empty stderr (no ReferenceError), sorted module keys
  `["PLUGIN_ID","SUPPORTED_KILO_RANGE","__internals","default"]`, `Object.keys(default)` `["id","server"]`,
  `typeof server === "function"`, `Object.keys(__internals)` exactly
  `["parseJsonc","resolvePlaceholders","mergeConfig","resolveSettings","fetchRemoteConfig","runConfigHook"]`.
B) `backend/tools/compare-plugin-shape.mjs` (new, manual; ADR-0021 section 5). CLI:
`node tools/compare-plugin-shape.mjs [--base-ref <ref>] [--base-file <path>] [--head-file <path>]`
(default base-ref HEAD, head-file `<backend>/plugin/azdo-remote-config.ts`; `--base-ref` and
`--base-file` mutually exclusive; ref must match `^[A-Za-z0-9][A-Za-z0-9._\/-]*$`; base via
`execFileSync("git", ["-C", repoRoot, "show", ref + ":backend/plugin/azdo-remote-config.ts"])`, no shell).
`node:` imports only, no writes. Tokenizer: CRLF->LF; drop `//` and `/* */` comments; strings `'` `"`
with escapes verbatim; template literals verbatim incl. nested `${...}` (with nested strings/templates);
regex literal when `/` follows start, a punctuator in `( , = : [ ! & | ? { } ; + - * % < > ~ ^` or keyword
`return typeof case do else in of new delete void throw`, scanning `[...]` classes and escapes, then
flags; word tokens `[A-Za-z0-9_$]+`; every other char one punctuator token. Brackets `( [ {` / `) ] }`
counted outside literals. A token first on its line, at column 0, with depth 0 starts a top-level
statement. Normalised statement = tokens joined by one space. Extract: declaration names
(`^(?:export )?(?:default )?(?:async )?(?:function|const|let|var|type|interface|class|enum) (\S+)`),
exports (`export default` -> `default`), `__internals` keys (identifiers at depth 1 of its object
literal followed by `,` `:` or `}`). Output:
```
compare-plugin-shape: base <ref|file> (<n> statements), head <file> (<n> statements)
declarations: <n> identical
exports: <n> identical (<sorted list>)
__internals keys: <n> identical (<sorted list>)
statements: multiset of <n> identical
compare-plugin-shape: PASS
```
Differences: `only in base:` / `only in head:` lines (statement truncated to 160 chars), last line
`compare-plugin-shape: FAIL`, exit 1. Usage / unterminated literal or comment: exit 2. git missing or
ref unknown: `compare-plugin-shape: SKIP - base <ref> unavailable (no git history)`, exit 0.
C) `backend/test/tools/compare-plugin-shape.test.ts` (new): spawns the tool with temp `--base-file` /
`--head-file` fixtures ONLY (never real history): identical -> PASS; reordered declarations + added
JSDoc/banners + CRLF head -> PASS; changed whitespace inside a string -> FAIL; `>` -> `>=` -> FAIL;
renamed function -> FAIL (declarations diff); extra `__internals` key -> FAIL; dropped `export` -> FAIL;
`"https://a/"` truncation proves `//` in strings is not a comment -> FAIL; regex literal containing
`{`, `}` and `\/\/` moved -> PASS, edited -> FAIL; nested template moved -> PASS, edited -> FAIL;
`--base-ref` with a nonexistent ref in a temp non-git dir via `--head-file` -> SKIP exit 0; bad args -> exit 2.

### 5. Lint
`tools/check-fr11.mjs` unchanged; it does not touch or need to know about the layout. The tool is
`.mjs` (rule 8 covers `tools/*.ts` only) but follows the same `node:`-only rule. The new test files are
`.ts` under `test/` and type-checked by the existing `tsconfig.json` include.

## Files changed
- `docs/architecture/ADR-0021-plugin-source-layout-and-hot-path-jsdoc.md` - new ADR (layout, TDZ, JSDoc, comment rule, proof tool)
- `docs/architecture/ADR-0001-tech-stack.md` - status amended; section 6 layout bullet; section 7 tool; section 8 dev-only command row
- `docs/architecture/ADR-0007-azdo-fetch-and-auth.md` - section 12 note: JSDoc blocks allowed per ADR-0021 section 4
- `docs/architecture/ADR-0008-config-hook-wiring-cache-logging.md` - section 8 note: same
- `docs/architecture/overview.md` - C2 internal structure replaced with the 15 sections; directory layout entries
- `factory/runs/cycle-0026/02-architect.md` - this report

## Backend tasks
Senior BE. Paths: `backend/plugin/azdo-remote-config.ts`, `backend/tools/compare-plugin-shape.mjs` (new),
`backend/test/tools/compare-plugin-shape.test.ts` (new), `backend/test/plugin/source-layout.test.ts` (new).
NO pre-existing test file may be modified (AC-6). No logic, name, signature, export or `__internals` change.
No new import, no new dependency. Keep `SUPPORTED_KILO_RANGE` line byte-identical.

Order of work:
1. BE-1 (AC-4, AC-5 instrument) Record baseline: `cd backend && npm test` (note pass count, ~692),
   `npm run typecheck`, `npm run lint`. Write `tools/compare-plugin-shape.mjs` and
   `test/tools/compare-plugin-shape.test.ts` (spec 4B/4C). Run `node tools/compare-plugin-shape.mjs --base-ref v0.16.1`
   on the UNCHANGED plugin -> must PASS (proves the tokenizer handles the real file). No plugin edit yet.
2. BE-2 (AC-1/AC-4/AC-5/AC-6) MOVES in small steps, each a pure cut/paste of whole declarations
   with their comments; after EACH step run `node tools/compare-plugin-shape.mjs --base-ref v0.16.1`,
   `npm run typecheck` and `npm test`:
   a. section 2: move noop, attempt, readOwn, isRecordLike, isPlainObject up after PLUGIN_ID/SUPPORTED_KILO_RANGE; move BOM to just before isLineBreak (it already is).
   b. split the fetch block into sections 7, 8, 9, 10 per the move table (keep AZ_RESOURCE -> AZ_TOKEN_ARGS -> AZ_COMMAND_LINE order).
   c. split the hook block into sections 11, 12, 13, 14 per the move table.
   d. confirm section 15 is last and `export default` is the final statement.
   e. header: update ADR list, add the module-local types line and the TOC; replace old `// ----` markers
      with the 15 exact banners; drop the four duplicated "Module-local types" lines.
3. BE-3 (AC-2, AC-3) JSDoc for the 35 hot paths, section by section, using the template and the
   citation table (section 3 of this report). Merge the existing `//` comment above each into the block;
   extend the existing `/** */` on parseJsonc and __internals. Describe the CURRENT code. ASCII only;
   no `*/` or `/*` inside a block body (no glob text); no `{Type}`; no secret-like examples. After each
   section: compare tool + `npm test`.
4. BE-4 (AC-1, AC-2, AC-3, AC-6) Write `test/plugin/source-layout.test.ts` (spec 4A) with negative controls.
5. BE-5 (AC-4, AC-5, AC-7) Final gate, record commands + full output in the engineer report:
   `node tools/compare-plugin-shape.mjs --base-ref v0.16.1` (PASS, 195 declarations, 10 exports,
   6 `__internals` keys), `npm run lint`, `npm run typecheck`, `npm test` (old count + new tests, 0 fail),
   `node backend/tools/check-docs.mjs` (repo root), `bash scripts/ci.sh`,
   `git diff --stat main -- backend/test` (only the three new files appear as added),
   `git ls-files --eol backend/plugin/azdo-remote-config.ts` after staging (index `i/lf`).

## Frontend tasks
None. `frontend/` does not exist and the item has no frontend scope.

## Security notes (for the Security engineer)
- Zero behaviour change is the security property: verify with the compare tool (re-run it yourself)
  that the statement multiset is identical; any diff in a code statement is a FAIL.
- JSDoc must not leak secrets: the layout test scans for `sk-bf-` values, Basic/Bearer credentials and
  real `dev.azure.com/<org>` URLs; reviewers should also read the blocks for org/project names,
  internal hostnames, or tenant/user identifiers.
- Comment safety: an inner `*/` or a `/*` in a string would desynchronise the naive comment stripper in
  `check-fr11.mjs` (import scan) - enforced by the new test.
- New tool runs `git` via `execFileSync` without a shell and validates the ref (no leading `-`, no
  option injection); it reads only, writes nothing, and is never shipped or run by CI.
- `__internals` key set and named exports must be identical (ADR-0002: no function export, no `server` key).

## Verification
- `node backend/tools/check-docs.mjs` -> `check-docs: PASS (37 markdown files checked)` after the doc edits.
- ASCII scan of the new / edited architecture docs -> no non-ASCII bytes.
- Section headings cited in the @see table verified present (ADR-0007 sections 1-12, ADR-0008 sections
  1-8, ADR-0018 sections 1-7, ADR-0020 section 4, ADR-0006 / ADR-0009 sections, plugin-interface.md
  2, 2a-2f, 2f-C, 2f-L, 3, 5). ADR-0002/0003/0004/0005 have no numbered sections - cite without section.
- Plugin import-time initialisers enumerated (ADR-0021 section 2); exports confirmed:
  LogLevel, PluginInput, PluginOptions, KiloConfig, Hooks, PluginServer, PLUGIN_ID, SUPPORTED_KILO_RANGE, __internals, default.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | docs/architecture/ADR-0007 section 12, ADR-0008 section 8 | Earlier rules banned slash-star in plugin comments, which conflicts with the USER's JSDoc request. | Resolved by ADR-0021 section 4 (whole-line JSDoc blocks allowed, inner sequences banned, enforced by test). |
| 2 | info | backend/plugin/azdo-remote-config.ts (working copy) | Index is LF, working copy CRLF (core.autocrlf=true). | Keep line endings uniform in the working copy (no mixed endings); tool and test normalise CRLF; index must stay `i/lf`. |

## Risks
- TDZ: only the AZ_* chain and the final `export default` are order-sensitive; covered by the plan and the fresh-import test.
- Accidental code edits during cut/paste (editor auto-format, trimmed whitespace, quote style, regex
  literal edits): caught by the compare tool after every step; disable format-on-save.
- Line endings: mixed CRLF/LF in the working copy produces a noisy diff; git stores LF.
- `*/` inside JSDoc (for example glob text) would end the comment early and break parsing / lint.
- check-docs `kilo-range` reads the `SUPPORTED_KILO_RANGE` line as text: do not touch that line.
- Large diff is expected (moves); review relies on the compare tool output, not on the line diff.

## Assumptions made (no human available)
- A short new ADR-0021 was warranted because the item overrides the comment rule of ADR-0007/ADR-0008
  and adds a permanent layout rule plus a tool; ADR-0001 got a brief pointer amendment.
- Tokenizer instead of the TypeScript compiler API, per the coordinator brief (no tooling coupling);
  the file has two regex literals and no division operator, and negative-control tests cover the tokenizer.
- The compare tool is manual only; a permanent test against v0.16.1 would block future behaviour changes.
- `applyShared` stays in section 5 (next to mergeInto / rollback, its only collaborators).
- Section 2 holds only helpers used by three or more later sections; isDigitString, isWellFormedText and
  the accept* validators stay in section 6 (fetch reuses the ADR-0006 validators, which precede it).

## Follow-ups for the backlog
- None required.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0026/02-architect.md
summary: T-037 design: one file, header TOC + 15 numbered banners (ADR-0021), TDZ-safe move plan, JSDoc standard for 35 hot paths, permanent layout test + manual tokenizer compare tool vs v0.16.1; backend-only, no contract change.
