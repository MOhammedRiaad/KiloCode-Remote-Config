# Security report (Re-check 1) - cycle 0026 - T-037: organise the single plugin file (TOC, numbered sections, hot-path JSDoc)

## Inputs read
- `git show HEAD` (a33d7ac, rework 1), `git diff main...HEAD`, `git status` (clean).
- `factory/runs/cycle-0026/04-security.md` (first pass, FAIL: findings 1-4), `03-backend-rework1.md`, `02-architect.md`.
- `docs/architecture/ADR-0021-plugin-source-layout-and-hot-path-jsdoc.md` section 3, `ADR-0008` message rule.
- `backend/plugin/azdo-remote-config.ts`: all 35 hot-path JSDoc blocks plus the helpers they describe.

## Work done
1. **Comment-only proof for the rework commit**
   - `git diff HEAD~1 HEAD` on the plugin, with JSDoc and comment lines filtered out, shows 0 changed lines.
   - Independent method: a TypeScript parser (5.9, `createSourceFile`) leaf-token walk that skips JSDoc subtrees.
     - HEAD~1 vs HEAD: 11321 = 11321 tokens, same sequence.
     - v0.16.1 vs HEAD: 11011 = 11011 code tokens, multiset identical (0 differing keys). The sequence differs only because the cycle reorders statements, which is expected.
     - The plugin is byte-identical between `main` and `v0.16.1`.
   - `node backend/tools/compare-plugin-shape.mjs --base-ref v0.16.1` gives PASS: 200/200 statements, 195 declarations, 10 exports, 6 `__internals` keys, statement multiset identical.
2. **Live re-test of every rewritten claim.** Probes ran on the real module and on a scratch copy that also exports `applyShared` and `readCappedBody`.
   - Chunk Proxy with a throwing `getPrototypeOf`: `fetchRemoteConfig` gives `network`. TRUE as now documented.
   - `Uint8Array` subclass with a throwing `byteLength` getter: `network`. TRUE.
   - `mergeConfig(Object.freeze({}), {a:1})` throws TypeError; a target with a throwing getter rethrows its Error. TRUE.
   - `applyShared` with a revoked Proxy throws TypeError; with a throwing `getPrototypeOf` trap it throws. TRUE.
     - Ordinary frozen target returns false.
     - A partial failure (nested frozen object) returns false and the target is restored. TRUE.
   - `resolvePlaceholders`:
     - injected env with a throwing `getOwnPropertyDescriptor` trap: throws;
     - input with a throwing getter: throws;
     - parsed JSON nested 70 deep: throws "nested too deeply".
     - TRUE as now documented.
   - `runConfigHook` with a config Proxy whose `getPrototypeOf` throws: resolves to `undefined` and logs exactly `error:` LOG_UNEXPECTED. TRUE.
3. **Second independent sweep.** I grepped every never/does-not-throw, unchanged, guarded, at most, exactly once, unread, no-secret and never-logged claim (about 45 hits). I checked each one against the code.
   - Re-verified as accurate: parseJsonc, resolveSettings, buildItemsUrl, startDeadline, codeForInterrupted, findPat, basicHeader, azAuthorization, defaultRunAz, readContentType, isJsonMediaType, codeForStatus, extractContent, handleResponse, performRequest, runFetch, fetchRemoteConfig, validateShared, cacheBindingOf, checkCacheEnvelope, writeCache, readCache, makeLogger, hintFor, logHint, acquireRemote, executeHook, runConfigHook's never-rejects claim, the `__internals` block and the file header.
   - Still overstated: three edge-case claims, listed as findings 1-3 below. All are low with no runtime impact.
4. **Hygiene**
   - No `/*` or `*/` inside any JSDoc block.
   - The plugin is ASCII only.
   - The rework commit touches only the plugin and its report. The only test files in the cycle diff are the two added (A) in the first pass. No existing test file was modified.

## Files changed
- `factory/runs/cycle-0026/04-security-rerun1.md`: this report (only file written).

