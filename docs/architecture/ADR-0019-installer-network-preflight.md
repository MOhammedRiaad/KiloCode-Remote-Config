# ADR-0019: Installer smoke test network pre-flight (Azure IP firewall / VPN) before any credential is sent
- Status: accepted; amended by A1 (cycle-0024, T-035: probe 470 -> blocked; network hint after
  qualifying authenticated-line codes)
- Date: 2026-11-01
- Cycle / item: cycle-0022 / F-020
- Amends: ADR-0013 (smoke test), contract `installer-cli.md` 1.2.1 -> 1.3.0 (section 9),
  test contract `e2e-harness.md` 1.0.1 -> 1.1.0 (fake-network `azdoProbe` / `bifrostProbe` answers)

## Context

USER requirement (cycle 0022): "my current KILO and Bifrost URL is running behind AZURE IP
firewall, so we need to make sure that is validated before we fetch the URL as that will cause
error". Today the installer smoke test (ADR-0013) sends the AzDO PAT / az token and the Bifrost
virtual key straight away. An engineer who is off the VPN or whose public IP is not on the
allow-list sees `fail timeout`, `fail network`, `fail 403` or `fail http-403`, which looks like a
bad key or PAT. The credential has also already gone to whatever answered (a WAF or proxy that
terminates TLS can see it).

Constraints: the smoke logic stays in `backend/installer/smoke.ts`, which both front ends share
through `install-helper.ts`. The helper only prints and exits, and it does not change. There are
no new runtime dependencies, no new product switch (FR-11 lint rules 6 and 7), and the plugin
file and its `__internals` stay unchanged. Tests use the F-019 fake-network preload and injected
`fetch` / clock only.

### What a blocked client actually gets from Azure (why the classification looks like this)

| Control in front of the host | What an unauthenticated client that is NOT allowed gets |
|---|---|
| Front Door WAF custom rule (IP match, Block) | HTTP 403 by default, body "The request is blocked." The status is configurable per policy (200/403/405/406/429). |
| Application Gateway WAF v2 (IP custom rule / managed rule) | HTTP 403, body "403 Forbidden ... Microsoft-Azure-Application-Gateway/v2". |
| App Service / Functions / Container Apps access restrictions, public access disabled | HTTP 403 ("Ip Forbidden" / "Forbidden" page). |
| API Management `ip-filter` policy | HTTP 403 "Caller IP address ... is not allowed", **but only** on a matched API operation. APIM checks the subscription key first (401). An unmatched path such as `/` gets 404 before any policy runs. |
| Azure Firewall DNAT with no matching rule, NSG deny, private endpoint without a route | Silent drop, so the client sees a **timeout**. |
| Azure Firewall application rule deny (egress side), reset by a proxy | Connection reset or TLS failure, so the client sees a **network error**. |
| Private / split-horizon DNS name (`*.internal`, privatelink) used off the VPN | DNS failure (`ENOTFOUND`), so the client sees a **network error**. |
| Corporate TLS-intercepting proxy with a CA that Node does not trust | TLS error, so the client sees a **network error**. |
| Transparent forward proxy that needs authentication | HTTP 407. Node's built-in `fetch` uses no proxy by default. With an env proxy, a failed CONNECT surfaces as a thrown error. So a 407 status is rare, but it is never a valid origin answer. |
| Azure DevOps organisation IP conditional-access policy | Enforced **after** authentication on the authenticated request (401/403-like). Not visible to an anonymous probe. F-021 classifies it and F-022 documents it. |
| The allowed app itself, with no credentials | Bifrost / AzDO: 200 (UI or landing page), 302 (sign-in or marketing redirect), 401, 404. |

## Decision

### 1. One unauthenticated probe per target, sent before that target's authenticated request

Order inside `runSmoke` (sequential, because the Bifrost origin is only known after the AzDO
fetch):

1. `settings = resolveSettings(values, { env })` (pure; also gives `timeoutMs`).
2. **AzDO probe** of the constant `https://dev.azure.com/`. If it is not `reachable`:
   azdo = `skipped network-blocked`, bifrost = `skipped azdo-failed`. `fetchRemoteConfig` is
   **not** called, so no PAT is read into a header and `az` is never run.
3. Otherwise the existing azdo check (ADR-0013 section 3, unchanged).
4. The existing bifrost rows 1-7 (azdo-failed, no-base-url, invalid-base-url, insecure-base-url,
   no-key, key-reference, invalid-key). These send nothing. A Bifrost probe is sent **only** when
   the authenticated request would otherwise follow (AC-5).
5. **Bifrost probe** of `new URL(modelsUrl).origin + "/"`. If it is not `reachable`:
   bifrost = `skipped network-blocked`, and the key is never sent.
