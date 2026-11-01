# ADR-0020: Plugin fetch failure classification (`network-unreachable` / `network-blocked`) and fixed log hints
- Status: accepted
- Date: 2026-11-01
- Cycle / item: cycle-0023 / F-021
- Amends: ADR-0007 sections 1 (error codes), 8 (deadline mapping), 10 step 1 (status handling);
  ADR-0008 section on log messages (two new hint lines). Contract: `contracts/plugin-interface.md`
  0.8.0 -> 0.9.0 (sections 2e, 2f, 2f-L); `contracts/installer-cli.md` 1.3.0 -> 1.3.1 (section 9.1,
  informative list of pass-through codes only). Builds on ADR-0019 (installer pre-flight, F-020).

## Context

USER requirement (cycle 0022): "my current KILO and Bifrost URL is running behind AZURE IP
firewall, so we need to make sure that is validated before we fetch the URL as that will cause
error". F-020 (ADR-0019) covered the installer with an unauthenticated pre-flight probe. This
item covers the plugin, which runs inside Kilo at **every start**.

Today `fetchRemoteConfig` (ADR-0007) reports `network` for every rejected fetch call,
`timeout` for the deadline and `http-<status>` for every non-2xx answer. A firewall, WAF or proxy
block therefore reads either as a generic `network` error or as `http-403`, which looks like a
permission problem. The config hook (ADR-0008) logs only the code, with no next step.

PO decisions (cycle 0023, `factory/runs/cycle-0023/01-product-owner.md`), which this ADR
implements:
- **No probe in the plugin.** A probe would add a second round trip to every Kilo start. The
  credential only ever goes to the fixed `https://dev.azure.com/` host over TLS, so the
  "credential handed to an intermediary" argument of ADR-0019 does not apply: a TLS-terminating
  intermediary that is not trusted fails the TLS handshake before any header is sent. The single
  authenticated fetch is classified instead, inside the existing `timeoutMs` budget.
- New fixed codes `network-unreachable` and `network-blocked`. `timeout`, `network`, `http-401`
  and JSON `http-403` keep their meaning.
- One fixed, value-free warn hint line after the existing "Remote config unavailable" line.
- Cache order (remote first), cache fallback and the T-013 binding (ADR-0018) are unchanged.

Constraints: FR-10 (never throw), FR-11 (one file, zero runtime dependencies, **no new import**),
**no new `__internals` key**, AC-9 / FR-9 (no secret, URL, host, setting value, header value or
body text in any log or result). The body of a non-2xx response is still never read.

## Decision

### 1. Error codes (module-local `FetchErrorCode`)

```ts
type FetchErrorCode =
  | "invalid-settings" | "auth-unavailable" | "timeout" | "too-large"
  | "bad-response" | "network" | "network-unreachable" | "network-blocked"
  | `http-${number}`;
```

| Code | Exact condition | Status |
|---|---|---|
| `network-unreachable` | The `fetch(url, init)` call settles as **failed** (async rejection, or a synchronous throw turned into a rejection by the existing `settle` wrapper) **and** the deadline has not fired (`outcome.state === "failed"` and `deadline.timedOut() === false`). Typical causes: DNS failure, connection refused or reset, TLS failure (untrusted inspecting proxy), a proxy CONNECT refusal surfaced as an error. | new |
| `network-blocked` | `fetch` resolved with an integer status (`readStatus`, 100..599) and either (a) `status === 407`, whatever the headers, or (b) `status === 403` and the Content-Type is **not JSON** by the rule of section 3 (absent, unreadable, non-string, or a non-JSON media type). | new |
| `timeout` | The deadline won the race for the fetch call or for a body read (`outcome.state === "deadline"`), or the operation failed while `deadline.timedOut()` was already true (a rejection after the deadline, e.g. the abort error). | unchanged |
| `network` | Catch-all, unchanged: injected / global `fetch` not a function (no call made); an unexpected throw anywhere in `runFetch` caught by the outer `try` in `fetchRemoteConfig` (e.g. a throwing injected `setTimeout`); a **body-stream read failure after a 2xx status arrived** (`reader.read()` rejects before the deadline). The connection was open in the last case, so it is not a firewall symptom. | unchanged |
| `http-403` | Status 403 with a JSON Content-Type (section 3). This is how Azure DevOps answers a real permission failure. | narrowed |
| `http-401` | Status 401, any Content-Type (the header is not read). | unchanged |
| `http-<status>` | Every other integer status 100..599 outside 200..299 (incl. 3xx, 404, 429, 5xx). | unchanged |
| others | `invalid-settings`, `auth-unavailable`, `too-large`, `bad-response` | unchanged |

