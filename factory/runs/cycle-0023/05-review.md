# Code Review report - cycle 0023 - F-021: Plugin: classify Azure firewall / network-blocked failures in the remote fetch with an actionable log hint

## Inputs read
- `git diff main...HEAD` (working tree clean)
- `factory/backlog.json` F-021 (7 ACs), `01-product-owner.md`, `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/ADR-0020-plugin-fetch-network-classification.md`, `contracts/plugin-interface.md` 0.9.0 (2e rows 6/7/7a, 2f-L), `contracts/installer-cli.md` 1.3.1
- `backend/plugin/azdo-remote-config.ts`, `backend/installer/smoke.ts`, the changed tests

## Work done

### Quality gate
- `bash scripts/ci.sh` -> exit 0 (`tests 690, pass 680, fail 0, skipped 10`; check-lf PASS; check-docs PASS; `ci: PASS`).

### Contract conformance (plugin-interface 0.9.0)
- `FetchErrorCode` adds exactly `network-unreachable` and `network-blocked`.
- `handleResponse` decision order matches row 7: status unreadable -> `bad-response`; non-2xx -> `codeForStatus` THEN `discardBody` (body never read); 2xx path unchanged (`declaredTooLarge` -> `readCappedBody`). Content-Type is read only for a 403 (`codeForStatus`, azdo-remote-config.ts:922); 407 returns before any header read; 401 never reads headers.
- `readContentType` is inside `attempt` and returns only a primitive string; `isJsonMediaType` uses `indexOf/slice/trim/toLowerCase/endsWith`, no regex, no coercion. Rule matches row 7a (application/json, or exactly one `/` with a `+json` subtype that has a non-empty prefix).
- `codeForInterrupted(outcome, deadline, failed)`: deadline still wins; `performRequest` passes `network-unreachable`, `readCappedBody` passes `network`; `runFetch` (no fetch) and outer catch keep `network`. Matches the code table.
- Hints: both constants are byte-identical to the contract section 2f-L (verified with `grep -F` of the full text against the contract, plugin, hook.test.ts and startup.test.ts). `hintFor` mapping = contract table (NETWORK: network-unreachable / network-blocked / timeout; CREDENTIALS: http-401 / http-403 / auth-unavailable; else none). `logHint` is called once, immediately after L-NONE (before `return`) and after L-CACHE (before L-APPLIED); never on success or the missing-settings path. Level is always `warn`.
- No new import, `__internals` unchanged (no diff in that region; example-config key assertion untouched and passing), `backend/installer/smoke.ts` unchanged (not in the diff).

### AC coverage and mutation testing
Mutations were applied one at a time to a scratch copy (`git archive HEAD backend` into the session scratchpad, never in the repo); `test/plugin/fetch.test.ts` + `test/plugin/hook.test.ts` were run (plus e2e for M6):

| # | Mutation | Result |
|---|----------|--------|
| M1 | any 403 (incl. JSON) -> `network-blocked` | killed (4 fail) |
| M2 | 401 reads Content-Type | killed (1 fail, header-name spy) |
| M3 | 407 -> `http-407` | killed (4 fail) |
| M4 | fetch rejection -> `network` | killed (37 fail) |
| M5 | hint also for `http-500` | killed (3 fail) |
| M6 | hint logged before the L-NONE line | killed (40 fail) |
| M7 | 2xx reads Content-Type | killed (1 fail, header-name spy) |
| M8 | drop `discardBody` on non-2xx | killed (4 fail, cancel spy) |
| M9 | hint text changed by one character | killed (40 fail) |
| M10 | `+json` without subtype prefix accepted | killed (1 fail) |
| M11 | hint logged twice | killed (46 fail) |

AC mapping:
- AC-1: fetch.test.ts "F-021 AC-1" x5 (rejection with PAT and az token, sync throw, deadline-fired never-settling fetch -> timeout, abort-rejecting fetch -> timeout, unavailable fetch / throwing setTimeout / failing 2xx stream -> network).
- AC-2: 407 matrix and 403 non-JSON matrix (16 variants incl. throwing get, non-string, `String` object, hostile `toString` spied as never called, throwing/missing `headers`), each asserting `getReader 0 / cancel 1`.
- AC-3: JSON 403 variants (header-name spy = exactly `["content-type"]`), 401 any type with zero header reads, 404/500/503/302, 2xx asks only `content-length`.
- AC-4: hook.test.ts `HINT_CASES` (16 cases x {no cache, bound cache}) with exact messages AND exact level arrays; missing-settings exact two lines; success has no hint.
- AC-5: one fetch call, cache bytes and mtime unchanged, merged config exact; cache-mismatch case not applied with exact `[L-NONE(cache-mismatch, network-blocked), HINT_NETWORK]`.
- AC-6: canary matrix (body, Content-Type, x-canary, PAT, az token, Basic/Bearer value, host, `https://`, setting values, throwing headers getter) x 3 sink behaviours (normal, throwing, rejecting) x {PAT, az}; `JSON.stringify` and `inspect` checked.
- AC-7: smoke.test.ts "F-021 AC-7a" (exact `formatSmoke` lines, no network hint line, `smokeFailed` true, for both new codes); install-smoke.test.ts "F-021 AC-7b" (exit 4, exact stdout tail, 2 requests, no secrets); FR-11 lint and CI pass.

