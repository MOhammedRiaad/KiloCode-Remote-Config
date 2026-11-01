# Code Review report - cycle 0026 - T-037: Organise the single plugin file (TOC, numbered section banners, co-located helpers) and JSDoc every hot path - zero behaviour change

Review after rework iteration 1 (HEAD 3ddb8ea).

## Inputs read
- `git diff main...HEAD` (17 files; working tree clean), `git log main..HEAD`
- factory/backlog.json T-037 (7 ACs), 01-product-owner.md, 02-architect.md, 03-backend.md, 03-backend-rework1.md,
  04-security.md, 04-security-rerun1.md
- docs/architecture/ADR-0021 (new), ADR-0001 / ADR-0007 / ADR-0008 amendments, overview.md
- backend/plugin/azdo-remote-config.ts (read in full, 1939 lines), backend/test/plugin/source-layout.test.ts,
  backend/tools/compare-plugin-shape.mjs, backend/test/tools/compare-plugin-shape.test.ts, backend/tools/check-fr11.mjs

## Work done
1. Quality gate and proof tool run myself (results under Verification).
2. Independent zero-behaviour-change proof, not relying on the new tokenizer: took v0.16.1 and HEAD, dropped JSDoc
   blocks, whole-line `//` comments and blank lines, sorted the remaining lines byte-exact. Both sides: 1209 lines,
   `diff` empty. Every code line is byte-identical (including intra-line whitespace); only line order and comments
   changed. Together with the fresh-import test (TDZ) this closes the zero-behaviour-change question.
3. Mutation testing on a scratch copy built with `git archive HEAD` (never in the repo; harness in the scratchpad).
   source-layout.test.ts - 23 mutations, 23 KILLED:
   delete hintFor JSDoc; drop resolveSettings `Invariants:`; swap banners 12/13; swap TOC entries 3/4 only; banner 16
   inserted before 15 (not in TOC); banner 16 appended at EOF; non-ASCII char in a JSDoc; `*/` inside a JSDoc;
   `sk-bf-` + 20 alphanumerics in a JSDoc; `Bearer eyJ...1234` in a JSDoc; `https://dev.azure.com/contoso/...`;
   removed `@see`; `@see ADR-0099`; `@see ADR-0007 section 77`; `//` line between `*/` and the declaration; purpose
   without full stop; hot path renamed everywhere; statement after `export default`; plain `/* x */` in code;
   TDZ (`AZ_COMMAND_LINE` before `AZ_TOKEN_ARGS`) - killed by the AC-6 fresh-import test; `export default` above
   `AzdoRemoteConfig`; extra `__internals` key; banner without trailing blank line.
   compare-plugin-shape (base = v0.16.1 file) - comment-only change PASS, JSDoc removal PASS, function moved PASS;
   changed string literal, changed header string, rename everywhere, deleted top-level statement, deleted inner
   statement, `>` to `>=`, number change, swapped inner statements, regex edit, template whitespace edit, dropped
   `export` - all FAIL (exit 1) as required.
   One blind spot found with synthetic files (finding 7): `a + ++b` -> `a++ + b` and `--a` -> `- -a` report PASS.
4. Contract: no behaviour or API change; plugin-interface.md untouched and its version unchanged; exports (10),
   `__internals` keys (6, same order) and `default { id, server }` verified by the tool and the fresh-import test.
5. Lanes: code changes only under `backend/` (plugin modified; 3 files added). `git diff main...HEAD --name-status
   -- backend/test` shows only `A` entries: no pre-existing test modified. No change to scripts/, .github/,
   check-fr11.mjs. docs/architecture changed by the Architect only.
6. Readability judged by reading the whole file (see "Readability assessment").
7. check-fr11 comment stripper (`/\/\*[\s\S]*?\*\//g`, line 17): with ADR-0021 section 4 enforced (whole-line
   blocks, no inner `/*` or `*/`, no `/*` or `*/` anywhere else in the file - mutation-tested above) the non-greedy
   strip removes exactly the JSDoc blocks and nothing else. Permitting `/** */` is sound; the old ban protected the
   same property and the new test enforces it more strictly than the old text-only rule did. I agree with the
   decision.

## AC walk
| AC | Implemented | Test that fails if broken | Verdict |
|----|-------------|---------------------------|---------|
| AC-1 TOC <-> 15 banners 1:1 in order | header lines 9-24, 15 banners | source-layout "AC-1 ..." x3 (mutations 3-6, 23 killed) | met |
| AC-2 JSDoc on 35 hot paths (purpose, Invariants:, @see) | all 35 present, verified by reading | "AC-2 ..." (mutations 1, 2, 12, 15-17 killed) | met |
| AC-3 @see targets exist, ASCII, no secret-like | all @see resolve to ADR files / `###` headings / contract headings | "AC-3 ..." (mutations 7-11, 13, 14, 19 killed) | met |
| AC-4 same declarations / exports / __internals | unchanged | compare tool PASS vs v0.16.1 (195 / 10 / 6); tool's own 14 tests; fresh-import keys | met |
| AC-5 normalised statement multiset identical, recorded | 200 = 200 | compare tool output in 03-backend.md and re-run here; my byte-exact line-multiset check | met |
| AC-6 existing tests unchanged + pass, fresh import, default shape | 714 pass / 0 fail / 10 skipped (702 old + 22 new) | "AC-6 ..." spawnSync fresh process (TDZ mutation killed) | met |
| AC-7 FR-11 lint, check-docs, ci.sh | all exit 0 | ci.sh itself | met |

