# Architect report - cycle 0022 - F-020: Installer smoke test: network pre-flight for Azure IP firewall / VPN before any credential is sent

## Inputs read
- `factory/runs/cycle-0022/01-product-owner.md` (F-020, 7 ACs; USER requirement verbatim)
- `docs/architecture/ADR-0013-installer-smoke-test.md`, `contracts/installer-cli.md` 1.2.1, `contracts/e2e-harness.md` 1.0.1, `overview.md`, `README.md`
- `backend/installer/smoke.ts`, `backend/installer/install-helper.ts` (smoke block lines ~411-425)
- `backend/test/installer/smoke.test.ts`, `install-smoke.test.ts`, `install-ps1-smoke.test.ts`, `helpers.ts`, `fixtures/fake-network.ts`, `backend/test/e2e/startup.test.ts` (T6/T7)
- `backend/tools/check-fr11.mjs` (rules 6/7), `backend/tools/check-docs.mjs`

## Work done (design summary)
- **Where**: everything is in `backend/installer/smoke.ts`. `install-helper.ts`, `install.sh`, `install.ps1` and the plugin do not change (the helper already prints every `formatSmoke` line and maps `smokeFailed` to exit 4; `--no-smoke` never calls `runSmoke`, so there is no probe and no network line).
- **Order** (sequential, because the Bifrost origin is only known from the fetched shared config):
  `resolveSettings` -> probe `https://dev.azure.com/` -> (reachable) existing azdo check -> existing bifrost rows 1-7 (no request) -> probe `<models URL origin>/` -> (reachable) existing `GET <baseURL>/models`.