Decision order in `handleResponse` (normative):
1. `status = readStatus(response)`; `undefined` -> discard body, `bad-response` (unchanged).
2. `status` outside 200..299 -> `code = codeForStatus(status, response)` (section 2), **then**
   `discardBody(response)` (guarded `body.cancel()`, not awaited), return `code`. The header is
   read before the cancel so the cancel can never influence the decision. `getReader` is never
   called on this path.
3. 2xx -> unchanged (declared `content-length` check, capped streaming read, decode, parse).
   The Content-Type of a 2xx response is **not** read (no behaviour change for success).

### 2. Implementation shape (inside the single plugin file)

```ts
// performRequest and readCappedBody pass the code for a non-deadline failure:
function codeForInterrupted(outcome: Outcome, deadline: Deadline, failed: FetchErrorCode): FetchErrorCode {
  return outcome.state === "deadline" || deadline.timedOut() ? "timeout" : failed;
}
// performRequest:   codeForInterrupted(outcome, deadline, "network-unreachable")
// readCappedBody:   codeForInterrupted(outcome, deadline, "network")      (unchanged meaning)

function readContentType(response: unknown): unknown;   // attempt(() => response.headers.get("content-type"))
function isJsonMediaType(raw: unknown): boolean;         // section 3
function codeForStatus(status: number, response: unknown): FetchErrorCode {
  if (status === 407) return "network-blocked";
  if (status === 403 && !isJsonMediaType(readContentType(response))) return "network-blocked";
  return `http-${status}` as const;
}
```

Names are a recommendation; the behaviour is normative. The Content-Type header is read **only**
for status 403 (at most one `headers.get("content-type")` call per run). `runFetch`, the outer
catch in `fetchRemoteConfig`, `startDeadline`, `settle`, `discard` and the credential code are
unchanged. Still exactly one `fetch` call per run.

### 3. Reading the Content-Type safely

- Access: `attempt(() => (response as { headers: { get: (name: string) => unknown } }).headers.get("content-type"))`,
  the same guarded, ordinary-property-access pattern as `declaredTooLarge` (real `Headers.get` is
  a prototype method, so `readOwn` cannot be used). Any throw (missing `headers`, throwing getter,
  throwing `get`, revoked proxy) -> `undefined`.
- Only a primitive `string` is inspected (`typeof raw === "string"`); `null`, `undefined`, a
  `String` object, a number, a promise or any other value counts as **not JSON**. No coercion
  (`String(x)`, template literal, `toString`) is ever applied, so a hostile `toString` cannot run.
- JSON rule (`isJsonMediaType`), on the string `raw`:
  1. `essence` = the part before the first `;` (whole string if none), `.trim()`-ed, then
     `.toLowerCase()` (locale-independent).
  2. JSON iff `essence === "application/json"`, **or** `essence` contains exactly one `/` at an
     index > 0 and ends with `+json` with at least one character between the `/` and `+json`
     (e.g. `application/problem+json`, `application/vnd.visualstudio.services+json`).
  3. Everything else is not JSON: `text/html; charset=utf-8`, `text/plain`, `""`, `application/xml`,
     `text/json`, `application/json5`, `+json`, `/+json`, `application/+json`, `a/b/c+json`,
     `application / json`.
  Parameters (`charset`, `boundary`, ...) are ignored. Case-insensitive: `Application/JSON; charset=utf-8` is JSON.
