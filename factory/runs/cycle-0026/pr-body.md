## Summary
Organises the single plugin file (user chose option A: keep ONE file, FR-11 unchanged) into 15 numbered sections with a table of contents and co-located helpers, and adds JSDoc to 35 hot paths. Zero behaviour change.

Zero behaviour change is proven three independent ways:
1. `backend/tools/compare-plugin-shape.mjs` vs v0.16.1: 200 statements / 195 declarations / 10 exports / 6 `__internals` keys identical.
2. Security's TypeScript-parser token multiset comparison: identical.
3. Reviewer's byte-exact sorted non-comment-line multiset: 1209 lines identical.

Honest size note: the file GREW from 1456 to about 1939 lines (about 488 lines of JSDoc). A trim pass plus 6 comment wording fixes are queued as T-038 (priority 1, next cycle). ADR-0021 permits `/** */` JSDoc blocks in the plugin (the ADR-0007/0008 block-comment ban is relaxed for JSDoc blocks only; the lint comment stripper is still exact).

New files: `backend/tools/compare-plugin-shape.mjs` (manual dev tool, not in CI), `backend/test/tools/compare-plugin-shape.test.ts`, `backend/test/plugin/source-layout.test.ts` (permanent).

## Backlog item
- **ID / title:** T-037 - Organise the single plugin file (TOC, numbered section banners, co-located helpers) and JSDoc every hot path
- **Type:** refactor (user-sourced, priority 1, backend only)
- **Factory cycle:** `factory/runs/cycle-0026/`

## Acceptance criteria
See `factory/backlog.json` (T-037) for the full list.
- [x] Layout: 15 numbered sections + TOC - test: `backend/test/plugin/source-layout.test.ts` (23/23 mutations killed)
- [x] JSDoc on hot paths - test: `source-layout.test.ts`
- [x] Zero behaviour change - test: `backend/test/tools/compare-plugin-shape.test.ts` (12/12 code-change mutations killed) plus existing suite

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | FAIL on first pass (false "never throws" JSDoc claims); fixed in rework 1 (comment-only, 5 claims corrected); re-check PASS | `04-security.md`, `04-security-rerun1.md` |
| Code review | PASS | `05-review.md` |
| Local CI (`scripts/ci.sh`) | Run by CI releaser | |

## Risk & rollback
Low: comment and ordering only, shape-equivalence verified. Revert with a single revert commit. Risk: file size increase (see above), addressed by T-038.

## How to verify
- `bash scripts/ci.sh`
- `node backend/tools/compare-plugin-shape.mjs` against v0.16.1 (manual)
