# Product Owner report — cycle 0027 — T-038: Plugin JSDoc trim pass and wording fixes (comment-only)

## Inputs read
- `factory/VISION.md` (no template marker), `factory/state.json` (cycle 27, last release v0.16.2)
- `factory/backlog.json` (60 items; T-038 p1 todo, T-039 p4 todo, F-012/F-013 p3 and F-015 p4 blocked/skipped)
- `factory/runs/cycle-0026/summary.md` (T-037 shipped as v0.16.2; file grew from 1456 to 1939 lines)
- `backend/test/plugin/source-layout.test.ts` (what the layout test actually checks, plus its mutation anchors)
- `backend/plugin/azdo-remote-config.ts` (line count, long lines, `Codes:` lines, the six wording locations)

## Work done
- Selected **T-038** (priority 1, user-sourced, depends on T-037 which is done) and set it to `in_progress`.
- Tightened the description and replaced the 4 loose ACs with 7 ACs that a test or command can check:
  - Zero behaviour change: compare-plugin-shape against v0.16.2 must print PASS. SKIP does not count.
  - Single-file diff under backend/. Tests, tools and architecture docs must be byte-identical to v0.16.2.
  - Size: the file must be at most 1839 lines, which is at least 100 fewer than 1939. No comment line may be longer than 110 characters.
  - Trim rules can be checked with grep: no `Codes: none` lines; the fetch code list appears once; other blocks refer to contract section 2e.
  - The six wording fixes each have a grep-able expected outcome.
- Checked against the test source: source-layout.test.ts does NOT check `Codes:` lines. Per hot path it only needs a purpose sentence ending in '.', an `Invariants:` line and an `@see ` line. So all `Codes: none.` lines can be deleted and the test stays unchanged.
- Listed the test's mutation anchors in the description. They must stay word-for-word or the negative-control tests fail:
  - ` * Invariants: pure and never throws.`
  - ` * @see ADR-0007 section 6` directly before `function basicHeader`
  - `@param text - the JSONC`
  - `Parses JSON with comments and trailing commas.`
  - a JSDoc block before `async function runFetch`
  - `function noop(): void {}`
  - the TOC and the 15 banners
- Corrected function names by checking each location in the source. ~490 is applyShared, ~515 is mergeConfig, ~1223 is readCappedBody, ~1889 is runConfigHook.
- T-039 stays todo at priority 4. F-012, F-013 and F-015 stay blocked (skipped). Remote mode is OFF.

Selected item (verbatim from backlog):