6. Otherwise the existing `GET <baseURL>/models` (unchanged).

A target that is not probed (azdo not reachable, or a bifrost row 1-7 matched) adds no network
code.

### 2. Probe request (exact)

`fetch(<origin>/, { method: "GET", headers: {}, redirect: "manual", signal })`

- Method: **GET, not HEAD**. WAF and access-restriction rules are evaluated the same way as for
  the real check, which is also a GET. Some WAF method allow-lists, APIM and older servers answer
  HEAD with 405 or treat it differently. The fake-network fixture and the injected fake already
  route GETs. The body is never read: it is cancelled as soon as the status is known.
- URL: the **origin only** (`https://dev.azure.com/`, `https://<bifrost host[:port]>/`). There is
  no path beyond `/`, no query and no fragment. A path-routed gateway answers `/` with 404 or a
  UI, which counts as reachable. Probing the real API path without credentials invites
  app-level 401/403 semantics and so more false positives.
- Headers: an **empty** object. The product adds no `Authorization`, `api-key`, `x-api-key`,
  `Cookie` or `Accept` header. Node's fetch adds only its defaults (user-agent, accept,
  accept-encoding, ...). There is no body.
- `redirect: "manual"`: a redirect is never followed, and a 3xx status counts as reachable.
- Fetch function: the injected `deps.fetch` when it is an own property, else `globalThis.fetch`
  read at call time (same rule as the Bifrost check). If the injected value is not a function,
  the verdict is `internal` and the real fetch is not used.

### 3. Classification (fixed, value-free)

| Probe outcome | Verdict | Network code |
|---|---|---|
| Resolves with an integer status 100-599 other than 403 / 407 / 470 (A1) | `reachable` | (none) |
| Resolves with status 403 or 407, or 470 (since A1) | `blocked` | `<target>-blocked` |
| Resolves with something that has no integer status 100-599 | `unreachable` | `<target>-unreachable` |
| Rejects or throws before the deadline (DNS, refused, reset, TLS, deny-all fake) | `unreachable` | `<target>-unreachable` |
| Deadline reached (abort), or a rejection after the deadline fired | `timeout` | `<target>-timeout` |
| Unexpected exception in the probe code itself, or a non-function injected fetch | `internal` | `internal` |

`<target>` is `azdo` or `bifrost`. Every verdict except `reachable` withholds that target's
credential (conservative: when in doubt, do not send).

**False-positive / false-negative risk (accepted, documented by F-022):**
- False positive (allowed client classified `bifrost-blocked`): this happens only if the Bifrost
  origin `/` itself answers 403 to anonymous requests (for example, a WAF rule that demands a
  header). Effect: the key is **not** sent, smoke exits 4, and the hint is misleading.
  Nothing leaks and the installation is kept. F-022 adds to the platform runbook: "`/` on the
  Bifrost origin must not answer 403 to allowed clients (404, 401, 200 or 3xx are fine)", and to
  troubleshooting: "verify with `curl -s -o /dev/null -w '%{http_code}' https://<origin>/`". The
  engineer's way out is `--no-smoke` / `-NoSmoke`. We add no override switch (no new product
  switches). For AzDO, `https://dev.azure.com/` answers anonymous clients with a redirect or a
  landing page, so the false-positive risk there is negligible.
- False negative (blocked client classified `reachable`): a WAF block status configured to
  something other than 403, an APIM `ip-filter` that only applies to matched operations, or a
  per-path WAF policy. Effect: the authenticated request is sent as before F-020 and fails with
  its existing code (`fail 403`, `fail 429`, `http-403`, ...). This is no worse than today. F-021
  and F-022 cover reading those codes.
- **Hard skip, not warn**: the user asked to validate *before* the URL is fetched. Sending the key
  after a `blocked` verdict would only produce the confusing error the user complained about and
  hand the key to an intermediary. A failed network check is a `fail`, so the smoke run exits 4,
  consistent with "installed, but the environment is not working yet".

### 4. Timing

- Each probe has its own AbortController and **one deadline of `timeoutMs`**
  (`KILO_AZDO_TIMEOUT_MS`, default 5000 ms; same resolution as ADR-0013). This reuses
  `startDeadline` from `smoke.ts`. The timer is always cleared. A response that arrives after the
  deadline has its body cancelled.
- The probes are sequential (the Bifrost origin comes from the AzDO result). Worst case is four
  deadlines (probe, items, probe, models), about `4 x timeoutMs`. A blocked target skips the
  rest, so a blocked AzDO costs at most one deadline. That is faster than today's hang-then-fail.
  Contract section 9.3 changes the time bound from `2 x` to `4 x timeoutMs`.
