# Security report (Re-check 1) — cycle 0013 — F-019: Bootstrap installer smoke test (install.sh)

## Inputs read
- `git show --stat HEAD` / `git show HEAD` (cfa63c7, "fix(F-019): address security findings (rework 1)")
- `factory/runs/cycle-0013/04-security.md` (first pass, FAIL on medium #1)
- `factory/runs/cycle-0013/03-backend-rework1.md`
- `backend/installer/smoke.ts` (deps forwarding, `checkAzdo`, `checkBifrost`)
- `backend/plugin/azdo-remote-config.ts` (`resolveFetch`, `resolveRunner`, `defaultRunAz`)
- `backend/test/installer/helpers.ts`, `backend/test/installer/fixtures/fake-network.ts`

## Work done
- Checked the scope of the rework. HEAD changes only `backend/test/installer/smoke.test.ts` (+14/-3)
  and the rework report. `git diff HEAD~1 HEAD -- backend/installer backend/plugin backend/tools frontend`
  is empty, so no product code changed.
- Reviewed the new test block (smoke.test.ts:452-466). It sets a throwing guard on `globalThis.fetch` that
  records every call, calls `runSmoke(VALUES, KEY, { env: {}, fetch: 42, runAz: 42 })`, asserts
  `azdo.status === "fail"`, bifrost `skipped/azdo-failed` and `guardCalls.length === 0`, and restores fetch
  in `finally`.
- Traced the code paths. `resolveRunner` returns `undefined` for a non-function injected `runAz`, so
  `defaultRunAz` is never used. `resolveFetch` and `smoke.ts:322-324` return `undefined`/`network` for a
  non-function injected fetch, so they never fall back to `globalThis.fetch`.
- Wrote a scratchpad spy preload (`spy2.mjs`). It wraps `globalThis.fetch` and every `child_process`
  function (`execFile`, `spawn`, `exec`, `fork`, `execFileSync`, `spawnSync`, `execSync`), then runs
  `syncBuiltinESMExports()` so the plugin's named `execFile` import is also wrapped.
  - In the test process: the real fetch is replaced with a deny-and-log stub, and `execFile`/`exec` are
    denied and logged.
  - For installer subprocesses: `spawnSync` calls that carry `NODE_OPTIONS` get the spy appended, so the
    child Node processes (`install-helper.ts`) log every fetch (with the implementation name) and every
    `execFile`, together with the effective PATH and cwd.
- Positive control (to show the spy really detects these calls), using the test's VALUES:
  - `runSmoke(VALUES, KEY, null)` → spy logged
    `execFile C:\WINDOWS\system32\cmd.exe ["/d","/s","/c","az account get-access-token ..."]`. This is the
    original defect.
  - `runSmoke(VALUES, KEY, { env: {}, fetch: 42, runAz: 42 })` → no execFile, no fetch, result `azdo: fail/network`.

## Files changed
- `factory/runs/cycle-0013/04-security-rerun1.md` — this report (no source changes).

## Verification
- Spy run of `node --test test/installer/smoke.test.ts` → 14/14 pass. The spy log contains only the
  preload "loaded" line: **0 real fetch calls and 0 child_process calls**.
- Spy run of `node --test test/installer/install-smoke.test.ts` → 9/9 pass.
  - 53 child Node processes were instrumented.
  - 0 REAL-FETCH; all 32 child fetch calls went to `fakeFetch` (the fake-network fixture).
  - Parent spawns: only `spawnSync` of Git bash (`install.sh`, each with `PATH=<sandbox>\bin`) and of `process.execPath`.
  - 2 child `execFile cmd.exe /c az account get-access-token ...` calls come from the stub-az test cases.
    Their effective `PATH=C:\Users\magic\AppData\Local\Temp\kilo-inst-*\bin` and
    `cwd=C:\Users\magic\AppData\Local\Temp\kilo-inst-*\home`, so `az` can only resolve to the sandbox stub
    `az.cmd`. The real az CLI cannot be reached.
- `npm run typecheck` → exit 0
- `npm run lint` → `check-fr11: PASS`
- `npm test` → 405 tests, 401 pass, 0 fail (4 skipped, as in pass 1)
- `npm audit --omit=dev --audit-level=high` → found 0 vulnerabilities

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | medium (RESOLVED) | backend/test/installer/smoke.test.ts:452-466 | The null-deps case that spawned the real az is now hostile non-function deps with a deny-fetch guard asserting 0 calls. A spy proved there is no real az spawn and no real fetch, and a positive control proved the spy detects the old behaviour. | None. |
| 2 | info (carried) | backend/tools/check-fr11.mjs:50-64 | FR-11 rules 5-7 scan only top-level `installer/` files. | Backlog (see below). |
| 3 | info (carried) | backend/installer/smoke.ts:309-320 | Accepted risk: the virtual key goes to the https baseURL host named by the shared config. Mitigated by the validator `--allowed-hosts` gate. | None this cycle. |

## Assumptions made (no human available)
- This audit machine is Windows, so the child az path is `cmd.exe /d /s /c az ...`. I treated a sandbox-only
  PATH plus sandbox cwd as proof that the real az cannot be reached. On POSIX, `execFile("az")` with
  PATH=sandbox bin gives the same guarantee.

## Follow-ups for the backlog
- Make FR-11 rules 5-7 recurse into subdirectories of `installer/` and `validator/`.
- Add a global test preload or lint rule that denies real `fetch`/`execFile` in `backend/test/**` unit tests,
  so hermeticity regressions fail loudly.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0013/04-security-rerun1.md
summary: Re-check 1 PASS: medium #1 fixed (spy-verified 0 real az spawns / 0 real fetch in smoke.test.ts and install-smoke.test.ts); test-only change; 0 vulns.
