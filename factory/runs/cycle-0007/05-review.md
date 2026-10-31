# Code Review report - cycle 0007 - F-005: Plugin: Azure DevOps fetch and authentication

## Inputs read
- `git diff main...HEAD` (working tree clean, no uncommitted changes)
- factory/backlog.json (F-005, 8 acceptance criteria), factory/runs/cycle-0007/01-product-owner.md, 02-architect.md, 03-backend.md, 04-security.md
- docs/architecture/contracts/plugin-interface.md (0.6.0, sections 1, 2d amendment, 2e, 4, 5), ADR-0007
- backend/plugin/azdo-remote-config.ts, backend/test/plugin/fetch.test.ts, settings.test.ts, azdo-remote-config.smoke.test.ts

## Work done
- Ran the full quality gate myself.
- Traced each acceptance criterion to the implementing code and to a test that would fail if the code broke.
- Checked the implementation against contract section 2e line by line: order of checks, URL construction, deadline, credential order, az args, init and header keys, status, size cap, body decoding, default runner.
- Looked for correctness bugs: unhandled rejections, timer leaks, races between deadline and fetch/read, sync throws from injected fakes, hostile proxies, off-by-one at the 1 MiB cap, and leaked secrets in results.
- Checked lanes and test integrity.

## Files changed
- `factory/runs/cycle-0007/05-review.md` - this report (the only file the reviewer edits).

## Verification
- `bash scripts/ci.sh` -> exit 0 (`ci: PASS`; check-fr11 PASS; tsc clean; node --test: 229 tests, 228 pass, 0 fail, 1 pre-existing platform skip; check-lf PASS).
- `git diff main...HEAD --numstat -- backend/test`: +2/-0 smoke, +818/-0 fetch.test.ts, +49/-0 settings.test.ts. No assertions removed or weakened.
- backend/package.json unchanged (no runtime `dependencies`).

### Acceptance criteria -> code -> test
| AC | Code | Test(s) that would fail if broken |
|----|------|-----------------------------------|
| 1 URL, one GET, Accept header, text byte-for-byte | `buildItemsUrl`, `performRequest`, `extractContent` | "AC-1: exact URL, init and header keys; text is returned unchanged" (exact URL string, init/header key order, 1 call, CRLF+comment JSONC unchanged); reserved-char encoding test; empty-content test |
| 2 PAT order, Basic header, own-props only, az never called | `findPat`, `usablePat`, `basicHeader` | AC-2 group (order, empty/whitespace skip, trim, inherited/accessor ignored, non-enumerable settings.pat), each with `forbiddenAz` |
| 3 az fallback, Bearer, failure -> auth-unavailable without HTTP | `azAuthorization`, `bearerFrom`, `AZ_TOKEN_ARGS` | AC-3 group: exact args, Bearer value, 16 failure modes with zero fetch calls, never-settling runner at 50 ms, non-function runAz |
| 4 timeout aborts signal, bounded, default 5000 | `startDeadline`, `readTimeoutMs`, `finally` clear | never-settling fetch (signal.aborted, < 2 s), never-delivering body, abort-rejection -> timeout, default 5000 via resolveSettings, timer cleared on success and failure |
| 5 http-<status>, no secret leakage | `handleResponse`, `codeForInterrupted`, fixed codes | 401/404/500/302/403/503 -> `http-N`; rejecting/throwing fetch with PAT in message -> `network`; `assertNoLeak` checks PAT, token, base64 header, error text |
| 6 1 MiB cap (declared and actual), bad-response shapes | `declaredTooLarge`, `readCappedBody`, `extractContent` | CL > cap with zero pulls; lying/missing CL; endless stream (pulls <= 20); exactly 1 MiB accepted; 16 bad-response shapes |
| 7 invalid settings incl. lone surrogate, nothing touched | `readTarget`/`validField`/`isWellFormedText`; 2d amendment in `acceptName/Branch/Path` | 24 table cases asserting zero fetch, runAz, env reads and timers; getter never invoked; settings.test.ts surrogate W2 tests |
| 8 never rejects, no mutation, export surface, CI | outer try/catch in `fetchRemoteConfig`, guarded `attempt`/`discard`/`settle` | hostile deps/settings/env proxies, throwing headers/status/cancel/timers, frozen inputs, fresh results; smoke test exact `__internals` key list; ci.sh exit 0 |