### Changed existing tests (strengthened, not weakened)
- fetch.test.ts: three `network` -> `network-unreachable` exact re-expectations; 403 removed from the status loop and replaced by an explicit JSON-403 (`http-403`) + text-403 (`network-blocked`) test with `assertNoLeak` - net stronger.
- hook.test.ts: every changed assertion is still `deepEqual` on the full message array, now with the extra exact hint; level assertions added for the hint. Nothing deleted or turned into prefix/includes checks.
- e2e startup.test.ts T3/T4/T3b: exact `rec(...)` arrays with the hint added; the `http-500` T3 case still asserts NO hint.
- smoke.test.ts: the existing test was renamed and its azdo code re-expected to `network-unreachable`; the bifrost half (`network`) is untouched. Not in the architect's list but a direct, correct consequence of the same code change (smoke.ts passes the plugin code through). Exact `deepEqual` retained.

### Bug hunt
- No correctness bug found. `readContentType` can only be reached for status 403; any throw is absorbed by `attempt`; a non-string is never coerced; `discardBody` always runs after classification, so a throwing header getter cannot skip the cancel (covered by the `headers getter throws` case asserting `cancel: 1`).
- Sync throw of fetch -> `network-unreachable` via the unchanged `settle`; documented assumption in ADR-0020, tested.
- A rejection after the deadline correctly stays `timeout` (`deadline.timedOut()` checked first).

### Maintainability
- `handleResponse` grew by one line; classification is factored into small pure helpers (`codeForStatus`, `isJsonMediaType`, `readContentType`, `hintFor`, `logHint`). `executeHook` gained two `logHint` calls only; it was already the longest function (~45 lines) but its complexity did not materially change. No dead code, no duplication beyond the deliberate test-local copies of the hint texts (contract pinning).

### User scenario (Kilo behind an Azure IP firewall)
What the engineer sees in Kilo's log (always the existing line, then one warn hint):
- Egress firewall / NSG silently drops -> `Remote config unavailable (timeout) ...` + NETWORK hint. Actionable (VPN / allow public IP).
- DNS failure, connection refused/reset, untrusted TLS-inspecting proxy -> `(network-unreachable)` + NETWORK hint.
- Proxy/WAF/Front Door HTML or text 403, or 407 -> `(network-blocked)` + NETWORK hint.
- Azure DevOps org IP conditional-access policy (JSON 401/403) -> `(http-401|http-403)` + CREDENTIALS hint, whose trailing clause tells the user to connect to the VPN if the org restricts by IP. Not misleading; the known false negative is documented in ADR-0020 and routed to F-022.
- Azure Firewall application-rule deny (reported as non-standard HTTP 470) -> `http-470`, no hint. Out of scope per AC-3; already a follow-up.
- Hints contain no host, URL, org/project/repo or credential value.

### Lanes
- Engineer changes are confined to `backend/` (plugin + tests). Docs/architecture and factory files were changed by the Architect / PO / orchestrator in their own commits. No frontend.

## Files changed
- `factory/runs/cycle-0023/05-review.md` - this report.

## Verification
- `bash scripts/ci.sh` -> exit 0.
- 11 mutations on a scratch copy, all killed (table above).
- Hint text byte-identity: `grep -F` of both full texts matched in the contract, plugin and tests.

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | low | backend | `backend/test/plugin/hook.test.ts:929` | The AC5 cache-survival test checks length 3 and lines [1] and [2] but not line [0] (`Remote config unavailable (<code>); using cached config.`), so the per-case code is not pinned there. Covered elsewhere by the exact `HINT_CASES` table, so no gap in AC coverage. | Optional: assert the full message array per case. Backlog. |
| 2 | info | backend | `backend/test/plugin/hook.test.ts:842` | AC-4 lists `invalid-settings` among the "no hint" codes; `HINT_CASES` does not include it. `hintFor` defaults to no hint for any unlisted code, and mutation M5 shows the table guards against extra mappings, so risk is minimal. | Optional: add an `invalid-settings` row. Backlog. |

No blocking findings.

## Assumptions made (no human available)
- The smoke.test.ts rename/re-expectation outside the architect's BE-4 list is accepted: it is the exact consequence of AC-1 on a pass-through code, assertion strength is unchanged, and AC-7 explicitly permits changes "where a fetch rejection's code moved from network to network-unreachable".
- Mutations were run against the plugin and hook test files (plus e2e for M6); the installer/e2e suites were exercised by the full CI run.

## Follow-ups for the backlog
- Pin the full message array in the hook AC5 test and add an `invalid-settings` row to `HINT_CASES` (findings 1, 2).
- (Already raised by the Architect) HTTP 470 Azure Firewall deny classification; smoke network hint for `fail network-unreachable|network-blocked|timeout`.
- Consider a hint for a 2xx sign-in HTML page (Azure DevOps can answer 203 with an HTML sign-in page, today `bad-response` with no hint).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0023/05-review.md
summary: F-021 matches contract 0.9.0 (decision order, code table, byte-identical hints, L-CACHE/L-NONE -> hint -> L-APPLIED); every AC covered, 11/11 mutations killed, changed tests strengthened; ci.sh exit 0; 1 low + 1 info test nits to backlog.
