# Docs report — cycle 0026 — T-037: plugin file sections, TOC and hot-path JSDoc

## Inputs read
- ADR-0021, `docs/development.md`, `docs/api.md` and `README.md` (grep for layout or line counts).

## Work done
- Added a "Plugin source layout" section to `docs/development.md`: the 15 sections, TOC and banner formats, the one-file rule, how to add a function, the hot-path JSDoc template and rules, the layout test, and the manual compare tool.
- Added the compare tool to the Layout list.

## Files changed
- `docs/development.md` — new section and layout line.
- `docs/api.md`, `README.md` — unchanged (no plugin layout or line counts listed).

## Verification
- `node backend/tools/check-docs.mjs` -> PASS (37 files).
- `node backend/tools/compare-plugin-shape.mjs --base-ref HEAD` -> PASS (confirms the documented command exists).
- The three documented files exist.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- README has no layout description, so it was left alone.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0026/07-docs.md
summary: development.md documents plugin source layout, JSDoc rules and compare tool
