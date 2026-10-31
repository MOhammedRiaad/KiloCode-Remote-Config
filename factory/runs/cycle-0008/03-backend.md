# Backend report - cycle 0008 - F-006

## Work done
- `backend/plugin/azdo-remote-config.ts` (single file, no new deps; imports `mkdirSync`, `renameSync`, `unlinkSync`, `writeFileSync` added to `node:fs`):
  - BE-1: `mergeInto` takes an optional journal; new `applyShared` (sanitise, journaled merge, reverse rollback). `mergeConfig` unchanged.
  - BE-2: `validateShared` (`invalid-jsonc` / `invalid-shape`, depth >= 64 rejected).
  - BE-3: `writeCache` / `readCache` (sanitised unresolved config, 2 MiB cap, dir 0700, tmp file `wx` 0600 + rename, guarded unlink, ENOENT -> `cache-missing`).
  - BE-4: `makeLogger` (fire and forget, `log.call(app, {body})`, no `extra`), fixed L-* messages, placeholder-name sanitiser (control/C1 -> `?`, 200 chars, 20 names, `, and N more`).
  - BE-5: `runConfigHook` as 6th `__internals` key; server is now `(input, options) => ({ config: (c) => runConfigHook(input, options, c) })`; header comment updated.
- BE-6: new `backend/test/plugin/hook.test.ts`.
- BE-7: smoke test: removed the superseded no-op / never-logs tests, kept shape tests, updated key list, added child-process default-wiring test (HOME/USERPROFILE = temp dir, settings env cleared).

## AC to test map (hook.test.ts unless noted)
| AC | Tests |
|---|---|
| 1 | "AC1 defaults mode ...", "AC1 enforce mode ..." |
| 2 | "AC2 success writes a sanitised unresolved cache atomically ..." (wx/0600/rename, no direct write, POSIX mode, info log) |
| 3 | "AC3 network / http-500 / timeout falls back to the cache without touching it" |
| 4 | "AC4 corrupt cache ..." (7 variants), "absent cache", "oversized cache" |
| 5 | "AC5 missing settings skip fetch and az ...", "invalid option logs its warning", "invalid fetched content ..." (6 variants), "keeps an existing cache" |
| 6 | "AC6 unresolved placeholders log names only", "names are sanitised and capped at 20" |
| 7 | "AC7 no log argument contains a secret ..." (JSON.stringify + util.inspect showHidden, exact arg shape) |
| 8 | "AC8 ..." tests: failing collaborators, rename failure + unlink, oversized not cached, throwing/rejecting/hanging/throwing-then logger, missing logger, frozen config, frozen nested rollback, enforce rollback, hostile options/deps, non-object config; smoke child-process test; ADR-0009 already written |

## Verification
- `cd backend && npm run lint` -> `check-fr11: PASS`
- `cd backend && npm run typecheck` -> clean
- `cd backend && npm test` -> 267 tests, 266 pass, 0 fail, 1 skipped (pre-existing `/dev/zero` placeholder test, skipped on Windows)
- `bash scripts/ci.sh` -> exit 0 (`ci: PASS`)

## Findings / issues
None. Contract followed as written.

## Assumptions
- A journal entry is pushed before the write; a write that throws leaves an idempotent entry, so rollback is still exact.
- Test-injected `fs` methods are read with ordinary property access (injected seam, not untrusted).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0008/03-backend.md
summary: F-006 backend implemented (runConfigHook, cache, logger, journaled merge); ci.sh exit 0
