# Product Owner report — cycle 0024 — T-035: Firewall hint on the authenticated smoke lines and Azure Firewall HTTP 470 classified as blocked

## Inputs read
- `factory/VISION.md`, `factory/backlog.json`, `factory/state.json` (cycle 24, last release v0.16.0)
- `CHANGELOG.md` (v0.14.1 .. v0.16.0)
- `factory/runs/cycle-0022/*` (F-020) and `factory/runs/cycle-0023/*` (F-021 / F-022): follow-ups from the architect, security, review, PR and docs reports
- `backend/installer/smoke.ts` (`classifyProbeStatus`, `checkBifrost`, `formatSmoke` / `hasNetworkCondition`), `docs/architecture/contracts/installer-cli.md` section 9.1, `docs/troubleshooting.md` (network-blocked section)
- Web search on the Azure Firewall HTTP 470 deny. Only community sources exist, and no Microsoft documentation was found: a gist (https://gist.github.com/weltonrodrigo/be8cd941d8825ddcb5031e4017ecb399) and http.dev (https://http.dev/470).

## Work done
- The vision is defined: `VISION_TEMPLATE_UNCHANGED` is absent.
- **Is another cycle needed?** I checked the user's scenario: an engineer who is off the VPN or whose IP is not allow-listed, with Kilo and Bifrost behind the Azure IP firewall. Two places still give a confusing result, and both are small and code-only.
  1. **Smoke hint gap.** The installer prints its VPN / allow-list hint only when the anonymous pre-flight fails. In one case it prints no hint:
     - the origin probe passes, but
     - the authenticated request then fails for a network reason, for example a WAF or path rule, or a drop on the API path.

     The output is then `smoke network: pass` followed by `smoke azdo: fail network-unreachable|network-blocked|timeout` or `smoke bifrost: fail network|timeout|407`, with no hint. Installer-cli 1.3.1 section 9.1 states this behaviour explicitly. It is exactly the "network said pass, but it is still a network problem" confusion.
  2. **HTTP 470.** Azure Firewall reports an application-rule deny as HTTP 470. The probe currently treats 470 as *reachable*, so the PAT, az token or virtual key is then **sent**, and the result is shown as `http-470` / `470` with no hint. This affects engineers whose egress goes through Azure Firewall (AVD, Dev Box, forced-tunnel VPN). Azure DevOps and Bifrost never answer 470 themselves, so treating it as blocked has no realistic false positive. That is why real-environment evidence is not needed here. The 470 behaviour itself is only community-reported.
- **Not selected, with reasons.**
  - **Kilo's runtime model calls to Bifrost.** The plugin does not control these calls. A Bifrost check in the plugin at every Kilo start would be a new design, adding a startup request each time, and plugin log lines may not be visible to the engineer. It goes on the later list.
  - **203 HTML sign-in page.** This needs real-environment evidence.
  - **T-032 and T-033.** These are test nits only.
- **Grooming**
  - **T-034 split.** The code-only parts (470, smoke hint) became the new **T-035** (priority 2, source `user`). T-034 is reduced to the 203 HTML sign-in case: priority 5, needs evidence.
  - Added a `_notes` entry for cycle 0024.
  - F-012, F-013 and F-015 stay blocked/SKIPPED by user decision: not selected, split or unblocked. Remote mode stays OFF.
  - Nothing has failed in 2 or more cycles, so nothing new is blocked.
- **Selected: T-035**, set to `in_progress`. It depends on F-020 and F-021, both done.

```json
{
  "id": "T-035",
  "title": "Firewall hint on the authenticated smoke lines and Azure Firewall HTTP 470 classified as blocked",
  "type": "tech-debt",
  "priority": 2,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-020",
    "F-021"
  ],
  "description": "Cycle 0024 PO, split from T-034 (code-only parts), for the USER's Azure IP firewall scenario. Two remaining gaps where an engineer who is off the VPN or not allow-listed still gets a confusing installer/plugin result. (A) The installer smoke test prints its fixed VPN / allow-list hint only when the anonymous pre-flight fails ('smoke network: fail ...'). When the origin probe passes but the authenticated request then fails for a network reason (a WAF / path rule or a drop on the API path, a proxy), the output is 'smoke network: pass' followed by 'smoke azdo: fail network-unreachable|network-blocked|timeout' or 'smoke bifrost: fail network|timeout|407|470' with NO hint (installer-cli 1.3.1 section 9.1 says these codes do not add the hint). Change formatSmoke so the SAME fixed network hint line (installer-cli section 7, text unchanged) is also printed for those authenticated-line codes, at most once per run. Bifrost 401/403/other statuses stay hint-free (key / permission problems, see troubleshooting 'Bifrost 401'). (B) Azure Firewall answers an application-rule deny (no rule matched; for HTTPS only with TLS inspection) with the non-standard HTTP 470 'Action: Deny' body (community-reported, not in Microsoft docs; relevant when an engineer's egress goes through Azure Firewall, e.g. Azure Virtual Desktop / Dev Box / forced-tunnel VPN). Today the installer probe treats 470 as reachable, so the PAT / az token / virtual key is then SENT, and the result reads 'smoke azdo: fail http-470' / 'smoke bifrost: fail 470' with no hint; the plugin logs 'http-470' with no hint. 470 is not a status Azure DevOps or Bifrost answer, so classifying it as a block has no realistic false positive: classifyProbeStatus(470) -> blocked (credential never sent, network line azdo-blocked / bifrost-blocked); the plugin fetch maps HTTP 470 (any Content-Type, body discarded unread) to network-blocked with the existing NETWORK hint. Out of scope (later items, not this cycle): 203 HTML sign-in (T-034, needs evidence); a plugin-side Bifrost reachability check at Kilo start (Kilo's own runtime model calls to Bifrost are not controlled by the plugin; documented limitation). Constraints: FR-10 never throws; FR-11 one plugin file, zero runtime deps, no new import, __internals key set unchanged; no secret or value in any log or output line; exactly one fetch per plugin hook run (no new probe); cache order (ADR-0008) and T-013 binding unchanged; hint texts unchanged. Contracts: installer-cli minor bump (sections 7 / 9.0 / 9.1: hint rule and 470 verdict), plugin-interface minor bump (470 row), ADR-0019 / ADR-0020 amendments. Docs (docs-writer): troubleshooting / runbook rows for 470 and the new hint behaviour. Versioning: patch (fix of user-facing diagnostics).",
  "acceptance_criteria": [
    "Given a smoke report with network pass and azdo 'fail network-unreachable', 'fail network-blocked' or 'fail timeout', When formatSmoke runs, Then the output is the network line, the azdo line, the bifrost line and then exactly one line equal to the existing fixed VPN / allow-list hint (installer-cli section 7 text, unchanged); and Given azdo fails with http-401, http-403, http-404, auth-unavailable, invalid-settings, network or bad-response, Then no network hint line is printed.",
    "Given a smoke report with network pass, azdo pass and bifrost 'fail network', 'fail timeout', 'fail 407' or 'fail 470', When formatSmoke runs, Then exactly one network hint line is printed; and Given bifrost 'fail 401', 'fail 403', 'fail 404', 'fail 500', 'fail bad-response', 'fail invalid-key' or any skipped code, Then no network hint line is printed.",
    "Given a report with both a failed pre-flight (network fail with a non-internal code) and a qualifying authenticated-line code, When formatSmoke runs, Then the network hint appears exactly once and the existing no-key hint behaviour is unchanged; and Given network fail with only 'internal', Then no network hint is printed (unchanged).",
    "Given a fake probe fetch answering HTTP 470 for the Azure DevOps origin (or the Bifrost origin), When runSmoke runs, Then the network line reads 'smoke network: fail azdo-blocked' (or 'bifrost-blocked'), the corresponding check is 'skipped network-blocked', the authenticated fetch / az runner (or the GET models request) is never called so no credential or key is sent, and the installer exits with code 4; and classifyProbeStatus(470) returns 'blocked' while 200, 301, 401 and 404 stay 'reachable'.",
    "Given a fake plugin fetch answering HTTP 470 with any Content-Type (text/plain, text/html, application/json, absent), When fetchRemoteConfig runs, Then it resolves { ok: false, error: 'network-blocked' }, the body's getReader is never called and body.cancel is invoked; and Given the config hook with that failure, Then the unchanged 'Remote config unavailable (network-blocked) ...' line is followed by exactly one NETWORK hint line, the fake fetch was called exactly once, and a valid bound cache is still applied as before.",
    "Given failure responses carrying canary values in body and headers plus PAT / az token / virtual-key canaries, When runSmoke and the config hook run, Then no output or log line contains any credential, URL, host name, org/project/repo value, header value or body text, and neither function throws.",
    "Given the change, When the FR-11 lint and 'bash scripts/ci.sh' run, Then the plugin is still ONE TypeScript file with zero runtime npm dependencies and no new import, the __internals key set is unchanged, existing tests change only where they pinned the old no-hint / http-470 behaviour, and CI exits 0."
  ],
  "source": "user",
  "cycle_done": null,
  "notes": "Cycle 0024 PO: selected. Justification: the user's scenario is engineers behind an Azure IP firewall; these are the last code-only places where a firewall / VPN problem still shows without the actionable hint, or (470) where a credential is sent after a firewall deny. Small, hermetic, no real environment needed."
}
```

## Files changed
- `factory/backlog.json`:
  - added T-035 (`in_progress`)
  - reduced T-034 to the 203 HTML case (priority 5)
  - added a `_notes` entry for cycle 0024

  The file is still pure ASCII. Its existing `\u` escapes are preserved.

## Verification
- `factory/backlog.json` parses as JSON, and T-035 is the only `in_progress` item.
- The diff touches only T-034, the new T-035 and `_notes`.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | `backend/installer/smoke.ts:329` | `classifyProbeStatus` treats Azure Firewall's 470 deny as reachable, so a credential is sent after a firewall deny. | T-035 AC-4 |
| 2 | info | `backend/installer/smoke.ts:508` | The network hint is tied to a failed pre-flight only. | T-035 AC-1..3 |

## Assumptions made (no human available)
- **470 is classified without real-environment evidence.** The status is non-standard, and neither Azure DevOps nor Bifrost emits it, so the false-positive risk is negligible. The benefit is that the credential is no longer sent after a deny.
- **Bifrost `fail 403` stays hint-free.** An authenticated 403 from Bifrost is more likely a key or permission problem, and the troubleshooting guide already explains the curl self-check for that case.
- **Versioning: patch.** This fixes user-facing diagnostics; it does not add a new capability.
- **The hint text is reused unchanged.** No new constants are needed.

## Follow-ups for the backlog
Worthwhile later items, in order:
1. T-031 AC2: confirm on Linux CI that the 5 POSIX symlink/race tests pass.
2. T-029: check whether a Kilo project config can override the global plugin options. This needs real Kilo.
3. T-025: check the branch-policy semantics in a real org.
4. T-034: the 203 HTML sign-in case. This needs evidence.
5. A later design item, possibly: an opt-in Bifrost reachability note at Kilo start.
6. T-032 and T-033: test nits.
7. The remaining tech-debt items at priority 4-5.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0024/01-product-owner.md
summary: Selected T-035 (split from T-034): add the VPN/allow-list hint to the authenticated smoke lines and treat Azure Firewall HTTP 470 as blocked; backend-only, 7 ACs, patch.
