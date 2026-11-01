# Code Review report — cycle 0022 — F-020: Installer smoke test: network pre-flight for Azure IP firewall / VPN before any credential is sent

## Inputs read
- `git diff main...HEAD` (17 files; working tree clean), `factory/runs/cycle-0022/01-product-owner.md` (7 ACs), `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/contracts/installer-cli.md` 1.3.0 (sections 3, 7, 9.0, 9.2 row 7a, 9.3), `contracts/e2e-harness.md` 1.1.0 section 3a, ADR-0019
- `backend/installer/smoke.ts` (full diff plus helpers `readStatus`, `startDeadline`, `discardBody`, `resolveClock`)
- Test diffs: `backend/test/installer/smoke.test.ts`, `install-smoke.test.ts`, `install-ps1-smoke.test.ts`, `fixtures/fake-network.ts`, `backend/test/e2e/startup.test.ts`

## Work done
- **CI**: I ran `bash scripts/ci.sh` myself. It exited 0 (639 tests: 629 pass, 0 fail, 10 pre-existing skips; lint, typecheck, check-lf and check-docs all PASS).
- **Contract conformance** (installer-cli 9.0):
  - Probe order is AzDO probe, then `checkAzdo`, then Bifrost rows 1-7, then the Bifrost probe, then `/models`.
  - The AzDO probe goes to the constant `https://dev.azure.com/`. The Bifrost probe goes to `new URL(validated).origin + "/"` and is sent only after rows 1-7.
  - The probe init is exactly `{GET, headers: {}, redirect: "manual", signal}`. It has no body, its own AbortController and its own deadline, and the timer is cleared in `finally`.
  - `classifyProbeStatus`: 403 and 407 give blocked. Other integer statuses 100-599 give reachable. A value without a valid status gives unreachable (`readStatus` enforces integer 100-599). A rejection gives unreachable. The deadline gives timeout. A non-function fetch or an unexpected throw gives `internal`.
  - When the AzDO verdict is not reachable, the result is azdo `skipped network-blocked` and bifrost `skipped azdo-failed`. `fetchRemoteConfig` and `az` are never reached.
  - When the Bifrost verdict is not reachable, the result is `skipped network-blocked` and no `/models` request is made.
  - Codes are de-duplicated in the order azdo, bifrost, internal.
  - `smoke network:` is always the first line.
  - The hint text matches section 7 byte for byte. It is printed only when there is a code other than `internal`, and it names the front end.
  - `smokeFailed` returns true for any network fail or a missing/malformed network, which gives exit 4.
  - The fake-network routing matches e2e-harness 3a.
- **Mutation testing** on a scratch `git archive HEAD` copy (never in the repo). Each run used `node --test` on smoke.test.ts and install-smoke.test.ts; the baseline is 38/38 pass.

  | Mutation | Result |
  |---|---|
  | M1 probe sends `Authorization` | 11 fail (killed) |
  | M2 401 classified as blocked | 3 fail (killed) |
  | M3 key not withheld on a blocked Bifrost probe (falls through to `/models`) | 4 fail (killed) |
  | M4 hint dropped | 5 fail (killed) |
  | M5 `redirect: "follow"` | 11 fail (killed) |
  | M6 timeout reported as unreachable | 4 fail (killed) |
  | M7 `smokeFailed` ignores network | 6 fail (killed) |
  | M8 hint also printed for `internal` | 1 fail (killed) |
  | M10 probe timer not cleared | 1 fail (killed) |
  | M11 AzDO probe removed | 20 fail (killed) |
  | M9 probe response body not cancelled | **0 fail (survives)**, see finding R1 |

- **Reworked existing tests**: I inspected every hunk. Each one either adds the `network` property or line, or shifts indices and counts to the 2-to-4 and 1-to-2 call patterns while keeping or adding assertions. No test was deleted. Several were strengthened:
  - The hostile-deps test changed from `azdo.status === "fail"` to a full `deepEqual` plus a `smokeFailed` check.
  - The az-token tests now check that the token reaches neither probe.
  - The bad-config tests now assert that every call goes to dev.azure.com.
  - `assertNoLeak` / `assertNoSecretsOrStack` now also forbid both host names and `https://`.

  The AzDO-hang and Bifrost-hang coverage of the credentialed path was kept: new scenarios add `azdoProbe 302 + azdo hang` and `bifrostProbe 404 + bifrost hang`, and the unit deadline test answers the probes 404. Two slight shifts are noted as R2 and R3; they are not weakening.
- **Time bound**: probe (T), then items (az plus fetch under one deadline, as Security verified), then probe (T), then models (T) gives 4 x `timeoutMs`. A blocked AzDO probe ends the smoke phase after 1T. This matches 9.3.
- **Hermeticity**: unit tests inject `fetch` and the clock, or guard `globalThis.fetch`. Child-process tests use the deny-by-default fake-network preload. No test reaches the real network, `az` or home.
- **User scenario** (Bifrost behind an Azure IP firewall, engineer off the VPN): dev.azure.com is public, so `smoke network` reports the Bifrost probe. Each failure mode prints the VPN / allow-list hint, exits 4 and keeps the install. The key is never sent.

  | Firewall behaviour | Result line |
  |---|---|
  | App Service / Front Door 403 | `fail bifrost-blocked` |
  | Private DNS not resolvable off the VPN | `bifrost-unreachable` |
  | Packets silently dropped | `bifrost-timeout` after one `timeoutMs` |

  This is a clear, actionable message. AzDO conditional-access IP policies still look like `http-401/403` on the credentialed fetch, but that is out of scope by PO decision (F-022 documents it).
