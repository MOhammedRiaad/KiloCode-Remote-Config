# Architect report - cycle 0023 - F-021: Plugin: classify Azure firewall / network-blocked failures in the remote fetch with an actionable log hint

## Inputs read
- `factory/runs/cycle-0023/01-product-owner.md` (selected item, 7 ACs, PO decisions)
- `backend/plugin/azdo-remote-config.ts` (`FetchErrorCode`, `startDeadline`, `codeForInterrupted`, `handleResponse`, `performRequest`, `runFetch`, `fetchRemoteConfig`, `executeHook`, `makeLogger`, `__internals`)
- `backend/installer/smoke.ts` (`checkAzdo` passes `fetched.error` through; `formatSmoke` / `hasNetworkCondition`)
- `backend/test/plugin/fetch.test.ts`, `backend/test/plugin/hook.test.ts`, `backend/test/e2e/startup.test.ts`, `backend/test/installer/{smoke,install-smoke,install-ps1-smoke}.test.ts`, `backend/test/installer/fixtures/fake-network.ts`
- `docs/architecture/ADR-0001`, `ADR-0007`, `ADR-0008`, `ADR-0018`, `ADR-0019`, `overview.md`, `contracts/plugin-interface.md` 0.8.0, `contracts/installer-cli.md` 1.3.0, `contracts/e2e-harness.md`
- Community sources on Azure Firewall's non-standard HTTP 470 deny response (used only for a follow-up, not for the design)

## Work done

### Design summary
- **No probe.** There is still exactly one authenticated `fetch` per hook run, inside the existing `timeoutMs` budget. Classification happens on the failure of that single fetch.
- **New codes** in the module-local `FetchErrorCode`:
  - `network-unreachable`: the fetch call fails (rejection, or a sync throw already turned into a rejection by `settle`) **before** the deadline.
  - `network-blocked`: HTTP 407, or HTTP 403 whose Content-Type is not JSON.
- **Unchanged codes:**
  - `timeout`: the deadline won, or a failure arrived after it fired.
  - `network`: fetch unavailable, an unexpected internal throw (outer catch), or a body-stream failure after a 2xx.
  - `http-401` (any type), `http-403` (JSON) and every other `http-<status>`.
- **Decision order in `handleResponse`:**
  1. Status unreadable: `bad-response`.
  2. Non-2xx: classify with `codeForStatus`, **then** `discardBody`. The body stays unread and `getReader` is never called.
  3. 2xx: unchanged. The Content-Type of a 2xx response is never read.
- **Content-Type reading** (only for a 403, at most one `headers.get` call):
  - The read is `attempt(() => response.headers.get("content-type"))`. Any throw counts as absent.
  - Only a primitive `string` is inspected. It is never coerced, stored or logged.
  - JSON rule: take the part before the first `;`, then `trim()` and `toLowerCase()`. The result is JSON if it is `application/json`, or `type/subtype+json` with exactly one `/` and a non-empty subtype prefix.
- **Catch-path rewrite:** `codeForInterrupted(outcome, deadline, failed)` takes a third parameter.
  - `performRequest` passes `"network-unreachable"`.
  - `readCappedBody` passes `"network"`.
  - `startDeadline`, `settle`, `runFetch` and the outer catch are unchanged.
- **Hints:** at most one warn line, logged immediately after L-CACHE or L-NONE.
  - `network-unreachable`, `network-blocked` and `timeout` get the NETWORK hint.
  - `http-401`, `http-403` and `auth-unavailable` get the CREDENTIALS hint.
  - Every other reason gets no hint, and so do the success path and the missing-settings path.
  - The texts are pinned in contract 0.9.0, section 2f-L:
    - `LOG_HINT_NETWORK` = `Azure DevOps could not be reached from this network: connect to the corporate VPN or ask the platform team to allow your public IP address, then restart Kilo.`
    - `LOG_HINT_CREDENTIALS` = `Azure DevOps credentials are missing or were rejected: run az login or replace your PAT and check your access to the shared config repository; if your organisation restricts Azure DevOps by IP address, also connect to the corporate VPN.`
  - Both texts are ASCII, contain no value of any kind, and contain no `dev.azure.com` host and no slash-star sequence.
