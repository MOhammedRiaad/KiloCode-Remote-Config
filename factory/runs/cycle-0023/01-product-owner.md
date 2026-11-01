# Product Owner report - cycle 0023 - F-021: Plugin: classify Azure firewall / network-blocked failures in the remote fetch with an actionable log hint

## Inputs read
- `factory/VISION.md` (no `VISION_TEMPLATE_UNCHANGED` marker), `factory/state.json` (cycle 23, last release v0.15.0), `factory/backlog.json`
- `factory/runs/cycle-0022/summary.md`, `02-architect.md`, `03-backend.md`, `04-security.md`, `05-review.md` (follow-ups)
- `backend/plugin/azdo-remote-config.ts` (`FetchErrorCode`, `codeForInterrupted`, `handleResponse`, `performRequest`, `runFetch`, `executeHook`, `__internals`), `backend/installer/smoke.ts` (how it passes plugin codes through), `docs/troubleshooting.md` (existing http-401/403 and network sections), and grep of tests and contracts that pin `network`

## Work done
- Grooming:
  - F-021 is selected and set to `in_progress`. Its priority goes from 2 to 1 because it is the remaining code slice of the active USER requirement. F-020 shipped in v0.15.0.
  - I rewrote the F-021 description with the decisions below and gave it 7 Given/When/Then ACs. Each AC can be checked with a fake fetch, a fake clock and a fake log sink.
  - F-022 is reduced to the remaining plugin-side docs. The installer-side docs already shipped with F-020. It now has 4 ACs, including the cycle 0022 security note about the origin-`/` probe.
  - I appended a cycle 0023 line to `_notes`. F-012/F-013/F-015 remain SKIPPED. Remote mode stays OFF.
  - T-032 (F-020 follow-ups) is already queued at priority 4. The cycle 0022 reports have no new follow-ups, so I made no other changes.
- Decisions on the open considerations (nobody can be asked):
  1. **No unauthenticated probe in the plugin.** The plugin runs inside Kilo at every start, so a probe would add a second round trip and more traffic to every startup. The failure of the authenticated fetch already carries the signal. The credential only ever goes to the fixed `https://dev.azure.com/` host over TLS, so a firewall that drops the connection never sees it. That was different in the installer case (F-020), where the key could go to a configurable host. The plugin still makes exactly one fetch call per hook run, inside the existing `timeoutMs` budget.
  2. **Classify the authenticated fetch's failure:**
     - The `fetch()` call rejects before the deadline: `network-unreachable` (new).
     - A deadline is reached: stays `timeout`.
     - A missing fetch, an internal throw, or a body stream that fails after headers arrived: stays `network`. The connection was open in that last case, so it is not a firewall.
  3. **403/407:**
     - 407 is always `network-blocked`. Azure DevOps never sends 407; it comes from a proxy.
     - 403 is `network-blocked` only when its Content-Type is absent, unreadable or not JSON (neither `application/json` nor `+json`). That covers the HTML or plain-text page of a firewall, WAF, Front Door or proxy.
     - A JSON 403 stays `http-403`. That is how Azure DevOps answers a real permission failure.
     - 401 always stays `http-401`.
     - Only the status and the Content-Type header are used. The body is still discarded unread, so no response text can reach a log.
     - I chose this over "keep http-403 and only add a hint" because a firewall's HTML 403 is a different action for the user. A JSON 403 keeps its existing meaning, so a real auth failure is never mislabelled as a network block.
  4. **Hint lines.** The existing `Remote config unavailable (<code>) ...` line keeps its format. After it, the hook logs exactly one fixed warn-level hint line that contains no values:
     - NETWORK hint (VPN / ask the platform team to allow your public IP) for `network-unreachable`, `network-blocked` and `timeout`. A firewall that silently drops packets shows up as a timeout.
     - CREDENTIALS hint for `http-401`, `http-403` and `auth-unavailable`.
     - No hint for any other code.
     - The Architect pins the exact texts in the plugin-interface contract.
  5. **Cache order unchanged** (ADR-0008: remote first, cache only on failure). Checking the cache first would serve stale enforce-mode config to every engineer, and nobody asked for that. Cache fallback (AC-3 / FR-7) and the T-013 binding are unchanged.
  6. Constraints carried into the ACs:
     - FR-10: never throws.
     - FR-11: one file, zero runtime deps, no new import.
     - No new `__internals` key.
     - AC-9: no secret, URL, host, setting value, header or body text in any log.
     - `smoke.ts` passes plugin codes through unchanged, so it needs no code change.

## Selected item

