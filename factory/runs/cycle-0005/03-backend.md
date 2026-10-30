# Backend report - cycle 0005 - F-003

Status: PASS

## Changes
- backend/plugin/azdo-remote-config.ts: section "Config merge (ADR-0005)" (MAX_MERGE_DEPTH, isPlainObject, isApiKeyName, isPrototypeKey, sanitizeNode/sanitizeShared, containsApiKey, defineOwn, mergeInto, mergeConfig); `__internals = { parseJsonc, resolvePlaceholders, mergeConfig }`; header comment updated. No new imports or exports.
- backend/test/plugin/merge.test.ts (new), backend/test/plugin/azdo-remote-config.smoke.test.ts (updated keys).

## Acceptance criteria -> tests (merge.test.ts)
- AC-1: "defaults mode: local wins..." and "enforce mode: shared wins..."
- AC-2: "nested conflict resolves per mode"
- AC-3: "shared apiKey never replaces...", "shared apiKey is not added...", plus case/array/new-subtree/enforce-exception tests
- AC-4: "local keys absent from shared are unchanged in both modes"
- AC-5: "top-level $schema and plugin are ignored...", "nested keys named plugin..."
- AC-6: "target reference and nested references are kept...", "mutating shared after the merge..."
- AC-7: "arrays are replaced wholesale", "type conflicts resolve by mode", "unrecognised modes behave as defaults"
- AC-8: "prototype keys from JSON.parse are skipped...", "prototype keys do not touch own keys of the target", null-prototype test; depth 64/65, cyclic shared, target-unchanged, deep/cyclic local under enforce, non-object inputs, undefined values, non-JSON values, key order. Export surface: smoke test "no named export is a function...".

## Verification
- `bash scripts/ci.sh` -> exit 0 (check-lf PASS, ci PASS; all tests pass, 1 pre-existing skip).
- Plugin file: no non-ASCII bytes; no CR bytes (converted to LF; git index already LF); no slash-star/star-slash added by this change (git diff of added lines: 0 matches). Pre-existing JSDoc comments in the file (lines 10-372) contain slash-star and were left untouched.
- No dependencies added to backend/package.json.

## Assumptions
- Working tree used CRLF via autocrlf; I normalised the three files I touched to LF.
- The "never slash-star" rule was applied to new code only because pre-existing JSDoc already uses it.