```json
{
  "id": "T-038",
  "title": "Plugin JSDoc trim pass and wording fixes (comment-only)",
  "type": "tech-debt",
  "priority": 1,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "T-037"
  ],
  "description": "Cycle 0026 review/security follow-ups, COMMENT-ONLY in backend/plugin/azdo-remote-config.ts (zero behaviour change, re-proved with compare-plugin-shape vs v0.16.2). The ONLY file that may change under backend/ is backend/plugin/azdo-remote-config.ts; no test, tool, contract or ADR edits (T-039 owns the tool/ADR follow-ups). (1) TRIM: delete every `Codes: none.` line (16; source-layout.test.ts does NOT check Codes: lines, it only requires a purpose sentence ending in '.', an `Invariants:` line and an `@see ` line per hot path); collapse the qualified `Codes: none (...)` / `Codes: none directly...` lines into the Invariants/purpose text or drop them; replace repeated fetch error-code enumerations (handleResponse, readCappedBody, runFetch, fetchRemoteConfig, resolveSettings-related blocks) with a reference such as `Codes: see contracts/plugin-interface.md section 2e.` keeping the full list in at most ONE JSDoc block; shorten the 6 `@param deadline - the operation-wide deadline` lines to a minimal form or drop them; wrap every comment line longer than 110 chars (24 today, incl. the rework-1 run-ons of 133-217 chars). Must keep verbatim the mutation anchors used by source-layout.test.ts: the line ` * Invariants: pure and never throws.` (codeForInterrupted), the text ` * @see ADR-0007 section 6\\n */\\nfunction basicHeader`, `@param text - the JSONC`, `Parses JSON with comments and trailing commas.`, a JSDoc block directly before `async function runFetch`, `function noop(): void {}`, the TOC and the 15 `// ==== N. Title ====` banners. (2) WORDING (six fixes): (a) line ~394 Phase 1 comment 'The only phase that throws' contradicts the mergeConfig JSDoc (the write phase can also throw when the target rejects a write); (b) ~515 'as does a target whose getter throws' - a throwing getter propagates the getter's own error, not a TypeError; (c) ~1223 readCappedBody 'nothing beyond the 1 MiB cap is accumulated' assumes each chunk reports an honest byteLength; (d) ~490 applyShared 'a failed merge leaves the config unchanged' holds for ordinary objects only (rollback is best-effort); (e) ~1889 runConfigHook 'every failure leaves the config unchanged or fully merged' - same ordinary-objects/best-effort qualifier; (f) ~1889 'no ... config value appears in any log' - qualify that L-UNRESOLVED logs sanitised placeholder NAMES (never values). The user's original concern was file size (1456 -> 1939 lines in v0.16.2); target at least 100 fewer lines.",
  "acceptance_criteria": [
    "Given the trimmed plugin, When `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` runs from backend/, Then it prints PASS (not SKIP) and exits 0 with identical declarations, exports, __internals keys and statement multiset.",
    "Given the branch, When `git diff --name-only v0.16.2 -- backend` runs, Then it lists only backend/plugin/azdo-remote-config.ts, and `git diff --exit-code v0.16.2 -- backend/test backend/tools docs/architecture` exits 0 (source-layout.test.ts unchanged).",
    "Given the unchanged source-layout.test.ts, When the backend test suite and `bash scripts/ci.sh` run, Then all tests pass (35 hot paths keep a purpose sentence, an Invariants: line and an @see line; 15 banners and TOC intact).",
    "Given the trimmed file, When `wc -l backend/plugin/azdo-remote-config.ts` runs, Then it reports at most 1839 lines (at least 100 fewer than 1939), and no comment line (starting with optional whitespace then `*`, `/**` or `//`) is longer than 110 characters.",
    "Given the trimmed file, When searched, Then `^ \\* Codes: none` matches 0 lines, the full fetch error-code list (bad-response, too-large, network, timeout, network-blocked) appears in at most one JSDoc block, and every other fetch-path block that mentions codes references `contracts/plugin-interface.md section 2e`.",
    "Given the Phase 1 comment and the mergeConfig JSDoc, When searched, Then the phrase 'The only phase that throws' matches 0 lines and the mergeConfig Invariants no longer say a throwing getter gives a TypeError (it states the getter's own error propagates).",
    "Given the readCappedBody, applyShared and runConfigHook JSDoc blocks, When read, Then the readCappedBody 1 MiB cap sentence mentions byteLength as the trusted chunk size, the applyShared and runConfigHook rollback claims say 'ordinary objects' and 'best-effort', and the runConfigHook log claim mentions L-UNRESOLVED placeholder names (no values)."
  ],
  "notes": "Cycle 0027 PO: selected (priority 1, USER-sourced size concern). Tightened: measurable size (<= 1839 lines), 110-char cap on comment lines only (18 CODE lines already exceed 110 and cannot change in a comment-only item), Codes: lines confirmed NOT required by source-layout.test.ts so `Codes: none.` lines are deleted, test-anchor strings listed so the layout test passes unchanged. Comment-only, one file, one cycle.",
  "source": "user",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json` — T-038: status in_progress, description and ACs tightened, notes added.

## Verification
- `node -e` parse of factory/backlog.json: valid JSON, ASCII only, 60 items. The only in_progress item is T-038, which has 7 ACs. T-039 is todo at p4. F-012, F-013 and F-015 are blocked.
- `wc -l backend/plugin/azdo-remote-config.ts`: 1939 (baseline). There are 16 `Codes: none.` lines and 6 `@param deadline` lines. 24 comment lines are longer than 110 characters, and so are 18 code lines.
- `git tag --points-at HEAD`: v0.16.2 (the baseline ref exists locally).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/plugin/azdo-remote-config.ts:1889 | The item called the block at ~1889 the "AzdoRemoteConfig" JSDoc, but it is the runConfigHook JSDoc | Item text corrected |

## Assumptions made (no human available)
- The 110-character cap applies to comment lines only. 18 code lines already exceed 110 and cannot change in a comment-only item.
- Size target is at least 100 fewer lines (<= 1839), not the original 80. That matches the user's size concern, and with about 550 comment lines it is achievable.
- The full fetch error-code list is kept in one JSDoc block, and the others refer to contracts/plugin-interface.md section 2e. The full list stays visible for maintainers, and duplicates are removed.

## Follow-ups for the backlog
- None new. T-039 (tool hardening, ADR status lines, AC-3 negative-control independence) stays at p4.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/01-product-owner.md
summary: Selected T-038 (comment-only JSDoc trim to <=1839 lines + six wording fixes), ACs tightened to 7 testable checks, set in_progress.
