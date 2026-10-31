# Security report — cycle 0013 — F-019: Bootstrap installer smoke test (install.sh)

## Inputs read
- `git diff main...HEAD` (19 files), `git status --short --ignored` (clean, no stray/ignored files outside node_modules)
- factory/runs/cycle-0013/02-architect.md (security notes), 03-backend.md
- docs/architecture/ADR-0013-installer-smoke-test.md, contracts/installer-cli.md 1.1.0 section 9
- backend/plugin/azdo-remote-config.ts (unchanged; fetchRemoteConfig, selectEnv, defaultRunAz, resolveRunner)

## Work done
Extra-care audit because the code came from an external delegate with auto-approved tools.

- **Scope / unexpected files**: the diff touches only the files listed in the design (installer/install.sh,
  install-helper.ts, new smoke.ts, tools/check-fr11.mjs, test files and fixture, docs, factory records).
  No new dependencies, no package.json change, no plugin change, no scripts/CI/workflow change, no
  untracked or ignored files, no network calls or downloads outside the test fake.
- **Secrets**: no real secrets in the diff; only sentinels in tests (e.g. `SENTINEL_AZ_TOKEN_0013`).
- **Key path**: `KILO_BIFROST_KEY` -> stdin NUL record (as in F-010) -> `plan.effectiveApiKey` -> only used
  in `checkBifrost` as `Authorization: Bearer <key>` on one GET. Never printed; `formatSmoke` prints
  fixed codes or a bare integer status only. The key is checked to be visible ASCII and 4096 chars at most
  (so no header injection) before any request. `{env:`/`{file:` placeholders are skipped.
- **baseURL**: `modelsUrl` requires `https:`, rejects userinfo (parsed and raw authority `@`), `?`, `#`,
  backslash schemes (`https:\\` fails the `^https://` test) and empty host. baseURL read only through
  own properties of plain objects (`__proto__` payload test passes). `redirect: "manual"`; 3xx -> `fail 3xx`,
  no follow. Accepted residual: the key goes to whatever https host the shared config names (ADR-0013,
  validator `--allowed-hosts` gate).
- **AzDO / PAT / az token**: the smoke phase calls the unchanged plugin `fetchRemoteConfig` with a fixed
  `https://dev.azure.com/` prefix and validated org/project/repo; the PAT/az token exist only inside the
  plugin and never reach `checkBifrost` (the Bifrost headers are built from the key only).
  Production passes only `{ env: pickSmokeEnv(process.env) }`; no fetch/runAz/timer injection, and no
  env name, record or flag can change the AzDO host, the Bifrost URL or relax https.
- **Env allow-list**: `pickSmokeEnv` copies only own string values of `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`,
  `KILO_AZDO_PAT`, `KILO_AZDO_TIMEOUT_MS`; applied twice (helper and runSmoke). `KILO_AZDO_ORG` etc. are
  not forwarded, so the values the user installed are the ones checked.
- **Bounds**: one AbortController/timer per check (`timeoutMs`, range-checked by `resolveSettings`, timer
  cleared in `finally`), 1 MiB content-length and streamed cap, empty-chunk cap, 4096-char key cap.
  Bodies cancelled on every non-pass path. JSON-object 2xx body required for pass.
- **Errors**: every check wrapped in try/catch -> `fail internal`; helper's smoke block is guarded so a throw
  cannot reach the exit-3 catch; stderr line is fixed text. No fetch error text, body, URL or stack printed.
- **install.sh**: `--no-smoke` sets a literal `on`/`off`; the helper rejects any other `smoke` value
  (exit 3). No new external command, no `NODE_OPTIONS`/`KILO_TEST_` text.
- **Test seam**: `NODE_OPTIONS`/`KILO_TEST_FAKE_NET` appear only in `backend/test/installer/helpers.ts` and
  `fixtures/fake-network.ts`; the fixture is never imported by product code; lint rule 7 bans both tokens
  in `installer/*` (raw text). Child-process tests build env from scratch (PATH = sandbox bin, HOME/USERPROFILE
  = sandbox, fake fetch deny-by-default), so host PATs/az/home are not reachable.