- **Probe**: `fetch(origin + "/", { method: "GET", headers: {}, redirect: "manual", signal })`. One AbortController plus one `timeoutMs` deadline per probe (reuse `startDeadline`), the body is cancelled and never read, and the timer is always cleared. We chose GET over HEAD (same WAF evaluation as the real GET; fewer 405 and method allow-list edge cases). We probe the origin only, not the models path, because unauthenticated API paths often answer 401/403 at app level.
- **Classification**: integer status 100-599 except 403/407 -> reachable; 403/407 -> `<t>-blocked`; rejection before the deadline, or a value without a valid status -> `<t>-unreachable`; deadline -> `<t>-timeout`; probe-code exception or a non-function injected fetch -> `internal`. Every non-reachable verdict **hard-skips** that target's credential (`skipped network-blocked`) and makes the network line `fail`, so the run exits 4.
- **Azure reality check** (ADR-0019 table): Front Door WAF and App Gateway WAF give 403 (Front Door's status is configurable). App Service, Functions and Container Apps access restrictions give 403. APIM `ip-filter` gives 403 only on matched operations (a 401 subscription check comes first, and `/` gives 404, so this is a false negative). NSG deny, Azure Firewall DNAT miss and private endpoints give a silent drop (timeout). App-rule deny and resets give a network error. Private DNS off the VPN gives ENOTFOUND (unreachable). AzDO org IP conditional access is post-auth and invisible to the probe (F-021/F-022).
- **False positive** (Bifrost `/` legitimately answers 403 to anonymous requests): the key is withheld, the run exits 4 with a misleading hint, nothing leaks, and the install is kept. The escape hatch is `--no-smoke`, with no new switch. F-022 adds a runbook rule ("origin `/` must not answer 403 to allowed clients") and a curl check. **False negative**: same behaviour as before F-020 (the authenticated request fails with its existing code).
- **Output**: the first smoke line is `smoke network: pass` or `smoke network: fail <code>[,<code>]` (de-duplicated, order azdo, bifrost, internal; comma without space). Then the azdo and bifrost lines (format unchanged), the no-key hint (unchanged), and the new hint as the last smoke line, printed only when the network line failed with a code other than `internal`:
  `Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run <install.sh|install.ps1>.`
  An AzDO probe failure gives bifrost `skipped azdo-failed` (unchanged code: no baseURL is known).
- **Time bound**: worst case `4 x timeoutMs` (it was `2 x`). A blocked AzDO costs at most 1 x.
- **Test seam**: the injected fetch / clock in `smoke.test.ts` stays as it is. `fake-network.ts` gains optional `azdoProbe` / `bifrostProbe` answers for origin-`/` requests and otherwise falls back to the target's answer (realistic: a hanging host also hangs the probe; `auth` gives 401, which counts as reachable). No product switch, no new installer imports (lint rules 6/7 unaffected).

## Files changed
- `docs/architecture/ADR-0019-installer-network-preflight.md` - new ADR (decision, Azure behaviour table, FP/FN analysis, alternatives).
- `docs/architecture/contracts/installer-cli.md` - 1.2.1 -> 1.3.0: header, section 3 step 7, exit 4 row, section 4 front-end message table, section 7 output, new section 9.0, 9.1 note, 9.2 row 7a, 9.3 (exit, `4 x timeoutMs`, example).
- `docs/architecture/contracts/e2e-harness.md` - 1.0.1 -> 1.1.0, new section 3a (probe answers).
- `docs/architecture/ADR-0013-installer-smoke-test.md` - "Amended by ADR-0019".
- `docs/architecture/overview.md` - ADR index, smoke data flow, directory notes.
- `factory/runs/cycle-0022/02-architect.md` - this report.

## Verification
- `node backend/tools/check-docs.mjs` -> `Check-docs: PASS (35 markdown files checked)`.
- No non-ASCII bytes in the edited architecture files.

## Backend tasks (senior-backend)

Maps to F-020 AC-1..AC-7. Follow ADR-0001 (Node 22.18+ TS type stripping, `node:test`, zero runtime deps), ADR-0013 and ADR-0019, and contract `installer-cli.md` 1.3.0 section 9.0.

### B1 - `backend/installer/smoke.ts` (AC-1..AC-6)
1. Types/exports (additive):
   - `export type NetworkCode = "azdo-blocked" | "azdo-unreachable" | "azdo-timeout" | "bifrost-blocked" | "bifrost-unreachable" | "bifrost-timeout" | "internal";`
   - `export type NetworkOutcome = { status: "pass" } | { status: "fail"; codes: NetworkCode[] };`
   - `SmokeReport` gains `network: NetworkOutcome` (first property).
   - `SmokeOutcome` skipped code union gains `"network-blocked"`.
   - `export const AZDO_PROBE_URL = "https://dev.azure.com/";`
   - `export function classifyProbeStatus(status: number | undefined): "reachable" | "blocked" | "unreachable"` (pure: undefined -> unreachable; 403/407 -> blocked; else reachable).
   - Optional pure helper `probeOrigin(modelsUrl: string): string` = `new URL(u).origin + "/"`.
2. A private `probe(url, timeoutMs, deps): Promise<"reachable"|"blocked"|"unreachable"|"timeout"|"internal">`:
   - Resolve the fetch function exactly like `checkBifrost` (own `deps.fetch` if not undefined, else `globalThis.fetch` at call time). Non-function -> `"internal"`, with no call to any fetch.
   - `init = { method: "GET", headers: {}, redirect: "manual", signal }`. Use `startDeadline` with its own AbortController. `deadline.race(() => fetchFn(url, init))`. `deadline` state, or `failed` with `timedOut()` -> `"timeout"`. `failed` -> `"unreachable"`. Value -> `discardBody(value)` always, then `classifyProbeStatus(readStatus(value))`. `finally` clears the timer. Outer try/catch -> `"internal"`.
   - Never read or inspect headers or body; never include the URL in anything returned.
3. `runSmoke` rework (still never rejects):
   - `resolveSettings` once, before the probe (move the timeoutMs computation out of `checkAzdo`, or pass `settings` in; keep the fallback to `internal` on throw).
   - AzDO probe -> non-reachable: `azdo = skipped network-blocked`, `bifrost = skipped azdo-failed`, network codes `[azdo-<v>]` (or `internal`). `fetchRemoteConfig` / `runAz` must not be called.
   - Bifrost: keep rows 1-7 exactly. Only then probe `probeOrigin(urlCheck.url)`. Non-reachable -> `skipped network-blocked`, network code `bifrost-<v>` (or `internal`). The models request is not sent.
   - `network = codes.length === 0 ? pass : fail(dedupe(codes))`, order azdo, bifrost, internal.
   - Last-resort catch: `{ network: { status: "fail", codes: ["internal"] }, azdo: fail internal, bifrost: skipped azdo-failed }`.
4. `formatSmoke(report, frontEnd)`: lines = network line, azdo, bifrost, [no-key hint], [network hint if network fail and some code !== "internal"]. Exact text from contract 9.0. Network line: `smoke network: pass` | `smoke network: fail ${codes.join(",")}`. Defensive: if `report.network` is missing or malformed, print `smoke network: fail internal` (never throw).
5. `smokeFailed`: true if `network.status === "fail"` or azdo / bifrost `fail` (treat a missing or malformed network as fail).
6. Update the header comment to mention ADR-0019 and contract section 9.0. Do not mention test switches (lint rule 7). No new imports (lint rule 6).

### B2 - `backend/test/installer/fixtures/fake-network.ts` (test seam; e2e-harness.md 3a)
- Add optional `azdoProbe?: FakeAnswer; bifrostProbe?: FakeAnswer` to `FakeScenario`.
- Origin request = `URL.canParse(url)` and `pathname === "/" && search === "" && hash === ""`. If it is an origin request and the matching probe key is present, use it; otherwise use the existing routing. Rendering and logging are unchanged. The existing variants must stay byte-for-byte identical.

### B3 - New tests in `backend/test/installer/smoke.test.ts` (unit, injected fetch / clock)
- AC-1: probes answering each of 200, 204, 302, 401, 404, 405, 500, 503 -> `network: pass`. The first formatted line is `smoke network: pass`. azdo / bifrost pass exactly as before. 4 calls in order: `https://dev.azure.com/`, items URL, `https://bifrost.yourcompany.internal/`, models URL.
- AC-2: Bifrost probe 403 (body `<html>`+BODY_CANARY+KEY) -> `{ network: fail [bifrost-blocked], azdo: pass, bifrost: skipped network-blocked }`. No recorded call to `/models`, no call whose headers contain KEY. Hint line present, `smokeFailed` true. Also check 407 -> `bifrost-blocked`.
- AC-3: AzDO probe rejects (canary message) -> `azdo-unreachable`. AzDO probe never settles, with `KILO_AZDO_TIMEOUT_MS: "50"` or an injected fake `setTimeout` firing -> `azdo-timeout`, the signal is aborted, it resolves in < 2 s. In both cases the `runAz` spy is never called (env without PAT), there is exactly 1 call and it has no Authorization header, and the result is `azdo: skipped network-blocked`, `bifrost: skipped azdo-failed`. Bifrost probe reject / hang -> `bifrost-unreachable` / `bifrost-timeout`, with the key never sent.
- AC-4: for every probe call recorded in all tests: `method === "GET"`; URL parses with protocol `https:`, pathname `/`, empty search/hash; `redirect === "manual"`; `signal instanceof AbortSignal`; no body key in init; headers have no key matching /^(authorization|api-key|x-api-key|cookie)$/i (expect `deepEqual(headers, {})`). Write this as a shared `assertProbeCall` helper.
- AC-5: missing / invalid / insecure baseURL, placeholder key, `{env:}` key and invalid key -> no Bifrost probe (the only calls are azdo probe + items). Codes unchanged.
- AC-6: probe value without a valid status (e.g. `{}` / `{ status: 0 }`) -> `unreachable`. A probe whose fetch dep is `42` -> `fail internal`, there is no VPN hint, and the guard `globalThis.fetch` is never called. A probe that resolves 403 with a key-like body leaks nothing (`assertNoLeak` extended with the hostname `bifrost.yourcompany.internal`, `dev.azure.com` and `https://`, applied to the formatted lines only). A hostile `report.network` in formatSmoke gives `smoke network: fail internal`.
- AC-7: `formatSmoke(blockedReport, "install.sh")` vs `"install.ps1"`: identical arrays after replacing the front-end name. The hint text exactly matches the contract for both.
- `classifyProbeStatus` table test (100, 199, 200, 302, 401, 403, 404, 407, 599, undefined).

### B4 - Rework existing tests (strengthen, never weaken)
`backend/test/installer/smoke.test.ts`:
- Every `deepEqual(report, { azdo, bifrost })` gains `network: { status: "pass" }` (or the expected fail).
- "formatSmoke and smokeFailed ..." and "names the front end": the reports gain `network`, the expected arrays gain `"smoke network: pass"` first, and indices shift by one (`[2]` -> `[3]`).
- "happy path": `calls.length` 2 -> 4; azdoCall = `calls[1]`, bifrostCall = `calls[3]`; assert `calls[0]` / `calls[2]` with `assertProbeCall`.
- "az token": 2 -> 4, indices 0 -> 1 and 1 -> 3; `runAz` is still called exactly once.
- "bare HTTP status (401, 302)": the handler currently answers the Bifrost probe with 401/302 (still reachable, which is fine). Count 2 -> 4.
- "skips Bifrost when AzDO fails": `makeFetch(() => azdoResponse)` returns the **same Response object** for the probe and the items call. The probe cancels its body, so this must route by URL (probe -> fresh `new Response("", {status: 404})`, items -> a fresh case response). Count 1 -> 2.
- "never calls Bifrost when baseURL ...": count 1 -> 2 (azdo probe + items). Assert no call to a non-dev.azure.com URL.
- "deadline on hanging AzDO and hanging Bifrost": the probe must answer 404 for origin URLs so that the authenticated hang is still covered (`azdo fail timeout`, `bifrost fail timeout`). Add the probe-hang cases from B3/AC-3 next to them.
- "throwing fetch -> network": same split (probe 404, items/models throw -> `fail network`), plus the probe-throw cases.
- "1 MiB cap / bad body": origin probe -> reachable (e.g. 404). Keep the assertions.
- "globalThis.fetch at call time": `seenUrls.length` 2 -> 4. `__proto__` case: calls 1 -> 2. Hostile deps (`fetch: 42`): expect `network: fail [internal]`, `azdo: skipped network-blocked`, `bifrost: skipped azdo-failed`, `guardCalls.length === 0`, and `smokeFailed` true (it previously asserted `azdo.status === "fail"`; the new assertion is stricter).

`backend/test/installer/install-smoke.test.ts` (fake-network child runs; the `okScenario` probe falls back to 200, so reachable):
- AC-1: stdout regex `\nsmoke network: pass\nsmoke azdo: pass\n`. `reqs.length` 2 -> 4. Items = `reqs[1]`, models = `reqs[3]`. `reqs[0].url === "https://dev.azure.com/"`, `reqs[2].url === "https://bifrost.yourcompany.internal/"`, both GET / manual / no `authorization` header.
- AC-2: 401 case count 2 -> 4, regex adds the network pass line. 404 case count 1 -> 2 (`reqs[0]` probe, `reqs[1]` items).
- AC-3: the azdo hang scenario now times out the **probe**. Expect `smoke network: fail azdo-timeout`, `smoke azdo: skipped network-blocked`, `smoke bifrost: skipped azdo-failed`, the hint, exit 4, 1 request with no authorization. Add a second case with `azdoProbe: { status: 302 }` + `azdo: hang` that keeps `smoke azdo: fail timeout` (2 requests). Same for bifrost hang: probe-hang -> `bifrost-timeout`, 3 requests, KEY in none; `bifrostProbe: { status: 404 }` + `bifrost: hang` -> `fail timeout`, 4 requests. Bad shared configs: 1 -> 2 requests, `reqs[0].url === "https://dev.azure.com/"`.
- AC-4: no-key 1 -> 2. Stored key 2 -> 4 with `reqs[3]` authorization.
- AC-5: 2 -> 4. az Bearer on `reqs[1]`, key on `reqs[3]`, probes without authorization.
- AC-6: add scenarios `bifrostProbe: {status: 403, body: BODY_CANARY+KEY}`, `azdo: {mode:"throw", message: canary}` (probe throws), `azdoProbe: {status: 407}`. `assertNoSecretsOrStack` additionally forbids `bifrost.yourcompany.internal` and `dev.azure.com` in output.
- AC-7 `--no-smoke` and pre-write failures: unchanged (0 requests). Also assert there is no `smoke network` line.
- **New** test "F-020 Bifrost behind Azure IP firewall": `bifrostProbe: {status: 403}`, `bifrost: {status: 200, body: MODELS_BODY}` -> exit 4; stdout ends `smoke network: fail bifrost-blocked\nsmoke azdo: pass\nsmoke bifrost: skipped network-blocked\nSmoke test: a network check failed; ... then re-run install.sh.\nDone.\n`; stderr is the smoke-failed line; 3 requests, none to `/models`, none carrying KEY; snapshot byte-identical to a passing install.
- The stdin-protocol test (`smoke` absent) is unchanged (0 requests).

`backend/test/installer/install-ps1-smoke.test.ts`:
- Regexes gain `smoke network: pass` first. Pass test count 2 -> 4 and indices 0/1 -> 1/3. 404 test 1 -> 2. No-key test 1 -> 2. The az test indexes `reqs[1]` / `reqs[3]`.
- **New** `psTest`: `bifrostProbe: {status: 403}` -> exit 4, the same lines as the install.sh test but with the hint naming `install.ps1` (AC-7).

`backend/test/e2e/startup.test.ts` T6: strengthen the regex to `\nsmoke network: pass\nsmoke azdo: pass\nsmoke bifrost: pass\nDone\.\n$`. The `auth` answer gives 401 to the probe, which counts as reachable. Nothing else changes. T7 is unchanged.

`backend/test/installer/install-helper-frontend.test.ts`, `install-sh.test.ts`, `install-ps1.test.ts`: no smoke run (`--no-smoke` default), so nothing changes. Verify.

### B5 - Gate
- `bash scripts/ci.sh` exits 0 (lint incl. check-fr11 rules 6/7, check-docs, all tests). No real network, `az` or home is used.

## Frontend tasks
- None. F-020 has `scope.frontend: false`. There is no UI in this product.

## Security notes (for the Security engineer)
- **Credential withholding**: verify that on every non-reachable verdict no PAT, Basic credential or az token is created or sent (`fetchRemoteConfig` and `runAz` are not called) and the virtual key is sent nowhere. On `internal` too (when in doubt, do not send).
- **Probe hygiene**: GET, https origin only (constant AzDO origin; the Bifrost origin comes from a URL that already passed `modelsUrl` checks: https, no userinfo / query / fragment), headers `{}`, no body, `redirect: "manual"`, bounded by the deadline. The body is cancelled unread, so response size cannot cause a DoS.
- **Output**: fixed codes only. No host, URL, status text, body or error text (ADR-0013 section 5 rules still apply).
- **SSRF-ish surface**: the Bifrost probe targets the same host the key is sent to anyway (shared config, PR-gated by the validator `--allowed-hosts`). It adds one anonymous GET to `/`, which is less than before.
- **No new switches**: no flag or env var changes the probe targets or skips the probe except the existing `--no-smoke`. The test seam is the external preload only (lint rule 7).
- **Residual**: a false positive (legit 403 on `/`) causes a failed smoke run, not exposure. A false negative behaves as before F-020.

## What F-021 and F-022 need from this design
- **F-021 (plugin)**: reuse the verdict vocabulary `blocked` / `unreachable` / `timeout` and the hint wording (VPN / Azure firewall allow-list) for the plugin's log hint. The plugin should **classify its own authenticated AzDO fetch failures** (`network`, `timeout`, `http-403`/`http-407`) rather than probe on every Kilo start. The plugin's `FetchErrorCode` and `__internals` surface are frozen unless F-021's ADR changes them. `smoke.ts` does not import from F-021.
- **F-022 (docs)**: user-guide smoke table rows for `smoke network: fail azdo-|bifrost-blocked|unreachable|timeout|internal` and `skipped network-blocked`, plus the exact hint text. Troubleshooting entry with a `curl -s -o /dev/null -w '%{http_code}' https://<origin>/` self-check. Platform runbook: allow-list the engineers' public egress IPs / VPN ranges on Front Door, App Gateway, App Service or APIM; make Bifrost origin `/` answer non-403 to allowed clients; expect anonymous `GET /` probes in WAF logs; note that a configurable WAF block status (non-403) and APIM `ip-filter` show up as `fail <status>` on the authenticated call; AzDO org IP conditional access is post-auth (`smoke azdo: fail http-401/403`). Engineer setup: VPN prerequisite, the `4 x KILO_AZDO_TIMEOUT_MS` bound, and `--no-smoke` / `-NoSmoke` as the escape hatch. Update `install.sh` / `install.ps1` usage text only if F-022 decides to (it is not required by F-020).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| - | - | - | None (design phase). | - |

## Assumptions made (no human available)
- The probe uses GET with an empty header object, not HEAD. ADR-0019 explains why. AC-4 allows either.
- When the AzDO probe fails, bifrost reports the existing `skipped azdo-failed` (no baseURL is known). Only the target whose own probe failed is `network-blocked`.
- A probe value without a valid status is treated as `unreachable`, the conservative choice.
- No VPN hint is printed for a network fail that holds only `internal` (it is not a network condition).
- The time bound grows to `4 x timeoutMs`. Each probe uses its own `timeoutMs` deadline, with no new knob.
- The fake-network probe keys fall back to the target's answer, so the existing child tests stay realistic. Tests that must exercise the authenticated hang/throw paths add explicit probe answers.
- Front-end scripts and usage text are unchanged. Contract 1.3.0 adds no input, record or exit code.

## Follow-ups for the backlog
- None new. F-021 and F-022 are already queued; their needs are listed above.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0022/02-architect.md
summary: ADR-0019 + installer-cli 1.3.0 (section 9.0) + e2e-harness 1.1.0 - per-target unauthenticated GET origin probe (403/407 blocked, error unreachable, deadline timeout) before any credential; first line "smoke network: ...", skip code network-blocked, fixed VPN/allow-list hint, exit 4; backend-only task list with existing-test rework.