- **Unchanged:**
  - Remote-first order, the cache write and read, and the T-013 binding (`cache-mismatch` is still never applied).
  - The L-CACHE and L-NONE formats, `__internals` keys and order, exports and imports. No new import.
  - `smoke.ts` needs no code change. It prints `smoke azdo: fail network-unreachable|network-blocked` verbatim, which can only happen after a reachable F-020 probe.
  - The smoke network hint stays tied to `smoke network: fail ...` only.

### Documents written / amended
- New ADR-0020 covers:
  - the full code table and decision order
  - the Content-Type rule
  - the hint texts, mapping and placement
  - an honest false-positive / false-negative table
  - the alternatives that were rejected
- `contracts/plugin-interface.md` goes from 0.8.0 to 0.9.0:
  - section 2e: the type, the "Never throws" row, rows 6, 7 and 8, a new row 7a (classification and JSON rule with examples), and a code summary row
  - section 2f: the Order row
  - section 2f-L: the L-HINT-NETWORK and L-HINT-CREDENTIALS rows, the hint rule and mapping table, placement, and updated example sequences
- `contracts/installer-cli.md` goes from 1.3.0 to 1.3.1. This is informative only: section 9.1 lists the two pass-through codes and the difference from `skipped network-blocked`.
- ADR-0007 and ADR-0008 status lines point to ADR-0020. The `overview.md` C2 status and the runtime data flow are updated.

### Honest false-positive / false-negative assessment (summary of ADR-0020)

| Situation | Code and hint | Verdict |
|---|---|---|
| A firewall silently drops packets (off VPN, NSG or Azure Firewall DNAT) | `timeout` + NETWORK | Correct |
| DNS failure, connection refused or reset, or an untrusted TLS-inspecting proxy | `network-unreachable` + NETWORK | Correct. A real Azure DevOps TCP-level outage also lands here; the hint is still the right first check. |
| Front Door or App Gateway WAF, or a proxy HTML/text block page (403) | `network-blocked` + NETWORK | Correct |
| A real Azure DevOps permission failure (JSON 403) | `http-403` + CREDENTIALS | Correct |
| An expired PAT or a bad token (401, any type) | `http-401` + CREDENTIALS | Correct |
| An Azure DevOps org IP conditional-access policy (JSON 401/403) | `http-401` / `http-403` + CREDENTIALS | **False negative.** The trailing VPN clause in the credentials hint mitigates it. F-022 documents it. |
| A TLS-inspecting proxy with a trusted CA that answers 403 with a JSON body | `http-403` + CREDENTIALS | **False negative**, rare. F-022 documents it. |
| Azure DevOps answering 403 with a non-JSON page | `network-blocked` + NETWORK | **Possible false positive**, judged rare because Azure DevOps REST answers are JSON |
| A 407 from a proxy | `network-blocked` | Correct but rare: Node's fetch uses no proxy by default, and a failed CONNECT rejects, which gives `network-unreachable` |
| A captive-portal 3xx | `http-3xx`, no hint | Unchanged |
| Azure Firewall application-rule deny reported as HTTP 470 (undocumented) | `http-470`, no hint | Out of scope (AC-3); follow-up |
| A body stream fails after a 2xx | `network`, no hint | Deliberate: the connection was open |

## Backend tasks

Owner: senior-backend. Follow ADR-0001, ADR-0007, ADR-0008, ADR-0018, **ADR-0020** and contract `plugin-interface.md` **0.9.0** (sections 2e row 6, 7, 7a, code summary; 2f Order; 2f-L).

Product code in `backend/plugin/azdo-remote-config.ts` only. There is no change to `backend/installer/smoke.ts`, to exports or imports, or to the `__internals` keys. The FR-11 rules of ADR-0007 section 12 apply: `//` comments only, ASCII, LF, no slash-star sequence, no regex literal needed.

### BE-1: error codes and the catch path (AC-1)
- Add `"network-unreachable" | "network-blocked"` to `FetchErrorCode`.
- Give `codeForInterrupted(outcome, deadline, failed: FetchErrorCode)` a third parameter.
  - `performRequest` passes `"network-unreachable"`.
  - `readCappedBody` passes `"network"`.
