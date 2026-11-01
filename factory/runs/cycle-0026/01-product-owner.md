# Product Owner report - cycle 0026 - T-037: Organise the single plugin file (TOC, numbered section banners, co-located helpers) and JSDoc every hot path - zero behaviour change

## Inputs read
- factory/VISION.md (defined; no VISION_TEMPLATE_UNCHANGED marker)
- factory/backlog.json (57 items before grooming), factory/state.json (cycle 26, last release v0.16.1)
- factory/runs/cycle-0025/ (factory declared DONE), recent git log (v0.16.1, T-035)
- backend/plugin/azdo-remote-config.ts (1456 lines; top-level declaration names verified for the hot-path list), backend/tools/check-fr11.mjs, docs/architecture/ (ADR-0001..ADR-0020 exist)
- Coordinator brief: USER reopened the factory with a maintainability request and chose OPTION A (keep one file, organise inside); USER addendum: "add jsdoc comments for all hot paths" (merged into the same item)

## Work done
- Reopened the factory for a USER-sourced item; created ONE backlog item T-037 (type tech-debt, source user, priority 1, scope backend only, depends_on T-035 which is done) and set it to in_progress.
- Merged the USER's JSDoc addendum into T-037 (no second item). Defined "hot path" in the item and fixed the hot-path list using the names that actually exist in the current file. Corrections vs. the addendum wording: the default export is `{ id: PLUGIN_ID, server: AzdoRemoteConfig }` (so the `server` function is the const AzdoRemoteConfig); URL building = buildItemsUrl; auth header selection = resolveAuthorization / findPat / basicHeader / azAuthorization (+ defaultRunAz); deadline/timer = startDeadline; capped body reading = readCappedBody; logger helper = makeLogger. Added acquireRemote, runFetch, performRequest, extractContent as they run on every hook / request.
- 7 Given/When/Then ACs, each automatable: TOC/banner scan; hot-path JSDoc presence (purpose, Invariants line, @see); JSDoc safety (ASCII, @see ADRs exist, no secret-like values); identical top-level names / exports / __internals keys; comment-stripped normalised multiset comparison; existing tests unchanged + fresh-import TDZ check; FR-11 + check-docs + ci.sh green.
- No other backlog items re-prioritised. F-012 / F-013 / F-015 stay blocked (skipped); remote mode OFF; T-036 and other todo items unchanged (priority 4-5).

Selected item (copy verbatim):