- We considered a shared deadline for both probes and rejected it: the two probes are separated by
  the authenticated AzDO fetch, so a shared budget would couple unrelated waits.

### 5. Report and output

```ts
export type NetworkCode =
  | "azdo-blocked" | "azdo-unreachable" | "azdo-timeout"
  | "bifrost-blocked" | "bifrost-unreachable" | "bifrost-timeout"
  | "internal";
export type NetworkOutcome = { status: "pass" } | { status: "fail"; codes: NetworkCode[] };
export interface SmokeReport { network: NetworkOutcome; azdo: SmokeOutcome; bifrost: SmokeOutcome }
// SmokeOutcome "skipped" code union gains "network-blocked".
```

`codes` is de-duplicated and in the order azdo, then bifrost, then `internal`. In practice it
holds one code: a failed AzDO probe means no Bifrost probe is sent.

`formatSmoke(report, frontEnd)` lines, in this order:
1. `smoke network: pass` or `smoke network: fail <code>[,<code>]` (comma, no space). This is
   **always the first smoke line**.
2. `smoke azdo: ...`, 3. `smoke bifrost: ...` (unchanged format).
4. The no-key hint (unchanged, only after `smoke bifrost: skipped no-key`).
5. Network hint, only when `network.status === "fail"` and at least one code is not `internal`
   (since A1 also after a qualifying authenticated-line code, at most once):
   `Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run <frontEnd>.`

Lines 4 and 5 cannot appear together in a `runSmoke` report (a blocked Bifrost probe means
bifrost is not `no-key`; since A1 a qualifying bifrost code is a `fail`, not `skipped no-key`).
No line contains a host name, URL, key, PAT, token, status text, error text or body.
`smokeFailed(report)` is true when `network`, `azdo` or `bifrost` has `status: "fail"`.
`runSmoke` still never rejects. Its last-resort catch returns
`{ network: fail [internal], azdo: fail internal, bifrost: skipped azdo-failed }`.

`install-helper.ts`, `install.sh` and `install.ps1` do not change (the helper already prints
every `formatSmoke` line and maps `smokeFailed` to exit 4). With `--no-smoke` / `-NoSmoke`,
`runSmoke` is never called, so there is no probe and no network line.

### 6. Test seam

- Unit tests (`smoke.test.ts`): the injected `fetch` sees the probe calls (URL `https://dev.azure.com/`
  or `https://<host>/`) and answers by URL. The clock and `KILO_AZDO_TIMEOUT_MS` are used as today.
- Child-process tests: `fake-network.ts` gains two **optional** scenario keys, `azdoProbe` and
  `bifrostProbe` (any `FakeAnswer`). A request whose URL parses with `pathname === "/"`, empty
  `search` and empty `hash` uses `azdoProbe` (dev.azure.com prefix) or `bifrostProbe` (any
  other host) **when that key is present**. Otherwise it falls back to the existing `azdo` /
  `bifrost` answer, so a host that hangs or throws also does so for the probe, which is
  realistic. Deny-all and logging are unchanged, and the existing variants behave byte for byte
  as before. The `auth` answer gives 401 to the credential-less probe, which counts as reachable.
  So the e2e T6 scenarios keep passing without changes, and every probe is logged with its
  (absent) authorization header.
- No product switch, nothing in `backend/installer/*` mentions the fixture (lint rule 7), and no
  new imports (lint rule 6).

## Consequences

- An off-VPN or non-allow-listed engineer gets `smoke network: fail bifrost-blocked` (or
  `-unreachable` / `-timeout`) plus an actionable hint, and their key and PAT are never sent to
  the blocking intermediary.
- Up to two extra anonymous HTTPS GETs per smoke run. They are visible in WAF and Front Door logs
  as requests to `/` (F-022 tells the platform team to expect them).
- Each target's request count in the fake-network log grows by one, so existing tests that count
  or index requests must be updated (rework list in the F-020 architect report). Assertions are
  made stricter, never weaker: probes must carry no credential header.
- F-021 (plugin) can reuse the classification table and code vocabulary (`blocked` /
  `unreachable` / `timeout`) for log hints. The plugin does not probe on every Kilo start; it
  classifies its own authenticated fetch failures instead. That is decided in F-021.

## Alternatives considered

- **HEAD probe**: more WAF and APIM edge cases (405, method allow-lists), and the fixture would need
  a special case. Rejected.
- **Probe the exact `<baseURL>/models` without a key**: app-level 401/403 for a missing key is
  common (several gateways answer 403), which would raise the false-positive rate. Rejected.
- **TCP-only / DNS-only reachability check (`node:net`, `node:dns`)**: misses L7 403 blocks, needs
  new imports in the installer (lint rule 6), and cannot be faked by the fetch preload. Rejected.