- Keep unchanged:
  - `runFetch` returns `failure("network")` for a non-function fetch.
  - The outer catch in `fetchRemoteConfig` still returns `"network"`.
  - `startDeadline` and `settle` are not touched.
- A sync throw of the fetch function counts as a failed fetch call. It gives `network-unreachable` before the deadline and `timeout` after it (ADR-0020, Alternatives).

### BE-2: non-2xx classification and the safe Content-Type read (AC-2, AC-3, AC-6, FR-10)
- Add `readContentType(response)`. It uses the same `attempt` and ordinary property access pattern as `declaredTooLarge`.
- Add `isJsonMediaType(raw)`. It applies the exact rule of contract row 7a: primitive string only; text before the first `;`; `trim()`; `toLowerCase()`; `application/json` or a single-`/` type with a `+json` subtype that has a non-empty prefix.
- Add `codeForStatus(status, response)`:
  - 407 gives `network-blocked` without reading the headers.
  - 403 gives `http-403` only with a JSON type, otherwise `network-blocked`.
  - Any other status gives `http-${status}`.
- In `handleResponse`, the non-2xx branch is `const code = codeForStatus(status, response); discardBody(response); return failure(code);`.
- Read the header only for a 403. The 2xx path is unchanged and never reads the Content-Type.

### BE-3: hint lines in the hook (AC-4, AC-5)
- Add the constants `LOG_HINT_NETWORK` and `LOG_HINT_CREDENTIALS` with the **exact** texts above (copy them from contract section 2f-L).
- Add a pure `hintFor(reason: string): string | undefined` using the mapping table in 2f-L.
- In `executeHook`'s failure branch:
  - Log L-NONE (error), then the hint (warn) if there is one, then `return`.
  - Or log L-CACHE (warn), then the hint (warn) if there is one, then continue as before.
- No hint on the missing-settings path or on success. At most one hint per run.

### BE-4: existing tests that must change (re-expectations; "strengthen, not weaken")

Change each assertion to the new exact value. Never use a prefix, regex, `includes` or length check, and never delete an assertion.

`backend/test/plugin/fetch.test.ts`:
- ~L413-423 "AC-4: the timer is cleared on failure paths too" (rejecting fetch): `network` becomes `network-unreachable`.
- ~L426-433 "AC-5: http status codes map to http-<status>":
  - Remove `403` from the loop. `new Response(text, {status: 403})` defaults to `text/plain;charset=UTF-8`, which is now `network-blocked`.
  - Keep 401, 404, 500, 302 and 503 with the leak check.
  - Add an explicit JSON-403 test that expects `http-403` and a text-403 test that expects `network-blocked`, both with `assertNoLeak`.
- ~L436-450 "AC-5: a rejecting or throwing fetch gives network": rename the test and change both cases to `network-unreachable`. Keep `assertNoLeak`.
- ~L732-739 "AC-8: odd fetch return values": `Promise.reject(undefined)` gives `network-unreachable`. The `bad-response` cases are unchanged.
- **Unchanged, keep as is** (they now pin the narrowed `network`):
  - ~L452-459 unavailable fetch
  - ~L575-583 stream errors mid-read
  - ~L773-781 throwing `setTimeout`
  - ~L741-770 the 200 header-throw and `http-500` cancel-throw cases

`backend/test/plugin/hook.test.ts`:
- ~L188-210 `FETCH_FAILURES`:
  - Rename `"network"` to `"network-unreachable"`.
  - The expected messages become L-CACHE, then `LOG_HINT_NETWORK` for `network-unreachable` and `timeout` only, then L-APPLIED.
  - `http-500` stays L-CACHE then L-APPLIED.
  - Also assert that the hint's level is `warn`.
- ~L218-228 "AC4 corrupt cache": the array becomes `[L-NONE(network-unreachable, cache-invalid), HINT_NETWORK]`, with levels error and warn.
- ~L629-634 constants:
  - `L_NETWORK_MISMATCH` and `L_CACHE_NETWORK` use `(network-unreachable)`.
  - The `noneLine` default reason becomes `"network-unreachable"`.
  - Add a test-local `HINT_NETWORK` / `HINT_CREDENTIALS` holding the literal contract texts. Do not import them from the plugin, because they are not exported.
