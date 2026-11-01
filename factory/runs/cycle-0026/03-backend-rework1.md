# Backend rework 1 (cycle 0026, T-037)

status: PASS

Comment-only edits in backend/plugin/azdo-remote-config.ts (no code, name, signature, export or test change).

## Fixes
| # | Location | Change |
|---|----------|--------|
| 1 | readCappedBody, handleResponse JSDoc | No longer "never throws". readCappedBody: does not throw for real fetch chunks; instanceof and byteLength on a hostile chunk are unguarded and map to network via fetchRemoteConfig. handleResponse: status, headers, body.getReader, cancel reads guarded; a hostile chunk throw passes up to fetchRemoteConfig (network). |
| 2 | runConfigHook JSDoc | "an unexpected throw from executeHook is caught and logged as LOG_UNEXPECTED; every failure leaves the config unchanged or fully merged". |
| 3 | mergeConfig JSDoc | Throws for over-deep or cyclic shared input AND when the target rejects a write (frozen target TypeError, throwing getter). |

## Re-verification of every "never throws" / "does not throw" claim
- parseJsonc (l.190): documented as THROWS; TypeError at l.198, Errors at l.209, 214, 228. Correct.
- resolvePlaceholders (l.326): OVERSTATED ("Throws only when nested 64 deep"). Input[key] reads (l.306), Object.keys (l.305) and hasOwnProperty on an injected env (l.285) are unguarded, so hostile objects can throw. Reworded: for parsed JSON input only the depth throw; hostile objects or injected env can also throw.
- applyShared (l.486): OVERSTATED. isPlainObject (l.98-101, Object.getPrototypeOf) runs before the try (l.493); a hostile Proxy can throw. Reworded; merge inside try (l.495-500) and rollback steps each guarded (l.468-473) kept.
- mergeConfig: fixed (finding 3).
- resolveSettings (l.706): OK. readOwn/isRecordLike guarded (l.80-96); checks operate on strings/numbers after typeof guards (l.605-663); selectEnv uses guarded reads (l.691-695).
- codeForInterrupted (l.906): OK, reads a boolean closure and a string field.
- findPat (l.965): OK, guarded readOwn, usablePat typeof-guarded (l.952-956).
- basicHeader (l.983): OK; input is visible ASCII only (usablePat), Buffer.from of a string cannot throw.
- azAuthorization (l.1026): OK; resolveRunner guarded reads; runner raced via settle (l.886-890) which converts sync throw and rejection to failed; bearerFrom uses guarded reads and string ops on a checked string (l.1008-1015).
- readContentType (l.1137): OK, attempt-wrapped (l.1142).
- isJsonMediaType (l.1155): OK, string-only ops.
- readCappedBody, handleResponse: fixed (finding 1). Reads of done/value (l.1234-1235), reader.read (race) and cancel (discard) are guarded; l.1236, 1240 are not.
- extractContent (l.1256): OK; decode and JSON.parse in attempt (l.1261-1262), readOwn and isRecordLike guarded.
- fetchRemoteConfig (l.1382): OK; whole runFetch awaited inside try/catch (l.1389-1393), which also covers synchronous throws in the async function.
- validateShared (l.1415): OK; parseJsonc in try (l.1421-1426); isPlainObject and exceedsDepth see plain JSON data, recursion capped at 64.
- cacheBindingOf (l.1519): OK; typed settings from resolveSettings, destructure and typeof only.
- checkCacheEnvelope (l.1554): OK; parse in try, remaining reads use readOwn on JSON data.
- writeCache (l.1593): OK; cacheLocation and selectFs guarded, all other work inside try (l.1610-1623), removeTemp guarded.
- readCache (l.1635): OK; stat/read inside try, error code read through attempt (l.1650).
- makeLogger (l.1682): OK; property reads in try (l.1690-1695), call and thenable handling in try (l.1699-1705).
- hintFor (l.1716): OK, string comparisons.
- logHint (l.1737): OK given the guarded logger; hintFor pure.
- acquireRemote (l.1793): OK; fetchRemoteConfig never rejects, validateShared never throws, pickDeps/readOwn-free plain loops.
- executeHook "may reject only when a collaborator throws unexpectedly": accurate.
- runConfigHook: fixed (finding 2); never rejects confirmed: readHookDeps and makeLogger inside or guarded, catch logs through guarded logger.
- AzdoRemoteConfig (l.1930): hook never rejects confirmed via runConfigHook.
- File header l.6 "It never throws or rejects" refers to the config hook; accurate.
Other Invariants lines (ordering, constants, log placement, cache modes, AZ args, error code tables) were re-read against code in the same pass; no further discrepancy found.

## Verification (all run after the edits)
- `node backend/tools/compare-plugin-shape.mjs --base-ref v0.16.1`: base 200 statements, head 200; declarations 195 identical; exports 10 identical; __internals keys 6 identical; statements multiset 200 identical; PASS.
- `npm run lint` (backend): check-fr11: PASS.
- `npm run typecheck` (backend): clean.
- `npm test` (backend): tests 724, pass 714, fail 0, skipped 10.
- `node backend/tools/check-docs.mjs`: PASS (37 markdown files checked).
- `bash scripts/ci.sh`: check-lf PASS, check-docs PASS, ci: PASS.
- ASCII check: no non-ASCII bytes. git status: only backend/plugin/azdo-remote-config.ts modified (plus this report).
