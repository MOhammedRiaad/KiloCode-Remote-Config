# Product Owner report — cycle 0022 — F-020: Installer smoke test: network pre-flight for Azure IP firewall / VPN before any credential is sent

## Inputs read
- `factory/VISION.md` (filled in; no template marker)
- `factory/backlog.json`, `factory/state.json` (cycle 22, last release v0.14.2)
- `factory/runs/cycle-0021/01-product-owner.md` (factory DONE summary)
- `backend/installer/smoke.ts` (smoke codes, `formatSmoke`, `smokeFailed`), `backend/plugin/azdo-remote-config.ts` (`FetchErrorCode`, fixed `https://dev.azure.com/` host)
- New USER requirement (verbatim): "my current KILO and Byfrost URL is running behind AZURE IP firewall, so we need to make sure that is validated before we fetch the URL as that will cause error"

## Work done
- Reopened the factory after the user's new requirement. User directives outrank the existing backlog order.
- Split the requirement into three vertical slices, all with `source: "user"`:
  - **F-020** (priority 1, **in_progress**): an installer smoke-test network pre-flight that runs before any credential is sent. Applies to both URLs, AzDO and Bifrost.
  - **F-021** (priority 2, todo, depends on F-020): the plugin's fetch classifies firewall-blocked and network-unreachable failures and logs a fixed hint for each.
  - **F-022** (priority 2, todo, depends on F-020 and F-021): troubleshooting, platform runbook (allow-listing, VPN) and engineer-setup prerequisites.
- Added `user` to `_schema.source` and added a cycle-0022 note to `_notes`.
- Did not touch F-012, F-013 or F-015 (SKIPPED). Remote mode stays OFF. The shared-config validator `--allowed-hosts` is out of scope.

Selected item (copy verbatim):

```json
{
  "id": "F-020",
  "title": "Installer smoke test: network pre-flight for Azure IP firewall / VPN before any credential is sent",
  "type": "feature",
  "priority": 1,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-019",
    "F-011"
  ],
  "description": "USER requirement (cycle 0022): the Bifrost gateway (and possibly other Kilo-facing endpoints) sit behind an Azure IP firewall / IP allow-list. An engineer who is not on the VPN or whose public IP is not allow-listed today gets a confusing smoke failure (timeout, reset, or HTTP 403 that reads like a bad key) and the virtual key / AzDO credential is sent anyway. Add a pre-flight 'network' check to backend/installer/smoke.ts (shared by install.sh and install.ps1) that runs BEFORE the authenticated Azure DevOps fetch and BEFORE GET <baseURL>/models: one unauthenticated, bounded HTTPS probe per target (the fixed Azure DevOps host https://dev.azure.com/ and the origin of the validated https Bifrost baseURL). Classification (fixed, value-free codes): HTTP 403 or 407 -> '<target>-blocked'; network error (DNS, refused, reset, TLS) -> '<target>-unreachable'; deadline -> '<target>-timeout'; any other HTTP status (2xx, 3xx, 401, 404, 5xx...) -> reachable (rationale: an allowed client that sends no credentials normally gets 401/404/redirect, whereas an Azure firewall / Front Door / App Service access restriction answers 403 or drops the connection). target is 'azdo' or 'bifrost'. When a target fails the probe, its authenticated check is skipped with code 'network-blocked' and the credential for it is never sent. Output adds a first line 'smoke network: pass' or 'smoke network: fail <code>[,<code>]' and, on failure, one fixed hint line: connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run <front end>. Exit code stays 4 when the network check fails. No new runtime dependencies; plugin file untouched; tests use injected fake fetch / clock only (never real network, az, or home).",
  "acceptance_criteria": [
    "Given a fake fetch where the unauthenticated probes of https://dev.azure.com/ and of the Bifrost baseURL origin answer with a non-403/407 HTTP status (e.g. 200, 302, 401, 404), When runSmoke runs, Then report.network is pass, formatSmoke prints 'smoke network: pass' as the first line, and the azdo and bifrost authenticated checks run and are reported exactly as before.",
    "Given a fake fetch whose probe of the Bifrost origin answers HTTP 403, When runSmoke runs, Then the network line is 'smoke network: fail bifrost-blocked', bifrost is 'skipped network-blocked', the fake records no request to <baseURL>/models and no request carrying the virtual key, the fixed VPN / IP allow-list hint line naming the front end is printed, and smokeFailed returns true (installer exit code 4).",
    "Given a fake fetch whose probe of https://dev.azure.com/ rejects with a network error, or never settles until a fake clock passes timeoutMs, When runSmoke runs, Then the network code is 'azdo-unreachable' or 'azdo-timeout' respectively, the fake az runner is never invoked, no PAT or bearer token is sent, azdo is 'skipped network-blocked', and runSmoke resolves (never hangs, never rejects).",
    "Given any probe, When the fake fetch records it, Then it is a GET (or HEAD) to an https: origin only (no path beyond '/', no query), with redirect 'manual', an AbortSignal, no body, and no Authorization, api-key, x-api-key or Cookie header.",
    "Given a missing, invalid or non-https baseURL, or no key / a key reference, When runSmoke runs, Then the Bifrost probe is not sent and the existing bifrost codes (no-base-url, invalid-base-url, insecure-base-url, no-key, key-reference) are reported unchanged; and Given --no-smoke, Then no probe or other network call is made.",
    "Given any probe outcome (including a probe response whose body contains a key-like or HTML string, or an internal exception), When the report is formatted, Then every printed line comes from the fixed code set and contains no key, PAT, token, baseURL, host name or response body text; an internal error yields 'smoke network: fail internal' instead of a throw.",
    "Given the same blocked fake for front ends 'install.sh' and 'install.ps1', When formatSmoke runs, Then both produce identical network and hint lines except the front-end name, and all existing smoke, installer and e2e tests still pass with 'bash scripts/ci.sh' exiting 0."
  ],
  "source": "user",
  "cycle_done": null,
  "notes": "Cycle 0022 PO: selected first because it is the literal 'validate before we fetch the URL' request for both URLs (AzDO + Bifrost) and it stops the key being sent to a host that will reject it. Plugin-side classification is F-021, docs F-022."
}
```