- ~L652: `[L_NETWORK_MISMATCH, HINT_NETWORK]`.
- ~L667: `[L_CACHE_NETWORK, HINT_NETWORK, "Applied shared config from cache in <mode> mode."]`.
- ~L719 and ~L749: `[noneLine(...), HINT_NETWORK]`.
- ~L777-782: `ok = [L_CACHE_NETWORK, HINT_NETWORK, applied]` and `[L_NETWORK_MISMATCH, HINT_NETWORK]`.
- Unchanged:
  - ~L236 and ~L247 (`[0]` match)
  - ~L386-393 (`.at(-1)` / `[0]` match)
  - ~L758 (`.at(-1)`)
  - the AC7 and AC8 leak suites

`backend/test/e2e/startup.test.ts`:
- ~L162 T3: the case reason `"network"` becomes `"network-unreachable"`. The expected logs are `[L-CACHE, rec("warn", HINT_NETWORK), L-APPLIED]` for that case. The `http-500` case is unchanged (no hint).
- ~L184-189 T4: `(network)` becomes `(network-unreachable)`, followed by `rec("warn", HINT_NETWORK)`.
- ~L205-208 T3b: `(network)` becomes `(network-unreachable)` (cache-mismatch), followed by `rec("warn", HINT_NETWORK)`. Keep the "no release/acme in logs" checks.
- ~L303/309 are leak-only checks and stay unchanged.

Installer tests: none currently pins `smoke azdo: fail network`. The `formatSmoke` unit tests in `smoke.test.ts` (~L709/723) use synthetic codes and stay unchanged.

If any other test fails only because of the new hint line, fix it the same way: add the exact hint expectation.

### BE-5: new tests (one block per AC)
- **AC-1** (`fetch.test.ts`):
  - A rejection before the deadline gives `network-unreachable`, both with a PAT and with an az token (`runAz` fake).
  - A sync throw gives `network-unreachable`.
  - A never-settling fetch with fake timers fired gives `timeout`.
  - A fetch that rejects only when the signal aborts (fake clock fires) gives `timeout`.
  - No usable fetch gives `network`; so does a throwing `setTimeout`, and a 2xx whose stream errors.
- **AC-2:**
  - 407 with `text/html`, with `application/json` and with no Content-Type gives `network-blocked`.
  - 403 gives `network-blocked` when:
    - Content-Type is absent (`headers.get` returns `null`)
    - it is `text/html; charset=utf-8` or `text/plain`
    - `headers.get` throws
    - `headers.get` returns a number, a `String` object, or an object whose `toString` throws, which must not be called (spy)
    - the `headers` getter throws, or `headers` is missing
  - Spy on the body in every case: `getReader` is never called and `cancel` is called exactly once.
  - Also cover the non-JSON examples of row 7a: `text/json`, `application/json5`, `+json`, `application/+json`, `a/b/c+json`, `""`.
- **AC-3:**
  - 403 with `application/json`, `Application/JSON; charset=utf-8`, `application/problem+json` or ` application/json ;x=y` gives `http-403`.
  - 401 with `text/html`, `application/json` or no type gives `http-401`, and `headers.get` is never called for a 401 (spy).
  - 404, 500, 503 and 302 give `http-<status>`.
  - On a 2xx, `headers.get` is only ever asked for `content-length` (spy on names), never `content-type`.
- **AC-4** (`hook.test.ts`, table-driven): for each code, the exact message and level sequence, both with no cache (L-NONE) and with a bound cache (L-CACHE).
  - `network-unreachable` (rejecting fetch), `network-blocked` (HTML 403, and 407) and `timeout`: + HINT_NETWORK.
  - `http-401`, `http-403` (JSON) and `auth-unavailable` (no PAT, failing `runAz`): + HINT_CREDENTIALS.
  - No hint for:
    - `http-404`, `http-500`, `http-503`
    - `too-large` (`content-length` over the cap)
    - `bad-response`
    - `network` (stream error after a 2xx, or `fetch: 5`)
    - `invalid-jsonc`, `invalid-shape`
    - `missing-settings` (still exactly `[L-MISSING, L-NONE]`)
  - A success run has no hint.
  - At most one hint per run.
