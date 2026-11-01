## Summary
Binds the remote-config cache (`~/.cache/kilo-azdo/remote-config.json`) to the settings that produced it. The cache is now an envelope `{format, binding, config}` where binding is the non-secret org/project/repo/path/branch. On fetch failure the cache is applied only on an exact match; any mismatch, legacy or malformed file fails closed with a fixed log reason and no settings values. No PAT or token is ever written to the cache.

Notes for reviewers:
1. Behaviour change: missing org/project/repo no longer falls back to the cache (no binding can be verified). Intentional, per the PO.
2. Upgrade cost: existing (legacy) caches become unusable once (`cache-outdated`) until the first successful fetch rewrites them in the new format.
3. Plugin contract 0.7.0 -> 0.8.0, see ADR-0018 (`docs/architecture/ADR-0018-cache-settings-binding.md`).
4. The binding is NOT an integrity check. Cache poisoning by someone with write access to `~/.cache` remains an accepted risk (ADR-0009 section 3).

## Backlog item
- **ID / title:** T-013 - Bind cache to the settings that produced it
- **Type:** security (backend only)
- **Factory cycle:** `factory/runs/cycle-0019/`

## Acceptance criteria
- [x] AC1 mismatch in any one field not applied, no leak - `T013 AC1 a cache written for other settings is not applied, one field at a time`
- [x] AC2 same settings applied as before - `T013 AC2 ...`, `AC3 <code> falls back to the cache`, e2e T3
- [x] AC3 no credential in cache bytes - `T013 AC3 the cache bytes hold no credential (...)` x5
- [x] AC4 legacy/malformed fail closed, rewritten on next success - `T013 AC4 ...`
- [x] AC5 missing settings never use cache - `T013 AC5 missing <x> skips fetch, az and the cache entirely` x4
- [x] AC6 comparison rule (normalised by resolveSettings) pinned - `T013 AC6 comparison uses normalised settings ...`
- [x] AC7 ci.sh green, FR-11 intact, e2e fallback passes - e2e T3, `T3b T-013: a cache from another branch is not applied`

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (fuzzed, info findings only) | `04-security.md` |
| Code review | PASS (10/10 non-equivalent mutants killed) | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS, exit 0 (607 tests, 602 pass, 0 fail, 5 pre-existing skips) | `03-backend.md` |

## Risk & rollback
- Risk: one-time cache invalidation on upgrade; offline first run after upgrade gets no cached config. Missing-settings runs no longer fall back to the cache.
- Rollback: revert the squash-merge commit; the old bare-config cache format is not read by the new code, and the old code would not read the envelope, so the cache is simply refetched.

## How to verify
```
bash scripts/ci.sh
```
Focused tests: `backend/test/plugin/hook.test.ts` (`T013 AC1`..`AC6`) and e2e `startup.test.ts` (T3, T3b).