- The value is only compared, never stored, returned, logged or put into an error. No regex
  literal is needed (string methods only; keeps the FR-11 "no slash-star" rule trivially true).

### 4. Hint lines in the config hook

Two module-local constants (exact text, ASCII only, no values):

| Id | Constant | Exact message |
|---|---|---|
| L-HINT-NETWORK | `LOG_HINT_NETWORK` | `Azure DevOps could not be reached from this network: connect to the corporate VPN or ask the platform team to allow your public IP address, then restart Kilo.` |
| L-HINT-CREDENTIALS | `LOG_HINT_CREDENTIALS` | `Azure DevOps credentials are missing or were rejected: run az login or replace your PAT and check your access to the shared config repository; if your organisation restricts Azure DevOps by IP address, also connect to the corporate VPN.` |

Mapping from the hook `reason` (a pure function of the fixed code, e.g. `hintFor(reason)`):

| `reason` | Hint |
|---|---|
| `network-unreachable`, `network-blocked`, `timeout` | L-HINT-NETWORK |
| `http-401`, `http-403`, `auth-unavailable` | L-HINT-CREDENTIALS |
| anything else (`network`, `http-404`, `http-5xx`, any other `http-*`, `too-large`, `bad-response`, `invalid-settings`, `invalid-jsonc`, `invalid-shape`, `missing-settings`) | none |

Placement (normative):
- Fallback with a usable cache: L-CACHE (warn), **then** the hint (warn), then L-UNRESOLVED if
  any, then L-APPLIED / L-MERGE. The cache is applied exactly as before.
- No usable cache: L-NONE (error), **then** the hint (warn), then return. This includes
  `cache-mismatch` (T-013): the mismatching cache is still not applied.
- Missing settings (`missing-settings`, `cache-skipped`): **no hint** (no fetch was made; the
  L-MISSING line already names the action). The success path logs no hint.
- At most one hint line per hook run. Level is always `warn`, also after an `error` L-NONE line,
  because the hint is advice, not a second failure.
- The hint is logged through the same fire-and-forget `makeLogger` function, so a throwing,
  rejecting or hanging logger cannot stop the hook (FR-10).

The credentials hint mentions the VPN in a trailing clause on purpose: an Azure DevOps
organisation IP conditional-access policy answers the **authenticated** request with a JSON
401/403 (ADR-0019 Context table), which is indistinguishable from a bad credential by status and
Content-Type alone. The clause points such users to the right fix without mislabelling a real
credential failure as a network problem.

### 5. What does not change

- Remote-first order, one fetch call per run, `timeoutMs` budget, cache write and read, the
  settings binding and `cache-mismatch` (ADR-0008, ADR-0018).
- Format of L-CACHE and L-NONE (`<reason>` simply carries the new codes).
- `__internals` key set and order; exports; imports (no new import, `headers.get` and string
  methods are already available).
- `backend/installer/smoke.ts`: it forwards `fetched.error` verbatim
  (`smoke azdo: fail <code>`), so it prints `fail network-unreachable` / `fail network-blocked`
  without a code change. Because the smoke's own pre-flight probe (ADR-0019) runs first, those
  two lines can only appear when the probe of `https://dev.azure.com/` was reachable but the
  authenticated request failed. Its pre-flight hint and `formatSmoke` are unchanged; a plugin-side
  network code does **not** add the smoke network hint (that hint stays tied to `smoke network:`).

### 6. Secret safety (AC-9)

- Inputs to the decision: the integer status and a boolean derived from the Content-Type. No
  header value, body byte, URL, host, setting value, PAT, token or error text reaches a result or
  a log. The hint texts are constants.
- The body of every non-2xx response is cancelled unread (unchanged), so no response text can
  ever be parsed or echoed.
- No `catch` binding is added; no error object is inspected.

## Consequences

- An engineer behind an IP firewall now sees `network-unreachable` / `network-blocked` /
  `timeout` plus a concrete VPN / allow-list hint, and a credentials problem sees an az login /
  PAT hint, in Kilo's log at every start, with no extra request.