## Readability assessment (honest)
- Organisation is clearly better. Sections follow the data flow (parse -> placeholders -> merge -> settings ->
  fetch foundations -> auth -> response -> pipeline -> validation -> cache -> logging -> hook -> exports). TOC and
  banners are accurate and uniform. Cross-section helpers in section 2 make sense. Splitting the old 400-line
  fetch block into four sections and the hook block into four is the biggest win for navigation. No orphaned
  comments; the four duplicate "Module-local types" lines are gone.
- Size: 1456 -> 1939 lines. About 480 of the 483 added lines are JSDoc (488 lines are in `/** */` blocks; about 13
  lines per hot path). The code body is unchanged at 1209 non-comment lines. Most blocks earn their place:
  `Invariants:` lines encode non-obvious guarantees (order, guards, AC-9, rollback) that were only tribal knowledge
  before.
- Verbose or duplicated parts:
  - `Codes: none.` appears 16 times.
  - The full fetch code list is repeated in fetchRemoteConfig, acquireRemote and, partly, in handleResponse,
    performRequest and runFetch.
  - `@param deadline - the operation-wide deadline` appears 6 times.
  - Four blocks edited in rework 1 (resolvePlaceholders :326, applyShared :489, mergeConfig :515, runConfigHook
    :1889) are run-on sentences on 133-217 character lines. That breaks the ~110-column wrapping used everywhere
    else.
  - A trim pass could remove about 80-120 lines with no loss: drop `Codes: none.` and `@returns nothing.`, say
    "plus every code of handleResponse" instead of re-listing, and state the hostile-input caveat once.
- Given the user's file-size concern, this growth is acceptable. The user explicitly asked for JSDoc on every hot
  path. But it is heavier than necessary, so a trim pass is the first follow-up below.

## Security re-check findings: fix now or backlog?
- Findings 1-3 (hostile chunk byteLength, exotic-Proxy rollback, "no config value in any log" vs L-UNRESOLVED
  names): edge-case or terminology wording only, no runtime effect, and the terms used are those of the contract
  and ADR-0008. Backlog.
- Line 394 "The only phase that throws": a real internal contradiction with the mergeConfig JSDoc 120 lines below.
  The same is true of the mergeConfig wording "as does a target whose getter throws": a throwing getter propagates
  its own error, not a TypeError. Both are comment-only and low.
- Decision: not a gate failure. None is a correctness bug, an AC miss or a contract mismatch. Rework 1 showed that
  comment reworks carry their own risk: they introduced the unwrapped lines. Bundle all of them with the trim pass
  as ONE comment-only follow-up item, re-proved with compare-plugin-shape. Recommend priority 2, so it is the
  next cycle.

## Files changed
- `factory/runs/cycle-0026/05-review.md` - this report (only file written; scratch copy and harness live in the session scratchpad).

## Verification
- `bash scripts/ci.sh` -> exit 0: lint `check-fr11: PASS`, typecheck clean, tests 724 / pass 714 / fail 0 /
  skipped 10, `check-lf: PASS`, `check-docs: PASS (37 markdown files checked)`, `ci: PASS`.
- `node backend/tools/compare-plugin-shape.mjs --base-ref v0.16.1` -> 200/200 statements, declarations 195
  identical, exports 10 identical, `__internals` keys 6 identical, statement multiset identical, PASS (exit 0).
- Byte-exact sorted non-comment line multiset, v0.16.1 vs HEAD: 1209 = 1209, diff empty.
- Mutation harness (scratch, git archive): 23/23 layout mutations killed; compare tool 12/12 code mutations
  FAIL and 3/3 comment/move mutations PASS.
- Synthetic blind-spot probe of the compare tool: PASS on a semantic change (finding 7).
- `node backend/tools/compare-plugin-shape.mjs --base-ref does-not-exist-ref` -> SKIP, exit 0. This confirms the
  security finding 6 fail-open.
- `git diff main...HEAD --name-status -- backend frontend scripts .github` -> M plugin, A x3 only.