```json
{
  "id": "F-021",
  "title": "Plugin: classify Azure firewall / network-blocked failures in the remote fetch with an actionable log hint",
  "type": "feature",
  "priority": 1,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-020"
  ],
  "description": "USER requirement (cycle 0022, verbatim: 'my current KILO and Bifrost URL is running behind AZURE IP firewall, so we need to make sure that is validated before we fetch the URL as that will cause error'), plugin side. fetchRemoteConfig today reports 'network', 'timeout' or 'http-<status>', so a firewall / IP allow-list / corporate proxy block of the Azure DevOps fetch looks like an auth problem or a generic error. Cycle 0023 PO decisions (no human available): (1) NO unauthenticated probe in the plugin - it runs inside Kilo at every start, a probe would add a second round trip to every startup, and the authenticated fetch's own failure already carries the signal; the PAT / az token only ever goes to the fixed https://dev.azure.com/ host over TLS. Classification is done on the single existing authenticated fetch within the single existing timeoutMs budget, still exactly one fetch call per hook run. (2) New fixed, value-free FetchErrorCode values: 'network-unreachable' = the fetch() call itself rejects before the deadline (DNS, refused, reset, TLS). 'network-blocked' = HTTP 407 (proxy auth; Azure DevOps itself never answers 407) with any body, or HTTP 403 whose Content-Type is absent, unreadable or not JSON (media type before ';', trimmed, case-insensitive, is neither 'application/json' nor ends with '+json'), i.e. the HTML / plain-text page of a firewall, proxy, WAF or Front Door. Azure DevOps answers real permission failures with a JSON 403, which stays 'http-403'; 401 always stays 'http-401'. Decision is made from the status and the Content-Type header only; the body is never read or inspected (discarded unread exactly as today), so no response text can reach a log. 'timeout' is unchanged (a deadline is still 'timeout', also when fetch rejects after the deadline). 'network' remains the catch-all for a missing fetch, an unexpected internal throw and a body-stream failure after headers arrived (the connection was open, so not a firewall). (3) Config hook: the existing 'Remote config unavailable (<code>) ...' lines are unchanged in format; in addition exactly ONE fixed warn-level hint line is logged right after it: NETWORK hint for network-unreachable, network-blocked and timeout (a silently dropping firewall shows up as a timeout), e.g. 'Azure DevOps could not be reached from this network: connect to the corporate VPN or ask the platform team to allow your public IP, then restart Kilo.'; CREDENTIALS hint for http-401, http-403 and auth-unavailable, e.g. 'Azure DevOps rejected or lacks credentials: run az login or replace your PAT, and check your access to the shared config repository.'; no hint for any other code. Exact texts are pinned by the Architect in the plugin-interface contract and contain no values (no URL, host, org/project/repo, PAT, token, header or body). (4) Cache order unchanged (ADR-0008: remote first, cache only on failure) - a cache-first order would serve stale enforce-mode config and is not requested. Cache fallback (AC-3 / FR-7) and the T-013 / ADR-0018 settings binding are unchanged. (5) FR-10 never throws, FR-11 one TypeScript file with zero runtime deps and no new import, no new __internals key, AC-9 no secret in any log. The installer smoke (smoke.ts) passes plugin codes through unchanged, so 'smoke azdo: fail network-unreachable' / 'network-blocked' can appear only when the F-020 probe passed but the authenticated fetch failed; smoke.ts needs no code change. Scope: backend/plugin/azdo-remote-config.ts, backend/test/plugin/*, the e2e/smoke tests that pin the old 'network' text for a fetch rejection, plugin-interface contract (+ ADR or ADR-0007 amendment). User-facing docs are F-022.",
  "acceptance_criteria": [
    "Given a fake fetch whose call rejects (connection error) before the deadline, When fetchRemoteConfig runs with a PAT or az token, Then it resolves { ok: false, error: 'network-unreachable' }; and Given a fake fetch that never settles until a fake clock passes timeoutMs (or rejects after the deadline fired), Then the error is still 'timeout'; and Given no usable fetch function, an unexpected internal throw, or a body stream that fails after a 2xx status, Then the error is still 'network'.",
    "Given a fake fetch answering HTTP 407 (any Content-Type), or HTTP 403 with Content-Type absent, 'text/html; charset=utf-8', 'text/plain', or a headers.get that throws or returns a non-string, When fetchRemoteConfig runs, Then it resolves { ok: false, error: 'network-blocked' }, the body's getReader is never called and body.cancel is invoked (body discarded unread, as for any non-2xx).",
    "Given a fake fetch answering HTTP 403 with Content-Type 'application/json', 'Application/JSON; charset=utf-8' or 'application/problem+json', or HTTP 401 with any Content-Type (including text/html), When fetchRemoteConfig runs, Then the error is 'http-403' / 'http-401' respectively; and every other non-2xx status (e.g. 404, 500, 503) still yields 'http-<status>' exactly as before.",
    "Given the config hook and a fetch failure with code network-unreachable, network-blocked or timeout, When the hook runs, Then the existing 'Remote config unavailable (<code>) ...' line is logged unchanged in format followed by exactly one warn-level line equal to the fixed NETWORK hint constant (VPN / ask the platform team to allow your public IP); Given http-401, http-403 (JSON) or auth-unavailable, Then exactly one warn line equal to the fixed CREDENTIALS hint (az login / PAT / repository access) and no network hint; Given any other code (http-404, http-5xx, too-large, bad-response, network, invalid-settings, a validation error), Then no hint line is logged.",
    "Given a valid cache bound to the current settings (T-013) and a fetch failing with network-unreachable or network-blocked, When the hook runs, Then the cached config is merged exactly as before, the 'Remote config unavailable (<code>); using cached config.' warning and the NETWORK hint are logged, and the fake fetch was called exactly once (no extra probe request, remote-first order of ADR-0008 unchanged); Given a cache bound to different settings, Then it is not applied (cache-mismatch) and the config object is unchanged.",
    "Given failures whose fake response carries canary values in the body, in the Content-Type and other headers, and a PAT / az token canary, When the hook runs (including with throwing header getters and a throwing log sink), Then runConfigHook resolves without throwing and no log line contains the PAT, token, Authorization value, URL, host name, org/project/repo values, any header value or any body text.",
    "Given the plugin after the change, When the FR-11 lint and 'bash scripts/ci.sh' run, Then the plugin is still ONE TypeScript file with zero runtime npm dependencies and no new import, the __internals key set is unchanged, the installer smoke reports a plugin-side code verbatim (a reachable F-020 probe followed by a rejecting authenticated fetch gives 'smoke azdo: fail network-unreachable'), existing tests change only where a fetch rejection's code moved from 'network' to 'network-unreachable', and CI exits 0."
  ],
  "source": "user",
  "cycle_done": null,
  "notes": "Cycle 0022 PO: second slice of the Azure IP firewall requirement. Cycle 0023 PO: selected (priority raised to 1 as the remaining code slice of the active USER requirement; F-020 shipped in v0.15.0). Decisions recorded in the description: no plugin-side probe (startup latency at every Kilo start), classify the single authenticated fetch; 407 always and non-JSON 403 -> network-blocked, JSON 403 / 401 stay http-*; timeout keeps its code but gets the network hint; cache order unchanged. Known limitation to document (F-022): an Azure DevOps organisation IP conditional-access policy answers with JSON 401/403 and therefore shows the credentials hint, not the network hint; a TLS-inspecting corporate proxy that answers 403 with a JSON body would likewise read as http-403. Versioning: minor (feature)."
}
```