- **Maintainability**:
  - `runSmoke` is about 25 lines with one early return, which is readable.
  - `probe()` reuses the existing deadline, clock and discard helpers, so there is no duplication.
  - The `codes` out-parameter on `checkBifrost` (`smoke.ts:375`) is a mild side channel. It is a nit only (R4).
- **Lanes**: the diff touches only `backend/`, `docs/architecture/` and `factory/`. `install-helper.ts`, `install.sh`, `install.ps1`, `backend/plugin/`, `backend/tools/`, `frontend/`, `scripts/` and `.github/` are unchanged (`git diff --quiet` is clean).

## Files changed
- `factory/runs/cycle-0022/05-review.md`: this report.

## Verification
- `bash scripts/ci.sh` exited 0 (`ci: PASS`).
- Mutation runs as listed above. The scratch copy was outside the repo, and the repo was untouched.

## Acceptance criteria coverage
| AC | Code | Killing test(s) |
|---|---|---|
| AC-1 non-403/407 probe gives pass, first line, checks unchanged | `classifyProbeStatus`, `runSmoke`, `formatSmoke` | smoke.test "network probe passes for 200...503", happy path; install-smoke AC-1; ps1 AC-6; e2e T6 |
| AC-2 Bifrost 403/407 withholds key, no /models, hint, exit 4 | `checkBifrost` row 7a | smoke.test "withholds the virtual key..."; install-smoke and ps1 "F-020 Bifrost behind the Azure IP firewall" (M3 killed) |
| AC-3 AzDO reject/hang gives unreachable/timeout, no az, no PAT, resolves | `runSmoke` early return, `probe` | smoke.test AzDO/Bifrost reject-or-hang, fake clock; install-smoke AC-3 (M6, M11 killed) |
| AC-4 probe shape | `probe` init literal | `assertProbeCall` (`deepEqual(headers, {})`, redirect, signal, no body, https origin) (M1, M5 killed) |
| AC-5 no probe for bad URL/key; `--no-smoke` sends nothing | probe placed after rows 1-7 | smoke.test AC-5 (2 calls, all to dev.azure.com); install-smoke AC-7 (0 requests) |
| AC-6 fixed output, `internal` without throw | `networkLine`, `isNetworkOutcome`, `internalReport` | invalid-status values, `fetch: 42`, hostile `report.network`, leak tests (M8 killed) |
| AC-7 front-end parity, CI green | `formatSmoke(frontEnd)` | smoke.test parity; ps1 F-020 test; CI exit 0 |

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| R1 | low | backend | `backend/installer/smoke.ts:356` | Contract 9.0 says the probe response body "is cancelled", but no test asserts it. Mutation M9 (removing `discardBody`) survives. The code is correct today. Without the cancel, a real undici response would keep its socket or stream until GC, which is harmless in a short-lived installer. Not an AC. | Follow-up: add a unit test whose probe Response body records `cancel()`. |
| R2 | info | backend | `backend/test/installer/install-smoke.test.ts` (AC-3 Bifrost probe hang case) | The regex lost its `Done\.\n$` tail anchor. The exact tail including the hint is covered by the F-020 test. | Optional: anchor it to the hint and `Done.` |
| R3 | info | backend | `backend/test/installer/smoke.test.ts:812` | The `fetch: 42, runAz: 42` hostile-deps case now stops at the probe, so it no longer exercises `fetchRemoteConfig` with a hostile `runAz`. The plugin's own tests cover that path. | Optional: add a case with a valid probe fetch and `runAz: 42`. |
| R4 | info | backend | `backend/installer/smoke.ts:375` | `checkBifrost` reports network codes through a mutable `codes` out-parameter. | Optional refactor: return `{ outcome, networkCode? }`. |

There are no correctness bugs, contract mismatches, missing AC coverage or weakened tests.

## Assumptions made (no human available)
- An untested contract clause that is not an AC and is implemented correctly (body cancel) is a low-severity follow-up, not a gate failure.
- The ps1 child-process tests ran in CI on this host (pwsh present), as the backend report states (0 skipped in that file).

## Follow-ups for the backlog
- R1: add a test asserting that the probe body is cancelled.
- R2, R3, R4: optional test-tightening and refactor nits.
- F-022 docs should cover the AzDO conditional-access case (shows as `smoke azdo: fail http-401/403` with no network hint) and path-routed gateways, where the origin `/` answers differently from `/v1/models`.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0022/05-review.md
summary: F-020 matches installer-cli 1.3.0 section 9.0; ci.sh exit 0; all 7 ACs have killing tests (10 of 11 mutations killed; only probe body-cancel untested, low follow-up); reworked tests strengthened, lanes respected.