## Verification
- `npm run lint`: `check-fr11: PASS`.
- `npm run typecheck`: clean.
- `bash scripts/ci.sh`: exit 0 (tests 724, pass 714, fail 0, skipped 10; check-lf PASS; check-docs PASS (37); `ci: PASS`).
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- Secrets grep on the added diff lines: none.
- Previous findings:
  - #1 (readCappedBody/handleResponse): FIXED, wording matches the probes.
  - #2 (runConfigHook LOG_UNEXPECTED): FIXED.
  - #3 (mergeConfig throw cases): FIXED.
  - #4 (compare-plugin-shape fail-open): unchanged, backlog as agreed.
  - The engineer's two extra corrections (applyShared, resolvePlaceholders) are accurate.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | `backend/plugin/azdo-remote-config.ts:1224-1225` | readCappedBody says "nothing beyond the 1 MiB cap is accumulated". This is false for a hostile injected chunk whose `byteLength` getter under-reports. Probe: 4 x 1 MiB `Uint8Array` subclass chunks reporting 1 byte each were all buffered, then `joinChunks` threw RangeError, which became `network`. A real fetch cannot produce this, and the result is still a failure, so there is no runtime impact. | Comment-only (backlog): "nothing beyond the 1 MiB cap is accumulated for genuine chunks (the cap trusts byteLength)". Optional hardening: read `chunk.length` through `attempt`. |
| 2 | low | `:490`, `:1889` | applyShared says "a failed merge leaves the config unchanged"; runConfigHook says "every failure leaves the config unchanged or fully merged". This is false for an exotic Proxy config that passes `isPlainObject`. Probe: a Proxy that rejects the 2nd define and throws on delete returned false, but key `a` stayed written. Kilo passes a plain object, so there is no impact. | Comment-only (backlog): qualify with "for ordinary objects (rollback steps are best-effort)". |
| 3 | low | `:1889` | runConfigHook says "no secret, URL, host or config value appears in any log". By design (ADR-0008 message rule, L-UNRESOLVED), sanitised placeholder names taken from shared-config strings are logged. Probe: `{env:SECRETISH_VALUE_abc123}` logged "Unresolved placeholders: env:SECRETISH_VALUE_abc123.". The behaviour is conformant; only the wording is absolute. | Comment-only (backlog): append "other than the sanitised placeholder names of L-UNRESOLVED". |
| 4 | info | `:394` | Pre-existing line comment "Phase 1 ... The only phase that throws." now contradicts the corrected mergeConfig JSDoc (phase 2 throws on a frozen target or throwing getter). | Comment-only (backlog): "Phase 1 throws on over-deep or cyclic input; phase 2 throws only when the target rejects a write." |
| 5 | info | `:1635`, `:253` | "the file must be a regular file of at most 2 MiB" (readCache) and the readGuardedFile rule are stat-then-read by path (TOCTOU). The cache dir is a 0o700 user-home dir, so an attacker would need user-level access. Pre-existing behaviour. | None this cycle. |
| 6 | info | `backend/tools/compare-plugin-shape.mjs:271-281` | Carried from first pass #4: any `git show` failure exits 0 with SKIP. | Backlog (unchanged). |

## Assumptions made (no human available)
- Findings 1-3 are rated low, not medium, following the first-pass precedent. Medium was reserved for an explicit "even for hostile response objects" robustness promise that a maintainer could use to justify removing a guard. These three cannot remove any guard, have no runtime or data impact, and two of them (2, 3) reflect contract-sanctioned wording (ADR-0021 example text, ADR-0008). So they are backlog items and do not fail the gate.
- The "no test file modified" check is read as "no pre-existing test changed". The two cycle test files are new additions that were reviewed in the first pass.

## Follow-ups for the backlog
- One comment-only polish pass on findings 1-4 (same JSDoc blocks, no code).
- Optional hardening: guard `instanceof` / byteLength in readCappedBody so hostile chunks yield `bad-response` (from first pass).
- compare-plugin-shape: distinguish "git missing" (SKIP) from "ref not found" (exit 2) (finding 6).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0026/04-security-rerun1.md
summary: Rework 1 is comment-only (token-identical, shape PASS), all rewritten claims verified live; 3 low + 3 info wording follow-ups, no high/critical; ci/lint/audit green.
