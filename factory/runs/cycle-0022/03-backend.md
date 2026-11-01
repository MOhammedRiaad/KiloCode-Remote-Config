# Backend report - cycle 0022 - F-020 network pre-flight

## Work done
- `backend/installer/smoke.ts`: new exports `NetworkCode`, `NetworkOutcome`, `AZDO_PROBE_URL`, `classifyProbeStatus`, `probeOrigin`; `SmokeReport.network` (first property); skip code `network-blocked`. Private `probe()` sends one anonymous GET (`headers: {}`, `redirect: "manual"`, own AbortController + `timeoutMs` deadline, body cancelled unread, timer always cleared). `runSmoke` now: resolveSettings -> AzDO probe (non-reachable: azdo `skipped network-blocked`, bifrost `skipped azdo-failed`, no `fetchRemoteConfig`/`runAz`) -> existing AzDO check -> existing Bifrost rows 1-7 -> Bifrost origin probe (non-reachable: `skipped network-blocked`, models request not sent). Codes de-duplicated in order azdo, bifrost, internal. `formatSmoke` prints the network line first and the VPN/allow-list hint last (only when a non-`internal` code exists); a missing or malformed `report.network` prints `smoke network: fail internal`. `smokeFailed` treats a missing or malformed network as fail. No new imports; no test-switch text.
- `backend/test/installer/fixtures/fake-network.ts`: optional `azdoProbe` / `bifrostProbe`, used only for origin `/` requests; otherwise the target's answer (existing variants unchanged).
- `install-helper.ts`, `install.sh`, `install.ps1`, plugin: unchanged.

## Acceptance criteria -> tests
(`U` = `backend/test/installer/smoke.test.ts`, `S` = `install-smoke.test.ts`, `P` = `install-ps1-smoke.test.ts`)
- AC-1 (probe passes on 200/204/302/401/404/405/500/503, first line `smoke network: pass`): U "network probe passes for 200, ..." and "happy path" (4 calls in order); S "AC-1" (regex + 4 requests); P "AC-6 smoke passes"; `backend/test/e2e/startup.test.ts` T6 (strengthened regex).
- AC-2 (403/407 on Bifrost origin: key withheld, no /models, exit 4, install kept): U "withholds the virtual key ... 403 or 407"; S "F-020 Bifrost behind the Azure IP firewall" (exit 4, exact tail, 3 requests, snapshot identical); P "F-020 Bifrost behind ..." (install.ps1 hint).
- AC-3 (unreachable/timeout, no credential, bounded): U "AzDO probe reject or hang", "Bifrost probe reject or hang", "fake clock"; S "AC-3" (azdo probe hang -> 1 request, no auth; `azdoProbe 302 + hang` -> `fail timeout`; bifrost probe hang -> 3 requests, key in none; `bifrostProbe 404 + hang` -> `fail timeout`).
- AC-4 (probe is anonymous GET, https origin, manual redirect, no body): U `assertProbeCall`/`assertAllProbes` in happy path, az-token, 401/302, AC-4 test, AzDO-failure; S/P `assertProbeRequest` / authorization-undefined checks.
- AC-5 (no probe when URL/key invalid): U "never calls Bifrost when baseURL is missing ... (AC-5)" (only azdo URLs called, 2 calls); S bad shared configs (2 requests, second is items).
- AC-6 (no leak, internal handling): U "probe value without a valid status ...", "formatted lines of a blocked probe leak no host ...", "hostile or missing report.network", `assertNoLeak` now also forbids both hostnames and `https://` in the formatted lines; S AC-6 scenarios (+403 probe with KEY body, azdo throw, 407 probe) and `assertNoSecretsOrStack` forbids both hostnames.
- AC-7 (identical for both front ends): U "network hint is identical for both front ends"; P new test; S new test; `--no-smoke` unchanged (0 requests, now also no `smoke network` line).
- `classifyProbeStatus` table and `probeOrigin`: U dedicated tests.

## Existing tests changed (strengthened, none deleted or weakened)
- U: every `deepEqual(report, ...)` gains `network`; "formatSmoke and smokeFailed" and "names the front end" gain the first line, index `[2]` -> `[3]`; happy path 2 -> 4 calls (indices 1/3); az token 2 -> 4; 401/302 2 -> 4; AzDO failure 1 -> 2 with per-URL fresh Responses (probe 404, case response); baseURL/key cases 1 -> 2 plus a no-non-azdo-URL assertion; deadline test now answers the probes 404 so the authenticated hang paths are still covered; throw test same split; 1 MiB/bad body probe 404; globalThis.fetch 2 -> 4, `__proto__` 1 -> 2; hostile deps now assert full report `network: fail internal`, `skipped network-blocked`, `skipped azdo-failed`, no guard fetch calls, `smokeFailed` true (stricter than before).
- S: AC-1, AC-2 (401: 2 -> 4, 404: 1 -> 2), AC-3 (hang cases split, bad configs 1 -> 2), AC-4 (1 -> 2, 2 -> 4), AC-5 (2 -> 4), AC-6 scenarios, AC-7 no `smoke network` assertion.
- P: regexes gain `smoke network: pass`; counts 2 -> 4, 1 -> 2; az test checks indices 1/3 and key/token isolation.
- `startup.test.ts` T6: regex gains `smoke network: pass`.
- `install-helper-frontend.test.ts`, `install-sh.test.ts`, `install-ps1.test.ts`: verified, they use `--no-smoke` by default; no change needed.

## Verification
- `cd backend && npm run typecheck` -> clean.
- `node --test test/installer/smoke.test.ts` 28/28; `install-smoke.test.ts` 10/10; `install-ps1-smoke.test.ts` + `startup.test.ts` 19/19 (0 skipped).
- `bash scripts/ci.sh` -> exit 0: lint (check-fr11 rules 6/7), typecheck, tests (639 total, 629 pass, 0 fail, 10 pre-existing skips), `check-lf: PASS`, `check-docs: PASS (35 markdown files checked)`, `ci: PASS`.
- All tests use injected fetch + clock or the fake-network preload; none reach the real network, `az` or home.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| - | - | - | None. Contract matched; no deviations. | - |

## Assumptions
- A throw from `resolveSettings` returns the last-resort report (`network fail internal`, azdo `fail internal`, bifrost `skipped azdo-failed`).
- Working copies of several test files are CRLF (autocrlf); edited files were written with LF, which matches the index.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0022/03-backend.md
summary: F-020 network pre-flight implemented in smoke.ts with fake-network probe answers and reworked/new tests; ci.sh exits 0