- **Warn-only verdict (send the key anyway)**: does not meet "validate before we fetch" and still
  hands the key to the blocking intermediary. Rejected.
- **Parallel probes**: impossible for Bifrost (origin known only after the AzDO fetch). Rejected.
- **Override switch (`--skip-network-check`, env var)**: a new product switch. `--no-smoke`
  already covers the escape hatch. Rejected.
- **Classify 401 as blocked**: an allowed client without credentials normally gets 401 (AzDO,
  Bifrost governance, APIM subscription), so this would give mass false positives. Rejected.

## Amendment A1 (cycle-0024, T-035): probe 470 is `blocked`; network hint on authenticated lines

Contract: `installer-cli.md` 1.3.1 -> 1.3.2 (sections 7, 9.0, 9.1, 9.2, new 9.4). Plugin side:
ADR-0020 amendment A1. Patch release. No new input, line, code, hint text or exit code; no new
export from `smoke.ts`.

### A1.1 Probe status 470 -> `blocked`

```ts
export function classifyProbeStatus(status: number | undefined): "reachable" | "blocked" | "unreachable" {
  if (status === undefined) return "unreachable";
  return status === 403 || status === 407 || status === 470 ? "blocked" : "reachable";
}
```

Azure Firewall answers an application-rule deny (no rule matched; HTTP, or HTTPS with TLS
inspection) with the non-standard HTTP 470 and an `Action: Deny` text body. This is
community-reported only (unofficial sources: a public GitHub gist and the http.dev status
reference), not Microsoft-documented. It matters for engineers whose egress goes through Azure
Firewall (Azure Virtual Desktop, Dev Box, forced-tunnel VPN). Before A1 a 470 probe answer was
`reachable`, so the PAT / az token / virtual key was then **sent** through the denying firewall
and the result read `fail http-470` / `fail 470` with no hint. Now the target's credential is
withheld, the line is `skipped network-blocked`, the network line is `fail azdo-blocked` /
`fail bifrost-blocked`, the hint is printed and the run exits 4. False-positive risk is
negligible: 470 is not IANA-registered, `https://dev.azure.com/` never answers it, and a Bifrost
origin answering 470 to an allowed client is not a realistic configuration; the effect of one
would be the same as the documented 403 false positive (key withheld, `--no-smoke` escape
hatch). If the community report is wrong, nothing changes.

### A1.2 Network hint also after a qualifying authenticated-line code

Problem: with a reachable origin probe but a network-type failure on the authenticated request
(WAF / path rule on the API path, drop on the API path, proxy), the output was
`smoke network: pass` + `smoke azdo: fail network-blocked` (or `bifrost: fail 407`) with no
actionable hint: "network said pass, but it is still a network problem".

Decision (normative table in installer-cli 9.4): the section 7 hint (text unchanged) is printed
at most once, as the last line, when N1 (unchanged pre-flight rule) **or** N2 (azdo `fail`
with exactly `network-unreachable`, `network-blocked` or `timeout`, the plugin's network codes,
same set as the plugin's L-HINT-NETWORK) **or** N3 (bifrost `fail` with exactly `network`,
`timeout`, `407` or `470`) holds. Not for azdo `network` (plugin catch-all, not a network-path
symptom, consistent with ADR-0020 section 4), nor for any `http-*`, `auth-unavailable`,
`invalid-settings`, `bad-response`, nor for bifrost `401` / `403` / other statuses /
`bad-response` / `invalid-key`, nor for any `skipped` code. Bifrost `403` stays hint-free on
purpose (key / permission problem is the likelier cause after a reachable probe; troubleshooting
"Bifrost 401" covers it).

Shape (recommendation; behaviour normative): replace the private `hasNetworkCondition(network)`
by a private `needsNetworkHint(report)` = N1 || N2 || N3, where N2 / N3 use a private
`failedWith(outcome, codes)` that reads `status` and `code` with `attempt(...)` and compares
primitive strings by `===` against two module-local `readonly string[]` constants. Exports and
types are unchanged; `runSmoke`, `smokeFailed`, `install-helper.ts`, `install.sh` and
`install.ps1` are unchanged (every qualifying line is already a `fail`, so exit codes do not
change).

Known imprecision (accepted): bifrost `fail network` also covers a body-stream failure after a
2xx and a non-function injected fetch; both are rare and the hint is still a sensible first
check. Splitting the code would change the bifrost code vocabulary, which T-035 keeps stable.

Tests that pinned the old behaviour are re-expected (stricter, not weaker): the F-021 AC-7a / 7b
"no network hint" tests become "exactly one network hint" tests, and the install-smoke
`fail timeout` scenarios now expect the hint line before `Done.`.