- **AC-5:**
  - A bound cache plus `network-unreachable` or `network-blocked` gives the config merged as before and logs `[L-CACHE, HINT_NETWORK, L-APPLIED]`. The fake fetch call count is exactly 1, and the cache bytes and mtime are unchanged.
  - A cache bound to other settings gives `[L-NONE(..., cache-mismatch), HINT_NETWORK]`, and the config is deep-equal to the original.
- **AC-6:** run failures carrying canaries in:
  - the body (HTML 403, JSON 401, 407, 500)
  - the Content-Type (`text/html; CTCANARY`, `application/json; CTCANARY`)
  - another header (`x-canary`)
  - the PAT and the az token
  - throwing header getters, plus a throwing and a rejecting log sink

  Then check that `runConfigHook` resolves, and that no `JSON.stringify` / `inspect` of any log argument contains:
  - the PAT, the token, the Basic or Bearer value
  - `dev.azure.com`, `https://`
  - the org, project, repo, path or branch values
  - any header canary or body canary
- **AC-7:**
  - (a) `smoke.test.ts` unit: `runSmoke` with an injected fetch where the origin probe returns 302 and the items URL rejects. `formatSmoke` must give exactly `["smoke network: pass", "smoke azdo: fail network-unreachable", "smoke bifrost: skipped azdo-failed"]`, with no network hint line, and `smokeFailed` true. Add the same with the items URL returning an HTML 403, which gives `fail network-blocked`.
  - (b) `install-smoke.test.ts` (install.sh): scenario `azdoProbe: {status: 302}, azdo: {mode: "throw"}`. Exit 4, stdout ends with `smoke network: pass\nsmoke azdo: fail network-unreachable\nsmoke bifrost: skipped azdo-failed\nDone.\n`, and 2 requests. Mirror the existing ~L188-199 hang case.
  - (c) The existing `example-config.test.ts` `__internals` key assertion stays unchanged, and `npm run lint` (check-fr11) passes.
- **Gate:** in `backend`, `npm run lint`, `npm run typecheck` (if defined per ADR-0001) and `npm test`, then `bash scripts/ci.sh` from the repo root, must exit 0.

## Frontend tasks
- None. `scope.frontend` is false and there is no frontend in this product (`overview.md`).

## Security notes (for the Security engineer)
- **Authentication and network:**
  - There is still exactly one outbound request, to the fixed `https://dev.azure.com/` host with `redirect: "manual"`. There is no probe and no new destination.
  - No credential handling changes.
- **Input handling:** `response.headers` and the Content-Type value are untrusted.
  - Every access is inside `attempt`.
  - Only a primitive string is inspected, and it is never coerced, so a hostile `toString` or getter cannot run code outside `attempt`.
  - It is used only for a boolean decision.
  - Check that no regex is used, and that there is no length-dependent backtracking (only `indexOf`, `slice`, `trim`, `toLowerCase` and `endsWith`).
- **Data exposure:**
  - Results and logs carry only fixed codes and the two constant hints. The non-2xx body is cancelled unread.
  - Verify: no catch binding was added; no header value reaches a result or log; the hints contain no host or URL.
- **Advisory, not a control:**
  - The classification only chooses the text of a hint. A server or intermediary can pick the code it causes (for example, by sending HTML on a 403), which is acceptable because no security decision depends on it.
  - The cache fallback condition is unchanged: any failure, with an exact binding match.
- **FR-10:** throwing header getters, a throwing `get`, a throwing `cancel` and a throwing or rejecting logger must all still resolve (covered by BE-5 AC-2 and AC-6).

## What F-022 (docs, next cycle) needs from this design
- `docs/troubleshooting.md`, plugin log section:
  - Meaning of `network-unreachable`, `network-blocked` and `timeout`, with the exact NETWORK hint text and the fix: VPN, or ask the platform team to allow your public IP.
  - `http-401`, `http-403` and `auth-unavailable` with the exact CREDENTIALS hint text and the fix: `az login`, replace the PAT, check repository access.
  - Known limitations, from ADR-0020's table:
    - An org IP conditional-access policy shows `http-401` / `http-403` with the credentials hint, so try the VPN.
    - A JSON 403 from a TLS-inspecting proxy reads as `http-403`.
    - `network` now means a broken body stream, an unavailable fetch or an internal error, not a firewall.