```json
{
  "id": "T-037",
  "title": "Organise the single plugin file (TOC, numbered section banners, co-located helpers) and JSDoc every hot path - zero behaviour change",
  "type": "tech-debt",
  "priority": 1,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "T-035"
  ],
  "description": "Cycle 0026 PO, USER request (factory reopened after DONE at v0.16.1). The USER asked whether backend/plugin/azdo-remote-config.ts (~1456 lines) should be split into smaller modules or stay one file, and chose OPTION A: KEEP ONE FILE and organise it better inside; USER addendum: 'add jsdoc comments for all hot paths' in the same pass. FR-11 stays fully in force: one TypeScript file, zero runtime npm dependencies, no relative imports, only node: imports, no build step, shipped artefact path unchanged, no new __internals key. PART 1 - organisation: (1) a table-of-contents header comment at the top listing numbered sections; (2) consistent numbered section banners in a dependency-friendly order, e.g. 1 types/constants -> 2 low-level guards/helpers -> 3 JSONC parser (ADR-0003) -> 4 placeholders (ADR-0004) -> 5 merge (ADR-0005) -> 6 settings (ADR-0006) -> 7 fetch/auth (ADR-0007, ADR-0020) -> 8 cache (ADR-0008, ADR-0018) -> 9 logging/hints (ADR-0008) -> 10 config hook -> 11 exports/__internals (the Architect fixes the exact list; TOC and banners match 1:1 and in order); (3) related helpers moved next to their primary users; (4) stale or duplicated comments trimmed while every contract / ADR / FR / AC reference is kept; (5) no dead code (an unused declaration is removed only if provably unreferenced AND not exported / not in __internals; otherwise reported). PART 2 - JSDoc on hot paths. Definition: a HOT PATH is a function or constant that runs on every Kilo start (plugin load + config hook) or on every credential-bearing request. The FIXED hot-path list for this item (names verified against the current file by the PO): AzdoRemoteConfig (the default export's `server`), runConfigHook, executeHook, acquireRemote, resolveSettings, fetchRemoteConfig, runFetch, performRequest, buildItemsUrl, resolveAuthorization, findPat, basicHeader, azAuthorization, defaultRunAz, startDeadline, handleResponse, codeForStatus, readContentType, isJsonMediaType, codeForInterrupted, readCappedBody, extractContent, parseJsonc, resolvePlaceholders, mergeConfig, applyShared, validateShared, readCache, writeCache, checkCacheEnvelope, cacheBindingOf, makeLogger, logHint, hintFor, __internals. Each hot-path declaration gets a preceding /** ... */ block with: a one-sentence purpose; @param / @returns described in prose (do NOT repeat TypeScript types); the fixed error codes / log messages it can produce (e.g. FetchErrorCode values, LOG_* lines, hint lines) where applicable; an invariants line starting 'Invariants:' (as applicable: never throws (FR-10); no secret, URL, host or config value in any log (AC-9); response body discarded unread on non-success; exactly one request per hook run; cache order / binding per ADR-0008 / ADR-0018); and at least one @see pointer to an existing ADR file or contract section (e.g. ADR-0007, ADR-0008, ADR-0018, ADR-0020; plugin-interface.md 2e / 2f / 2f-C). JSDoc must describe the CURRENT code (verified against it, not memory), be ASCII-only, contain no secrets or realistic example keys (any Bifrost key example only as `sk-bf-<...>`), and must not change any code token. HARD CONSTRAINTS: ZERO behaviour change - a pure move-and-comment change: no logic edits, no renames, no signature changes, identical exported surface and __internals key set; declaration order changes must be safe for module evaluation (no top-level const/let read before initialisation at load time; only function declarations may rely on hoisting). All existing tests (~692) pass UNCHANGED - no existing test file is edited (tests import the plugin by path); NEW dev-only tests/scripts may be added. Proof required: a before/after comparison (dev-only script or node:test, output recorded in the engineer report) showing the sorted top-level declaration names, the export list and the __internals keys are identical, and that a normalised comparison (comments and whitespace stripped, top-level statements compared as a sorted multiset) is identical. Optional, ONLY if cheap: a dev-only check (extend backend/tools/check-fr11.mjs or a sibling wired into scripts/ci.sh) that the TOC entries and banners exist in order. No contract version bump (no behaviour change). Versioning: patch (refactor/docs). F-012 / F-013 / F-015 remain blocked/skipped; remote mode stays OFF.",
  "acceptance_criteria": [
    "Given the reorganised backend/plugin/azdo-remote-config.ts, When its source is scanned as text by a dev-only test or check, Then the header contains a table-of-contents comment listing N numbered sections and the file contains exactly N section banner comments in one consistent format whose numbers and titles match the TOC 1:1 and in the same order.",
    "Given the fixed hot-path list in this item (AzdoRemoteConfig (the default export's `server`), runConfigHook, executeHook, acquireRemote, resolveSettings, fetchRemoteConfig, runFetch, performRequest, buildItemsUrl, resolveAuthorization, findPat, basicHeader, azAuthorization, defaultRunAz, startDeadline, handleResponse, codeForStatus, readContentType, isJsonMediaType, codeForInterrupted, readCappedBody, extractContent, parseJsonc, resolvePlaceholders, mergeConfig, applyShared, validateShared, readCache, writeCache, checkCacheEnvelope, cacheBindingOf, makeLogger, logHint, hintFor, __internals), When a dev-only node:test (e.g. under backend/test/tools) reads the plugin source as text, Then every listed declaration is immediately preceded by a /** ... */ JSDoc block that contains a purpose sentence, an 'Invariants:' line and at least one @see tag, and the test fails if any listed name is missing its block or no longer exists in the file.",
    "Given every JSDoc block in the plugin file, When the dev-only test inspects them, Then each @see ADR-NNNN reference names a file that exists in docs/architecture/, the blocks are ASCII-only, and no block contains a secret-like value (no 'sk-bf-' followed by anything other than '<', no 'Basic ' or 'Bearer ' followed by a credential-like token, no dev.azure.com URL with a real-looking organisation).",
    "Given the file before (git main at v0.16.1) and after the change, When the top-level declarations (function, const, let, type, interface, class names) are extracted and sorted, Then the two sorted name lists are identical, and the exported names and the sorted __internals key list are identical.",
    "Given both versions with all comments (including the new JSDoc) and whitespace removed, When their top-level statements are normalised and compared as a sorted multiset, Then the multisets are identical (proving a move-and-comment-only change with no logic edits); the command and its output are recorded in the engineer report.",
    "Given the existing backend test suite (~692 tests), When it runs against the reorganised file, Then every test passes, no pre-existing test file is modified in the cycle diff, and importing the plugin in a fresh process succeeds without a ReferenceError / temporal-dead-zone error with the default export still { id, server } and the same named exports.",
    "Given the change, When the FR-11 lint (backend/tools/check-fr11.mjs), check-docs and 'bash scripts/ci.sh' run, Then all exit 0: the plugin is still ONE TypeScript file at the unchanged path with zero runtime npm dependencies, no relative imports, only node: imports and no new __internals key; and any optional TOC/banner check added is dev-only (not shipped) and fails when a banner is missing or out of order."
  ],
  "source": "user",
  "cycle_done": null,
  "notes": "Cycle 0026 PO: selected (priority 1, USER request; factory reopened after cycle 0025 DONE). Decision recorded: OPTION A (keep one file, organise inside) - FR-11 single-file packaging is preserved because the plugin ships as one file copied into the Kilo plugin folder. USER addendum merged into this same item: JSDoc for all hot paths. Hot-path names were verified by the PO against the current file: the default export is { id: PLUGIN_ID, server: AzdoRemoteConfig }; URL building is buildItemsUrl; auth header selection is resolveAuthorization / findPat / basicHeader / azAuthorization (plus defaultRunAz); the deadline/timer is startDeadline; capped body reading is readCappedBody; the logger factory is makeLogger. One-cycle sized: move + comment edits plus dev-only proof/check tests; no logic, existing-test, contract or behaviour changes."
}
```

