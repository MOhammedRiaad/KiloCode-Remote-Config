# Security report — cycle 0019 — T-013: Bind cache to the settings that produced it

## Inputs read
- `git diff main...HEAD` (16 files; product code: `backend/plugin/azdo-remote-config.ts`; tests:
  `backend/test/plugin/hook.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`,
  `backend/test/e2e/helpers.ts`, `backend/test/e2e/startup.test.ts`; docs/architecture changes)
- `factory/runs/cycle-0019/02-architect.md` (security notes), ADR-0018, ADR-0009 section 3 amendment
- Surrounding plugin code: `parseJsonc`, `isPlainObject`, `sanitizeNode`/`sanitizeShared`, `readOwn`,
  `validateShared`, `exceedsDepth`, `cacheLocation`, `selectFs`, `writeCache`, `readCache`, `executeHook`,
  `performRequest`/`extractContent`

## Work done
Manual review of the diff against the checklist plus a throwaway fuzz/sentinel harness
(scratchpad only, not committed) that drives `__internals.runConfigHook` with real fs in temp homes.

1. **Secrets in diff**: none. Test sentinels only (`PAT`, `TOKEN` constants in tests).
2. **Binding construction**: `cacheBindingOf` (azdo-remote-config.ts:1175) destructures exactly the five
   fields and returns a fresh literal; `bindingCopy` (1217) does the same at write time. No spread,
   no `JSON.stringify(settings)`. `pat` (non-enumerable) / `mode` / `timeoutMs` cannot reach the file.
3. **Credential sentinels in cache bytes**: ran a success fetch with each of `pat` option, `AZDO_PAT`,
   `KILO_AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT` and an az token, with `timeoutMs: 4321`, `mode: "enforce"`, and
   the fetched content itself carrying `"apiKey": <PAT>`. Confirmed an Authorization header was sent in
   every case; cache file contained none of PAT, az token, Basic base64, `Bearer`, `Basic`, `4321`,
   `enforce`, `timeoutMs`, `"pat"`; logs contained none either. Cache = `{format, binding(5 strings), config:{model}}`.
4. **Envelope checks (checkCacheEnvelope, 1199)**: parse in try -> plain-object root -> own `format`
   `===` constant -> exact root key set -> binding plain object, exact 5 own keys, all `typeof string`
   -> config plain object and depth < 64 -> field-by-field `readOwn(...) === current[key]`. Shape strictly
   precedes comparison; `readOwn` never invokes getters; `JSON.parse` makes `__proto__` an own key so it
   counts as an extra key. Fuzz results (each: not applied, no throw, exactly one L-NONE line, cache
   bytes unchanged):
   - `__proto__` wrapping binding / extra `__proto__` in binding / binding array / number / array / object
     values / `{"toString":..}` value / config array / config null / extra root key / root array /
     truncated / empty / depth-64 config / 500k-deep array bomb in config -> `cache-invalid`
   - `__proto__` root wrapping format / format array / format with trailing space -> `cache-outdated`
   - case-different org / trailing NUL / 1 MB org string / duplicate `binding` key (last wins) -> `cache-mismatch`
   - envelope over 2 MiB -> `cache-unreadable` (cap is on the whole file)
   - depth-63 config -> applied (boundary correct)
5. **Cache poisoning, same settings** (trust boundary per ADR-0009 section 3, now documented there):
   hand-written valid envelope whose config carries top-level and nested `apiKey`, `__proto__`,
   `constructor.prototype`, `plugin`, `$schema`: merged result `{"model":"x","provider":{"p":{"options":{}}}}`,
   no `apiKey`, no `plugin`/`$schema`, `Object.prototype` not polluted. Content validation and
   sanitisation still apply to cached content in full (`applyShared` -> `sanitizeShared`). Accepted risk.
6. **Missing-settings path**: returns before `acquireRemote`, `deps.homedir`, `readCache`; hook test spy fs
   records zero calls; no fetch, no az. Behaviour change (never uses cache) is the PO decision.
7. **Logs**: only fixed codes (`cache-mismatch`, `cache-outdated`, `cache-skipped`); no field name, no
   stored or current value (tests assert none of 10 distinctive values appear; e2e asserts no `release`/`acme`).
8. **TOCTOU / symlinks**: stat -> size cap -> read sequence and write mechanics (mkdir 0700, `wx` 0600 temp,
   rename, guarded unlink) unchanged by this diff. Symlink creation not permitted on this Windows host
   (EPERM), so the symlink leg was not exercised; code path is byte-identical to main.
9. **FR-11**: no import/export lines changed; `__internals` keys unchanged (6); `check-fr11: PASS`.
10. **Dependencies**: zero runtime deps.

## Files changed
- `factory/runs/cycle-0019/04-security.md` — this report (no source modified).

## Verification
- `bash scripts/ci.sh` -> exit 0 (lint `check-fr11: PASS`, typecheck clean, 607 tests: 602 pass, 0 fail,
  5 platform skips pre-existing; `check-docs: PASS`). All `T013 *`, `T3b`, smoke default-wiring tests pass.
- `npm audit --omit=dev --audit-level=high` (backend) -> 0 vulnerabilities; full `npm audit` -> 0.
- Scratchpad fuzz/sentinel harness -> `ALL OK` (0 failures).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/plugin/azdo-remote-config.ts:1207 | A root with `__proto__` (own key) wrapping `format` yields `cache-outdated` rather than `cache-invalid` because the format check precedes the key-set check (by design, 2f-C order). Fail-closed either way; only the diagnostic code differs. | None. |
| 2 | info | backend/plugin/azdo-remote-config.ts:1254-1256 | Pre-existing, unchanged: stat/read TOCTOU (file can grow between `statSync` size check and `readFileSync`). Only exploitable by someone who can already write the 0700 cache dir, which is outside the trust boundary (ADR-0009 s.3). | None this cycle. |
| 3 | info | ADR-0009 s.3 / ADR-0018 | Binding is not an integrity control; a local writer of `~/.cache/kilo-azdo` can forge a matching envelope. Accepted and documented; forged content is still validated and sanitised (verified). | None. |

## Assumptions made (no human available)
- Symlink handling not re-tested live (Windows EPERM); accepted because the stat/read/write code is unchanged from main and was reviewed in earlier cycles.
- Missing settings no longer falling back to cache is intentional per PO (cycle 0019) and is a stricter (safer) behaviour.

## Follow-ups for the backlog
- None required. Optional: read the cache via a single fd (`openSync` + `fstatSync` + bounded read) to close the pre-existing stat/read TOCTOU (low value given the trust boundary).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0019/04-security.md
summary: T-013 cache binding is built field-by-field, carries no credentials (5 sources + apiKey sentinel verified), fails closed on every malformed/legacy/mismatched envelope (fuzzed), missing settings make zero fs calls; ci.sh exit 0, npm audit 0; only info findings.
