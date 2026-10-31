# Backend report - cycle 0007 - F-005: Plugin: Azure DevOps fetch and authentication

## Inputs read
- factory/runs/cycle-0007/02-architect.md, docs/architecture/ADR-0007-azdo-fetch-and-auth.md, contracts/plugin-interface.md (2e, 2d), backend/plugin/azdo-remote-config.ts, existing settings/smoke tests.

## Work done
- BE-1: `isWellFormedText` (charCodeAt loop) added; applied in `acceptName`, `acceptBranch`, `acceptPath`. A lone surrogate now gives W2 and the next source applies.
- BE-2: `fetchRemoteConfig(settings, deps?)` and `defaultRunAz` in `backend/plugin/azdo-remote-config.ts` (section "Azure DevOps fetch and auth (ADR-0007)"). Added as 5th `__internals` key; not wired into server/config. Only new import: `execFile` from `node:child_process`. No `shell` option anywhere. Header comment updated.
- BE-3: new `backend/test/plugin/fetch.test.ts` (96 tests, fake fetch / fake runAz only).
- BE-4: smoke test key list now has `fetchRemoteConfig` as 5th key.

## Acceptance criteria -> tests
(AC numbering as in the architect report; tests in `backend/test/plugin/fetch.test.ts` unless noted)
| AC | Proof |
|----|-------|
| AC-1 exact URL, init keys, headers, text unchanged | "AC-1: exact URL, init and header keys; text is returned unchanged"; "AC-1: settings produced by resolveSettings work; percent-encoding..."; "AC-1: an empty content string..." |
| AC-2 PAT order, skip rules, runAz never called | "AC-2: settings.pat beats AZDO_PAT..."; "empty and whitespace-only..."; "values with CR/LF, a space or non-ASCII are skipped"; "a trimmed PAT is used"; "inherited and accessor env values are ignored"; "non-enumerable settings.pat..." (all use a runAz spy that fails if called) |
| AC-3 az fallback | "AC-3: without a PAT, runAz is called once with the constant args..."; token68 test; 16 failure-mode tests (sync throw, reject, exit 1/null/"0", empty/blank/non-string stdout, inner space, CRLF, injection, padding only, >16384 chars, non-object/null/array result); 16384-char accepted; never-settling runner at 50 ms; `runAz: null/5/"az"/{}` |
| AC-4 timeout | "a fetch that never settles gives timeout and aborts the signal"; "a body that never delivers a chunk"; "rejects because of the abort"; "default timeout is 5000 ms and the timer is cleared"; "configured timeoutMs ... out-of-range falls back"; "timer is cleared on failure paths" |
| AC-5 errors, no secrets | "http status codes map to http-<status>" (401/404/500/302/403/503); "rejecting or throwing fetch gives network"; "unavailable fetch gives network"; "failed az-token request never leaks the token" (all assertNoLeak) |
| AC-6 size and shape | Content-Length 1048577 with zero pulls; lying/missing header; endless stream (pulls <= 20); endless empty chunks; exactly 1 MiB accepted; multi-chunk reassembly; 16 bad-response shapes; stream error -> network |
| AC-7 invalid settings | 24 cases (missing/empty/padded/non-string, 4 lone-surrogate cases, slash, percent, dot-dot, path forms, branch forms, control char, null/42/"x"/[]/undefined) each with zero fetch, runAz, timer and env touches; getter test |
| AC-8 hostile inputs, no mutation | hostile deps (null, 42, string, array, throwing proxy, revoked proxy; global fetch faked), hostile settings, throwing/revoked env proxy, odd fetch return values, throwing headers.get / status / cancel, throwing timers, frozen and unmutated inputs, fresh results; smoke test (5th key, export set) |
| contract 2d amendment | `settings.test.ts`: "lone surrogates give W2 and fall through", "...in env warn too", "valid surrogate pair accepted and nothing throws" |

## Verification (exact)
- `bash scripts/ci.sh` -> exit 0. check-fr11: PASS; `tsc --noEmit` clean; `node --test`: tests 229, pass 228, fail 0, skipped 1 (the pre-existing `/dev/zero` placeholder test, skipped on Windows).
- `backend/package.json` unchanged (`git diff` empty).
- Plugin file greps: no slash-star/star-slash sequences outside the pre-existing JSDoc blocks (none in new code); 0 non-ASCII bytes; 0 CR bytes; no `shell:` key (word "shell" appears only in two comments); the only `throw` words in new code are in comments (the `throw` statements at lines 128-326 are the pre-existing helpers); no `require(`; imports all `node:`.

## Honest notes
- `defaultRunAz`, including the Windows cmd.exe path (ComSpec/absolute check, `/d /s /c`, constant command line, `cwd: homedir()`), has NO automated test (would need a real az). The real global `fetch` is only exercised through a faked `globalThis.fetch` in the hostile-deps test.
- Line endings: the working-tree plugin file was CRLF (autocrlf checkout of an LF blob); I wrote it back as LF (as the task required). `git diff` warns CRLF will be restored on next git touch; this is normal. Existing test files were left as found.
- Incident: while appending to `settings.test.ts` a failed script truncated the file; I restored it from `git show HEAD:` and re-appended the three new tests (diff vs HEAD is +49 lines only; all 48 settings/smoke tests pass).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/plugin/azdo-remote-config.ts | `fetchRemoteConfig` additionally rejects empty and untrimmed (padded) org/project/repo/path/branch as `invalid-settings` (stricter than "accept(v)===v" alone, because acceptName("") returns ""). | none; consistent with architect assumption on hand-built settings |
| 2 | info | contract | Added an internal cap of 1024 consecutive empty chunks (-> `bad-response`) so a stream of synchronous empty chunks cannot starve the timer. Not in the contract. | Architect may document |

## Assumptions
- A deadline firing during az gives `auth-unavailable`; a fetch rejection after the deadline fired gives `timeout`; a body-stream error without deadline gives `network`.
- A throwing `headers.get` is ignored (the real length is still enforced by the streamed cap).
- With hostile (non-record) `deps` the defaults apply per ADR-0007 section 2 (hence tests fake `globalThis.fetch`).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0007/03-backend.md
summary: fetchRemoteConfig + well-formed guard implemented with 96 new tests; ci.sh exit 0 (228 pass, 0 fail, 1 pre-existing skip)