## Files changed
- `factory/backlog.json`: added F-020 (in_progress), F-021 and F-022. Added `user` to the schema `source` values and added one `_notes` entry. The file is still valid ASCII JSON with CRLF line endings, and the existing escaped surrogates are unchanged.
- `factory/runs/cycle-0022/01-product-owner.md`: this report.

## Verification
- `python -c "json.load(...)"`: the backlog parses. Exactly one item is `in_progress` (F-020). Every byte is ASCII.
- `git diff --stat factory/backlog.json`: 81 insertions, 2 deletions. The 2 deletions are the schema `source` line and the trailing comma of the last `_notes` entry. Nothing else was rewritten.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| - | - | - | None. The PO grooms the backlog and does not gate. | - |

## Assumptions made (no human available)
- "KILO URL" means the Azure DevOps shared-config host that Kilo's plugin fetches from, and possibly other Kilo-facing endpoints. "Byfrost URL" means the Bifrost `baseURL`. Both may sit behind an Azure IP firewall or allow-list, or need the VPN.
- F-020 goes first because the installer smoke test is the only place the product itself calls both URLs, and today it sends the virtual key before knowing the host is reachable. At Kilo runtime the Bifrost calls are made by Kilo, not by us (forking Kilo is a non-goal), so the plugin slice (F-021) only covers the AzDO fetch.
- How a blocked request is classified: an unauthenticated probe that gets HTTP 403 or 407 means blocked (Azure Firewall, Front Door WAF and App Service access restrictions answer 403 or drop the connection). A connection error means unreachable. A deadline means timeout. Any other status means reachable, because an allowed client with no credentials normally gets 401, 404 or a redirect. The Architect may refine this but must keep codes fixed and value-free.
- The probe sends no credentials, uses https only, goes to the origin only, does not follow redirects, and runs inside the existing timeout budget. That means it adds no hang risk and cannot leak secrets.
- The PO does not add any unauthenticated probe in the plugin on every Kilo start. That would add startup latency for ~100 engineers, so the Architect decides it in F-021.
- Azure DevOps conditional-access IP policies are enforced after authentication and look like auth failures. F-022 documents them rather than detecting them.
- F-018 was never used, so the new IDs start at F-020 to avoid confusion with any earlier reference.

## Follow-ups for the backlog
- F-021 (priority 2): plugin-side network classification and log hint.
- F-022 (priority 2): firewall and VPN documentation and allow-listing runbook.
- Earlier open items keep their priorities. T-031 AC2 (Linux CI confirmation) still needs a GitHub CI run.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0022/01-product-owner.md
summary: Factory reopened for the user's Azure IP firewall requirement; F-020 (installer smoke network pre-flight before any credential is sent) selected, F-021 (plugin classification) and F-022 (docs/runbook) queued.