### Contract conformance
Implementation matches contract 0.6.0 section 2e: check order (settings, fetch availability, timer, credentials), URL format, `init` keys and header order, `redirect: "manual"`, `X-TFS-FedAuthRedirect: Suppress`, PAT usability rule (0x21..0x7E), token68 rule and 16384 cap, status handling (3xx -> http-N), the size cap before decode/parse, fatal UTF-8 decode, own `content` string, and the default runner options. Frontend not in scope (no FE side to compare).

### Bug hunt (no defects found)
- Unhandled rejections: every raced op goes through `settle` (rejection handled); `expired` never rejects; `discard` attaches `.catch`. Late fetch resolution after a deadline cannot reject unhandled.
- Timer: one timer, always cleared in `finally`; a timer that fires synchronously is safe because `fire` is assigned in the synchronous Promise executor before `clock.set` runs.
- Cap: `total > MAX_RESPONSE_BYTES` is checked before push, so exactly 1 MiB passes and 1 MiB + 1 fails. Node fetch decompresses transparently, and the streamed cap counts decompressed bytes, so gzip cannot bypass it.
- Secrets: results hold fixed codes only; the catch-all fallback is `network`.

### Lanes
The engineer changed only `backend/` (plugin plus three test files). `docs/architecture/` changes belong to the Architect, and `factory/` holds the orchestrator/PO/report files. No frontend changes.

## Findings / issues
| # | Severity | File:line | Finding | Required fix | Owner |
|---|----------|-----------|---------|--------------|-------|
| 1 | info | backend/plugin/azdo-remote-config.ts (`defaultRunAz`) | Default az runner (POSIX execFile and Windows `cmd.exe /d /s /c` path) has no automated test. The engineer disclosed this and the contract states it. | None for this cycle; see follow-ups. | backend |
| 2 | info | backend/plugin/azdo-remote-config.ts (`defaultRunAz`, Windows branch) | On Windows the execFile `timeout` kills `cmd.exe`, but the `az` (python) grandchild may outlive it until it finishes. This does not affect the result (the deadline race already returned `auth-unavailable`), but a stray process may linger briefly. | None now; consider it when wiring F-006. | backend |
| 3 | info | backend/plugin/azdo-remote-config.ts (`MAX_EMPTY_CHUNKS`) | The 1024-consecutive-empty-chunk guard (-> `bad-response`) is not in contract 2e. The behaviour is sensible and tested. | Architect to document it in contract 2e on the next amendment. | backend (architect doc) |

No blocking findings.

## Assumptions made (no human available)
- I accepted the stricter `invalid-settings` rule for empty or padded hand-built settings (engineer finding 1) because it matches the contract text "accept(v) === v" plus the "string, well-formed" requirement, and it is the conservative choice.
- I treated the deadline firing during az as `auth-unavailable` rather than `timeout` as correct, because contract 2e step 5 explicitly lists "deadline" under `auth-unavailable`.

## Follow-ups for the backlog
- Add an opt-in integration test (or a spawn-seam unit test) for `defaultRunAz` covering POSIX args, the Windows ComSpec command line, timeout and ENOENT mapping.
- Windows: consider killing the process tree on az timeout (e.g. `taskkill /T`) or document the behaviour.
- Contract 2e: document `MAX_EMPTY_CHUNKS`.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0007/05-review.md
summary: F-005 review PASS - ci.sh exit 0 (228 pass, 0 fail), all 8 ACs implemented and covered by meaningful tests, matches contract 0.6.0 section 2e, no correctness bugs; 3 info follow-ups