- The difference between installer `smoke azdo: skipped network-blocked` (pre-flight probe verdict) and `smoke azdo: fail network-blocked` / `fail network-unreachable` (authenticated request refused or failed after a reachable probe).
- Update the "Remote config unavailable (<code>)" code list in the user docs to match contract 0.9.0 section 2e.
- The cycle 0022 security note about the origin-`/` probe, already in F-022's ACs.
- Optional mention: `http-470` may indicate an Azure Firewall application-rule deny (community-reported, not documented by Microsoft). Only if the PO keeps the 470 follow-up out of scope.

## Files changed
- `docs/architecture/ADR-0020-plugin-fetch-network-classification.md`: new ADR (codes, decision order, Content-Type rule, hints, false-positive/negative table, alternatives).
- `docs/architecture/contracts/plugin-interface.md`: 0.9.0 (2e, 2f, 2f-L).
- `docs/architecture/contracts/installer-cli.md`: 1.3.1 (9.1 pass-through codes, informative).
- `docs/architecture/ADR-0007-azdo-fetch-and-auth.md`, `docs/architecture/ADR-0008-config-hook-wiring-cache-logging.md`: status lines point to ADR-0020.
- `docs/architecture/overview.md`: C2 status and runtime data flow.
- `factory/runs/cycle-0023/02-architect.md`: this report.

## Verification
- `node backend/tools/check-docs.mjs` -> `check-docs: PASS (36 markdown files checked)`, exit 0.
- No product code was changed in this phase. The full `bash scripts/ci.sh` run belongs to the engineer and CI phases.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | `backend/test/plugin/fetch.test.ts:428` | The existing http-status loop includes 403 with a default `text/plain` body. Under ADR-0020 that is correctly `network-blocked`. | Split it as described in BE-4. This is a re-expectation, not a weakening. |
| 2 | info | `backend/installer/smoke.ts:518` | The smoke network hint is printed only for a failed pre-flight, not for a plugin-side `fail network-unreachable` / `fail network-blocked`. | No change in F-021 (PO: `smoke.ts` unchanged). See follow-up. |

## Assumptions made (no human available)
- **A sync throw of the fetch function counts as `network-unreachable`.** It is treated the same as a rejection. A real fetch never throws synchronously, and separating the two would change the shared `settle` / `Outcome` machinery. PO AC-1's "unexpected internal throw" is read as the outer catch in `runFetch` / `fetchRemoteConfig`, which keeps `network`.
- **The credentials hint carries a trailing VPN clause.** This mitigates the documented false negative of an org IP conditional-access policy (JSON 401/403) without mislabelling a real credential failure. The hint is still a single line, and the network hint is never logged for these codes, as AC-4 requires.
- **The JSON rule is narrow.** It accepts `application/json` and `*/*+json` with a non-empty subtype prefix (the asterisks mean "any type and subtype", not literal characters). `text/json` and `application/json5` are not JSON. The aim is that a non-JSON block page is never mistaken for a permission error.
- **The hint level is always `warn`,** including after an `error` L-NONE line, as AC-4 requires.
- **The installer-cli contract gets a patch bump (1.3.1).** The change is informative only: `smoke.ts` code and output format are unchanged.

## Follow-ups for the backlog
- **(PO, low priority)** Classify the Azure Firewall application-rule deny as `network-blocked`. Community sources report it as a non-standard HTTP 470 with a plain-text "Action: Deny" body, but it is not in the Microsoft docs. It is out of F-021 because AC-3 keeps every other status as `http-<status>`.
- **(PO, low priority)** Have `formatSmoke` print the network hint also when `smoke azdo: fail network-unreachable|network-blocked|timeout` appears after a passing pre-flight. Today that hint is tied to `smoke network: fail` only.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0023/02-architect.md
summary: ADR-0020 + plugin-interface 0.9.0: fetch rejection before deadline -> network-unreachable, 407 / non-JSON 403 -> network-blocked (guarded Content-Type read, body unread), timeout/network/http-401/JSON http-403 unchanged; one fixed warn hint (NETWORK / CREDENTIALS) after L-CACHE/L-NONE; smoke.ts unchanged; backend-only task list with exact existing-test re-expectations.
