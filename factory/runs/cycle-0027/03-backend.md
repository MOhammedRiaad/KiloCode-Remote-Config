# Backend report - cycle 0027 - T-038 (comment-only JSDoc trim and wording fixes)

## Work done
Only `backend/plugin/azdo-remote-config.ts` changed (comments only). 1939 -> 1837 lines.
- Deleted all 16 `Codes: none` lines (including the qualified `none directly` / `none (...)` forms; their
  meaning was folded into `@returns` where needed).
- Full fetch error-code list now only in the `fetchRemoteConfig` block; handleResponse, performRequest,
  runFetch, readCappedBody and acquireRemote refer to `contracts/plugin-interface.md section 2e`.
- All `@param deadline` lines dropped (six); a few redundant one-param `@param` lines dropped; the blank
  ` *` line after each purpose sentence removed (the layout test filters blank lines).
- Every comment line is <= 110 chars (longest 110).
- Wording fixes, each checked against the current code:
  (a) Phase 1 comment now says it throws on over-deep input (sanitizeNode throws only tooDeep; mergeInto can throw too).
  (b) mergeConfig: a throwing target getter propagates its own error, not a TypeError (mergeInto reads target[key]); a frozen target still gives a TypeError (defineProperty).
  (c) readCappedBody: cap is checked on the running total of `chunk.byteLength`, trusted as the chunk size.
  (d) applyShared and (e) runConfigHook: "for ordinary objects" and "best-effort" (rollback uses Reflect.defineProperty/deleteProperty, which can fail silently).
  (f) runConfigHook: the only config-derived log text is the sanitised placeholder NAMES of L-UNRESOLVED (cleanName/listNames), never values.

## Acceptance criteria and proof
| AC | Proof |
|----|-------|
| 1 compare PASS | `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` -> declarations 195, exports 10, __internals 6, statements 200 identical, PASS |
| 2 single file | `git diff --name-only v0.16.2 -- backend` lists only the plugin file; test/tools/docs untouched |
| 3 tests/ci | `npm test` 724 tests, 714 pass, 0 fail, 10 skipped (pre-existing); source-layout.test.ts 8/8; `bash scripts/ci.sh` PASS |
| 4 size | `wc -l` = 1837 (<= 1839); longest comment line 110 |
| 5 trim | `grep -c '^ \* Codes: none'` = 0; full list only in fetchRemoteConfig; other blocks cite section 2e |
| 6 wording | `grep -c "The only phase that throws"` = 0; mergeConfig states the getter's own error propagates |
| 7 wording | byteLength, "ordinary objects", "best-effort", L-UNRESOLVED NAMES present |

## Verification
- typecheck: `tsc --noEmit` clean; lint: check-fr11 PASS; check-docs PASS (37 files); check-lf PASS.
- ASCII only; no `/*` or `*/` inside JSDoc bodies (source-layout comment-safety test passes); index stays LF
  (`git ls-files --eol`: i/lf).

## Notes
- Size target was reached with ~1837, not the ~1800 aim; the slack to 1839 is 2 lines.
- ADR-0021 point 3 asks for `@param` per parameter; dropping `@param deadline` and a few trivial params follows the
  item text ("shorten or drop"). The layout test does not check them.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/03-backend.md
summary: plugin comments trimmed 1939 -> 1837 lines, six wording fixes, compare PASS, all tests and ci green