- Existing tests that pin `network` for a **rejected or throwing fetch call** must change to
  `network-unreachable`, and the hook tests that pin exact log arrays for those paths gain the
  hint line. Tests pinning `network` for a missing fetch, a throwing timer or a body-stream error
  stay unchanged. One existing fetch test that asserts `http-403` for a 403 with a text body
  (default `text/plain;charset=UTF-8`) must be split: that response is now `network-blocked`, and
  a JSON 403 keeps `http-403`. These are precise re-expectations, not weakened assertions.
- Contract bumps: plugin-interface 0.9.0, installer-cli 1.3.1 (informative list only). Minor
  product version (feature).

### Honest false-positive / false-negative assessment

| Situation | Code / hint | Assessment |
|---|---|---|
| Off VPN, Azure Firewall / NSG silently drops | `timeout` + network hint | Correct. |
| DNS failure, reset, refused, untrusted TLS-inspecting proxy | `network-unreachable` + network hint | Correct. Also fires for a genuine Azure DevOps outage at the TCP level or a local DNS problem; the hint is still the right first check. |
| Front Door / App Gateway WAF or proxy block page (HTML / text 403) | `network-blocked` + network hint | Correct. |
| Azure DevOps real permission failure (JSON 403) | `http-403` + credentials hint | Correct. |
| Expired / revoked PAT, bad az token (401, any type) | `http-401` + credentials hint | Correct. |
| Azure DevOps organisation IP conditional-access policy (JSON 401/403 on the authenticated request) | `http-401` / `http-403` + credentials hint (with VPN clause) | **False negative** for the network class; mitigated by the clause; documented by F-022. |
| TLS-inspecting corporate proxy (trusted CA) that answers 403 with a JSON body | `http-403` + credentials hint | **False negative**; rare; documented by F-022. |
| Azure DevOps itself answering 403 without a JSON Content-Type (e.g. an edge/HTML error page) | `network-blocked` + network hint | **False positive** possible; Azure DevOps REST answers are JSON, so judged rare; the hint is still a reasonable first check. |
| Proxy auth 407 | `network-blocked` | Correct but rare: Node's fetch uses no proxy by default and a failed CONNECT surfaces as a rejection (`network-unreachable`). |
| Captive portal / proxy redirect (3xx) | `http-3xx`, no hint | Unchanged (redirects are never followed, ADR-0007 section 9). |
| Azure Firewall application-rule deny of inspected traffic, community-reported as non-standard HTTP 470 (not in Microsoft docs) | `http-470`, no hint | Out of scope (AC-3 keeps every other status unchanged); proposed as a follow-up. |
| Body stream fails after a 2xx | `network`, no hint | Deliberate: connection was open. |

## Alternatives considered

- **Unauthenticated probe before the fetch (as in ADR-0019).** Rejected by the PO: a second
  round trip at every Kilo start for little extra signal; the credential only goes to the fixed
  host over TLS.
- **Keep `http-403` for all 403s and only add a hint.** Rejected: a block page and a real
  permission failure need different actions; a single hint would be wrong for one of them.
- **Inspect the 403 body (e.g. look for "Forbidden" / "blocked").** Rejected: reading untrusted
  body text widens the leak and parsing surface; Content-Type is enough and never echoed.
- **Rename `timeout` to a network code.** Rejected: breaks existing behaviour and docs for no
  gain; `timeout` simply gets the network hint.
- **Classify every fetch failure, including body-stream errors and a missing fetch, as
  `network-unreachable`.** Rejected: those are not firewall symptoms and would point users to
  the VPN wrongly.
- **Separate code for a synchronous throw of the injected fetch.** Rejected: a real WHATWG fetch
  never throws synchronously; distinguishing would change the shared `settle` / `Outcome`
  machinery for a test-only case. A sync throw of the fetch call is classified like a rejection.
- **Treat `text/json` or `application/json5` as JSON.** Rejected: Azure DevOps sends
  `application/json`; a narrow rule keeps a non-JSON block page from passing as a permission
  error.
- **Cache-first order to hide the firewall at startup.** Rejected by the PO: would serve stale
  enforce-mode config.