## Findings / issues
| # | Severity | File:line | Finding | Required fix | Owner |
|---|----------|-----------|---------|--------------|-------|
| 1 | low | backend/plugin/azdo-remote-config.ts:394 | Kept `//` comment "Phase 1 ... The only phase that throws." contradicts the corrected mergeConfig JSDoc (:515): phase 2 throws when the target rejects a write. | Backlog (comment-only): "Phase 1 throws on over-deep or cyclic input; phase 2 throws only when the target rejects a write." | backend |
| 2 | low | azdo-remote-config.ts:515 | "a frozen target gives a TypeError, as does a target whose getter throws": the getter's own error propagates, not a TypeError. | Backlog: "... a TypeError for a frozen target, or the getter's own error". | backend |
| 3 | low | azdo-remote-config.ts:1223-1224 | Security re-check #1: "nothing beyond the 1 MiB cap is accumulated" assumes an honest byteLength. | Backlog: qualify "for genuine chunks (the cap trusts byteLength)". | backend |
| 4 | low | azdo-remote-config.ts:490, :1889 | Security re-check #2: "unchanged or fully merged" holds for ordinary objects only (rollback is best-effort). | Backlog: qualify "for ordinary objects". | backend |
| 5 | low | azdo-remote-config.ts:1889 | Security re-check #3: "no ... config value appears in any log" vs the sanitised placeholder names logged by L-UNRESOLVED. | Backlog: append "other than the sanitised placeholder names of L-UNRESOLVED". | backend |
| 6 | low | azdo-remote-config.ts:326, :489, :515, :1889 | Rework-1 edits left 133-217 character run-on comment lines, unlike the ~110-column wrapping elsewhere. | Backlog: re-wrap in the same comment-only pass. | backend |
| 7 | low | backend/tools/compare-plugin-shape.mjs:121-128; ADR-0021 Consequences | The tokenizer emits single-char punctuators, so a semantic change can pass (probe: `a + ++b` -> `a++ + b`, `--a` -> `- -a`, both PASS). The ADR claim "whitespace between tokens has no runtime meaning in this file" is not true for adjacent `+`/`-`. No effect on this cycle: the byte-exact line-multiset check shows no intra-line change. | Backlog: tokenize `++`, `--` (and other multi-char operators) as single tokens or record whitespace between adjacent punctuators; add the two probes as negative controls; architect corrects the ADR-0021 sentence. | backend (tool), architect (ADR) |
| 8 | info | compare-plugin-shape.mjs:264-273 | Carried security #6: any `git show` failure (including a typo in the ref) gives SKIP, exit 0. | Backlog (already listed by security). | backend |
| 9 | info | azdo-remote-config.ts (35 JSDoc blocks) | JSDoc is about 488 lines: `Codes: none.` x16, repeated fetch code lists, `@param deadline` x6. | Backlog trim pass (about 80-120 lines). | backend |
| 10 | info | compare-plugin-shape.mjs:228 | Output reads `statements: multiset of: 200 identical`; the spec says `statements: multiset of 200 identical`. | Cosmetic; fix with finding 7. | backend |
| 11 | info | docs/architecture/ADR-0007:2, ADR-0008:2 | Status lines do not mention the ADR-0021 amendment (ADR-0001's does); the inline notes in sections 12 / 8 are present and correct. | Optional: add "section 12 / 8 amended by ADR-0021". | architect |
| 12 | info | backend/test/plugin/source-layout.test.ts:245 | The AC-3 negative-control test asserts `length === 0` on a mutated copy of the real SOURCE. Any real AC-3 problem therefore also fails the negative-control test (noisy but not wrong). | Optional: assert only on the injected block's problems. | backend |

No critical, high or medium findings. No correctness bug, AC gap, contract mismatch or weakened test.

## Assumptions made (no human available)
- I read comment inaccuracies limited to hostile or exotic inputs as documentation quality, not as an AC-2
  correctness failure. The ACs require purpose, `Invariants:` and `@see`, and all of those are present and checked.
  This follows the security re-check precedent.
- The compare-tool blind spot (finding 7) does not fail the gate: it is a dev-only manual tool, and its conclusion
  for this diff was confirmed by two independent methods (the security reviewer's TypeScript-scanner token multiset
  and my byte-exact line multiset).

## Follow-ups for the backlog
- T-038 (suggested priority 2, backend, comment-only, zero behaviour change, re-prove with compare-plugin-shape):
  JSDoc polish and trim. Fix findings 1-6, then trim per finding 9 and the readability assessment. Target: -80 to
  -120 lines.
- Tool hardening (priority 4, backend + architect): findings 7, 8, 10. Multi-char operator tokens; SKIP only when
  git is missing, and exit 2 for an unknown ref.
- Optional: findings 11, 12.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0026/05-review.md
summary: T-037 passes: ci.sh green (714/0/10), compare tool PASS vs v0.16.1 plus byte-exact code-line multiset identical, 23/23 layout mutations killed; 7 low + 5 info follow-ups (comment polish/trim, tokenizer ++/-- blind spot), none blocking.