## Files changed
- `factory/backlog.json`:
  - F-021: status `in_progress`, priority 1, new description, 7 ACs and notes.
  - F-022: reduced description, 4 ACs and notes.
  - One `_notes` line appended.
- `factory/runs/cycle-0023/01-product-owner.md`: this report.

## Verification
- `factory/backlog.json` was rewritten through a JSON load/dump with indent 2, ASCII escapes and CRLF line endings. I checked beforehand that this round-trip reproduces the original file byte for byte.
- After the edit:
  - The file parses.
  - Exactly one item is `in_progress` (F-021, 7 ACs).
  - The existing `\ud800`, `\u0000` and `\ufeff` escapes are intact.
  - `git diff --stat` shows changes only to F-021, F-022 and `_notes`.
- F-021 depends only on F-020, which is `done`.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| - | - | - | None (PO phase). | - |

## Assumptions made (no human available)
- **No plugin-side probe.** It would add latency and traffic at every Kilo start and give little extra signal. The credential only goes to the fixed Azure DevOps host over TLS.
- **Content-Type alone decides whether a 403 is a block.** A 403 is treated as a firewall or proxy block only when it is not JSON. Azure DevOps API errors are JSON, so a real permission failure keeps `http-403`. Not reading the body avoids any leak or parsing risk.
- **Known limitations, documented in F-022:**
  - An Azure DevOps organisation IP conditional-access policy answers with a JSON 401/403. It therefore shows the credentials hint, not the network hint.
  - A TLS-inspecting proxy that sends a JSON 403 also reads as `http-403`.
- **`timeout` keeps its code but gets the network hint.** Firewalls that drop packets cause timeouts. Renaming the code would break existing behaviour for no gain.
- **`network` stays the catch-all** for a missing fetch, an internal throw or a body-stream failure. Only a rejection of the `fetch()` call itself becomes `network-unreachable`, which keeps changes to existing tests small and precise.
- **Cache-first rejected.** Checking the cache before the fetch would apply stale enforce-mode policy.
- **Versioning:** minor (feature), giving v0.16.0.

## Follow-ups for the backlog
- F-022 (priority 2): plugin-side docs, next cycle.
- T-032 (priority 4): F-020 test follow-ups, already queued.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0023/01-product-owner.md
summary: Selected F-021 (plugin-side firewall classification: network-unreachable / network-blocked for 407 and non-JSON 403, fixed VPN vs credentials hint lines, no probe, cache order and binding unchanged), 7 ACs; F-022 reduced to plugin-side docs.
