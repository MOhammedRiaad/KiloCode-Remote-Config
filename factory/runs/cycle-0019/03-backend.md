# Backend report - cycle 0019 - T-013: Bind cache to the settings that produced it

## Work done
- `backend/plugin/azdo-remote-config.ts` (B1): module-local `CacheBinding`, `CACHE_FORMAT`, `cacheBindingOf` (field by field),
  envelope `{format, binding, config}` written by `writeCache(shared, binding, home, fs)`; `readCache(binding, home, fs)` checks in
  order: parse/plain root (cache-invalid), own `format` (cache-outdated), exact root keys, exact string binding, config plain
  object and depth (cache-invalid), then field-by-field `===` (cache-mismatch). `executeHook`: missing settings log L-MISSING
  then L-NONE `(missing-settings) ... (cache-skipped)` and return before any fetch, az or fs call. No new export or
  `__internals` key; no new import.
- Tests (B2-B5): `hook.test.ts` (seedBoundCache helper, AC2 envelope assertions, AC3/AC5/AC7 seeds, old AC5 missing-settings test
  replaced, new `T013 ACn` tests), smoke test (cache-skipped, legacy file bytes unchanged), e2e `helpers.ts`
  (`DEFAULT_BINDING`, envelope `expectedCache`) and `startup.test.ts` (new T3b).

## Acceptance criteria -> tests
| AC | Test |
|----|------|
| AC-1 mismatch per field not applied, no leak, file untouched | `T013 AC1 a cache written for other settings is not applied, one field at a time` |
| AC-2 same settings applied; mode not bound | `T013 AC2 ...`; `AC3 <code> falls back to the cache`; e2e T3 |
| AC-3 no credential in bytes (pat option, AZDO_PAT, KILO_AZDO_PAT, AZURE_DEVOPS_EXT_PAT, az token) | `T013 AC3 the cache bytes hold no credential (...)` x5; `AC2 success writes ...` |
| AC-4 legacy/malformed/outdated fail closed, shape before compare, depth boundary, rewrite | `T013 AC4 ...` (outdated x5, invalid x13, level 63 applied, legacy rewritten) |
| AC-5 missing settings never use cache, no fs calls | `T013 AC5 missing <x> skips fetch, az and the cache entirely` x4; smoke default-wiring test |
| AC-6 comparison rule pins | `T013 AC6 comparison uses normalised settings ...` |
| AC-7 e2e | e2e T3 (same settings) and `T3b T-013: a cache from another branch is not applied`; T1/T2 envelope |

## Verification
- `bash scripts/ci.sh` -> exit 0 (lint check-fr11 PASS, typecheck clean, tests 607: pass 602, fail 0, skipped 5 pre-existing, docs check passes).

## Findings / issues
None. Note: working-copy files were CRLF (git autocrlf); edited files are now LF, index is LF.

## Assumptions
- Depth boundary: container at level 64 measured from `config` is invalid; containers down to level 63 are accepted.
- The `Settings` binding type check (all five strings) is retained in `cacheBindingOf` as the architect specified.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0019/03-backend.md
summary: T-013 cache envelope bound to org/project/repo/path/branch implemented with tests; ci.sh exits 0
