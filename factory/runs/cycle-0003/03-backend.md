# Senior BE report — cycle 0003 — F-001: Plugin: JSONC parser

## Inputs read
- ADR-0003, ADR-0002, backlog F-001, check-fr11.mjs, existing smoke test.

## Work done
- BE-1/BE-2: module-local `parseJsonc` (single linear scanner, helper functions `stringEnd`, `commentEnd`, `closesContainer`, `blank`, `locate`) in `backend/plugin/azdo-remote-config.ts`; exposed only as `export const __internals = { parseJsonc };`. Comments become spaces keeping CR/LF; trailing commas blanked; BOM replaced by a space; errors are fixed text plus line/column, JSON.parse failure replaced by `Invalid JSONC: malformed JSON` (no cause); non-string -> TypeError. No imports; no slash-star / star-slash sequences in code (chars compared individually).
- BE-3: new `backend/test/plugin/jsonc.test.ts`; smoke test extended.
- BE-4: CI green.

## Files changed
- `backend/plugin/azdo-remote-config.ts` — parser + `__internals`. Converted file from CRLF to LF (task required LF-only).
- `backend/test/plugin/jsonc.test.ts` — new.
- `backend/test/plugin/azdo-remote-config.smoke.test.ts` — asserts `parseJsonc` is a function, `__internals` keys are exactly `["parseJsonc"]`.

## Verification
- `bash scripts/ci.sh` -> exit 0; lint `check-fr11: PASS`; typecheck clean; 30 tests pass, 0 fail.

Acceptance criteria -> tests (all in `backend/test/plugin/jsonc.test.ts`):
- AC-1 comments (incl. multi-line, EOF without newline): "AC-1: line and block comments..."
- AC-2 trailing commas: "AC-2: trailing commas, nested..."
- AC-3 strings with URL / comment-like / `,}`: "AC-3: ..."
- AC-4 escaped quotes / backslash before `//`: "AC-4: ..."
- AC-5 errors: unterminated string, unterminated block comment, malformed JSON, canary test (`SECRET-CANARY-42` absent, cause undefined), non-string TypeError
- AC-6 Appendix A: "AC-6: VISION Appendix A example parses"
- AC-7 CI/FR-11: `bash scripts/ci.sh` exit 0; no `dependencies`, no new devDependencies.
- Extras: BOM, CRLF/lone CR, CRLF line counting in errors, strict JSON equals JSON.parse, `[1,,2]` stays invalid.

## Findings / issues
None. Tests contain no realistic keys or PATs.

## Assumptions made (no human available)
- BOM replaced by a space (keeps offsets 1:1) rather than removed.
- A lone CR counts as a line break for error positions; CRLF counts as one.
- Lookahead for trailing commas treats an unterminated block comment as "not a closer"; the main pass then raises the unterminated-comment error.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0003/03-backend.md
summary: parseJsonc implemented and exposed via __internals; 30 tests pass; ci.sh exit 0
