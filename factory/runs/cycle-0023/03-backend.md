# Backend report - cycle 0023 - F-021

## Work done
Product change only in `backend/plugin/azdo-remote-config.ts` (one file, no new import, no new `__internals` key):
- `FetchErrorCode` gains `network-unreachable` and `network-blocked`.
- `codeForInterrupted(outcome, deadline, failed)`: `performRequest` passes `network-unreachable`, `readCappedBody` passes `network`. `runFetch` (no fetch) and the outer catch keep `network`.
- New `readContentType` (guarded `attempt`, primitive string only), `isJsonMediaType` (indexOf/slice/trim/toLowerCase/endsWith, no regex), `codeForStatus` (407 -> network-blocked; 403 non-JSON -> network-blocked; else `http-<status>`). `handleResponse` classifies, then `discardBody`; body never read; Content-Type read only for 403, never on 2xx.
- `LOG_HINT_NETWORK`, `LOG_HINT_CREDENTIALS` (exact contract texts), pure `hintFor`, `logHint`; one warn hint after L-CACHE / L-NONE only.

## Acceptance criteria -> tests
- AC-1: fetch.test.ts "F-021 AC-1" x5 (rejection PAT+az, sync throw, deadline timeout, abort-rejection timeout, network for unavailable/throwing setTimeout/stream error); existing "AC-4 timer cleared" now `network-unreachable`.
- AC-2: "F-021 AC-2" 407 and 403 non-JSON matrix (null, html, plain, throwing get, number, String object, hostile toString, throwing/missing headers, text/json, json5, +json, application/+json, a/b/c+json, empty); body spy getReader 0 / cancel 1.
- AC-3: "F-021 AC-3" JSON 403 variants, 401 (headers never read), 404/500/503/302, 2xx only asks content-length; "AC-5: JSON 403 / text 403" test.
- AC-4: hook.test.ts table `HINT_CASES` (16 cases x no-cache and bound-cache, exact messages and levels), missing-settings, success.
- AC-5: "F-021 AC5" (one fetch call, cache bytes and mtime unchanged, mismatch case), plus re-expected T013 tests.
- AC-6: "F-021 AC6" canary matrix (body, Content-Type, x-canary, PAT, az token, throwing header getters, throwing and rejecting sinks; JSON.stringify and inspect checks) plus existing AC7/AC8 leak suites.
- AC-7: smoke.test.ts "F-021 AC-7a" (exact formatSmoke lines, no network hint, smokeFailed true); install-smoke.test.ts "F-021 AC-7b" (exit 4, exact stdout tail, 2 requests); example-config `__internals` assertion unchanged; `npm run lint` passes.

## Existing tests changed (exact re-expectations, none loosened or deleted)
- fetch.test.ts: "AC-4 timer cleared on failure paths" (network -> network-unreachable); "AC-5 http status codes" (403 removed from loop, new JSON-403/text-403 test); "AC-5 rejecting or throwing fetch" (renamed, network-unreachable x2); "AC-8 odd fetch return values" (Promise.reject(undefined) -> network-unreachable).
- hook.test.ts: FETCH_FAILURES (renamed, hint expected for network-unreachable and timeout, hint level warn); AC4 corrupt cache (7 cases: reason + hint, levels error/warn); T013 constants L_NETWORK_MISMATCH / L_CACHE_NETWORK / noneLine default -> network-unreachable and HINT_NETWORK added in AC1, AC2, AC4 outdated, AC4 invalid, AC6.
- e2e/startup.test.ts: T3, T4, T3b (network-unreachable + hint record).
- installer/smoke.test.ts: "runSmoke maps throwing authenticated fetch ..." azdo r1 code `network` -> `network-unreachable` (not in the design list; consequence of the same change; bifrost stays `network`). Test renamed.

## Verification
- `cd backend && npm run lint` -> check-fr11: PASS
- `cd backend && npm run typecheck` -> clean
- `bash scripts/ci.sh` -> exit 0: tests 690, pass 680, fail 0, skipped 10 (pre-existing skips), check-lf PASS, check-docs PASS (36 files), ci: PASS

## Findings / notes
- Contract inconsistency: none found. Worktree files are CRLF (autocrlf) while index is LF; check-lf passes.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0023/03-backend.md
summary: F-021 implemented in azdo-remote-config.ts (network-unreachable/network-blocked, guarded 403 Content-Type rule, warn hints); tests re-expected and added; ci.sh exit 0