## Files changed
- `factory/backlog.json` - appended T-037 (status in_progress). Textual insertion only; existing content, CRLF line endings and escapes untouched; JSON parses; ASCII-only; item count 57 -> 58; exactly one in_progress item (T-037).
- `factory/runs/cycle-0026/01-product-owner.md` - this report.

## Verification
- `node -e "require('./factory/backlog.json')"` -> parses; 58 items; in_progress = [T-037]; T-037 has 7 ACs.
- `git diff --stat factory/backlog.json` -> 27 insertions, pure append of the new object.
- Non-ASCII byte scan of backlog.json -> 0 matches.
- Hot-path names cross-checked against `grep -nE "^(export )?(async )?(function|const|let) " backend/plugin/azdo-remote-config.ts`.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/plugin/azdo-remote-config.ts:1452-1456 | Addendum named the default export as `server`; in code it is the const AzdoRemoteConfig exposed as `server` on the default object. | Item lists AzdoRemoteConfig explicitly; no code change. |

## Assumptions made (no human available)
- Priority 1 and selected immediately - explicit USER request reopening the factory; it outranks all remaining priority 4-5 todo items.
- One item, one cycle - reorganisation and JSDoc are both comment/move-only edits on one file plus dev-only checks; splitting would touch the same lines twice.
- New dev-only tests are allowed (they are additions, not edits of existing tests); the "tests unchanged" constraint applies to pre-existing test files.
- Dead code removal limited to provably unreferenced, non-exported, non-__internals declarations; the declaration-name proof (AC 4) must then document any such removal explicitly - default expectation is no removal.
- Versioning: patch (refactor/docs), no contract version bump since behaviour is unchanged.
- The optional TOC/banner check is left to the Architect/engineer's judgement ("only if cheap"); AC 1 is satisfiable by a dev-only node:test either way.

## Follow-ups for the backlog
- None new. After T-037 ships, the factory can return to DONE unless the USER adds scope (remaining todo items are priority 4-5).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0026/01-product-owner.md
summary: Selected T-037 (USER, P1, backend): keep plugin as one file, add TOC + numbered section banners + JSDoc on all hot paths, zero behaviour change.