- **Hermeticity spot check**: ran `test/installer/smoke.test.ts` under a scratch preload that logs and denies
  `globalThis.fetch` and `child_process.execFile`. Result: one unit test spawns the **real** az CLI
  (finding 1).

## Files changed
- `factory/runs/cycle-0013/04-security.md` — this report (no source changes).

## Verification
- `npm run lint` -> `check-fr11: PASS`
- `npm run typecheck` -> exit 0
- `npm test` -> 405 tests, 401 pass, 0 fail, 4 skipped
- `npm audit --omit=dev --audit-level=high` -> found 0 vulnerabilities
- Spy run of `node --test test/installer/smoke.test.ts` with a fetch/execFile logging preload ->
  `EXECFILE C:\WINDOWS\system32\cmd.exe ["/d","/s","/c","az account get-access-token --resource 499b84ac-... --query accessToken --output tsv"]`

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | medium | backend/test/installer/smoke.test.ts:452 | Non-hermetic test using real credentials. `runSmoke(VALUES, KEY, null)` gives an empty env, so the plugin finds no PAT and falls back to `defaultRunAz`. That runs the **real** `az account get-access-token` on the developer/CI machine (confirmed by the spy run), then uses the real `globalThis.fetch` (already restored at line 440) to send any real AAD token to `https://dev.azure.com/acme/platform/...`. When az is logged in and the network is up, the test makes a real request with a real bearer token to an org we do not own. It still passes because azdo fails either way, so nothing shows the leak. This breaks the "no real network/az/home" rule for this cycle's tests, and the fix is cheap. | Keep the hostile-deps case, but make it unable to reach real az or the network. Option 1: replace `null` with deps whose injected members are non-functions, e.g. `{ env: {}, fetch: 42, runAz: 42 } as unknown as SmokeDeps`; the plugin then maps these to `auth-unavailable`/`network` without spawning anything. Option 2: keep `null`, but first install a deny-all `globalThis.fetch` and inject nothing else, and add a separate case with `{ env: {}, runAz: 42 }`. Also add an assertion that fails if real az or the network was used: either a deny-fetch spy with 0 calls, or `rNullDeps.azdo` deep-equal to the expected fixed code (`auth-unavailable` or `network`). No change to product code. |
| 2 | info | backend/tools/check-fr11.mjs:50-64 | Rule 7 (like rules 5/6) scans only files directly in `installer/`. A future subdirectory would not be scanned. Not a problem today because `installer/` is flat. | Backlog: make rules 5-7 recurse, or fail on any subdirectory in `installer/`. |
| 3 | info | backend/installer/smoke.ts:309-320 | Accepted residual risk: the virtual key is sent to whatever https host the shared config's baseURL names (including internal/IP hosts). Mitigated by the validator `--allowed-hosts` PR gate (ADR-0009/0013). | None this cycle (documented in ADR-0013). |

## Assumptions made (no human available)
- A test that can spawn the real az CLI and send a real token over the network counts as a security
  defect, not just a quality issue. The fix is cheap and confined to test code touched this cycle, so
  under the gate rule it is FAIL-worthy.
- az is not installed on this audit machine, so the spy proved that the spawn happens but not the
  network call that would follow. The network call follows from the code (real fetch restored at line 440).

## Follow-ups for the backlog
- Info 2: make FR-11 rules 5-7 recurse into subdirectories of `installer/` and `validator/`.
- Consider a global test preload (or a lint check on `backend/test/**`) that denies real `fetch`/`execFile`
  in unit tests, so hermeticity regressions fail loudly.

FACTORY_RESULT
status: FAIL
report: factory/runs/cycle-0013/04-security.md
summary: Product code clean (https-only key, no redirects, env allow-list, caps, fixed output, seam test-only, 0 vulns); FAIL on 1 medium: smoke.test.ts:452 null-deps case spawns real az and can send a real token to dev.azure.com.
