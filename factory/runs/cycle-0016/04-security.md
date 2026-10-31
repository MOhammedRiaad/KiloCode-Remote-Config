# Security report — cycle 0016 — F-014: End-to-end simulated startup test

## Inputs read
- `git diff main...HEAD` (15 files). Code in scope: `backend/test/e2e/fixtures/kilo-start-simulator.ts`,
  `backend/test/e2e/helpers.ts`, `backend/test/e2e/startup.test.ts`,
  `backend/test/installer/fixtures/fake-network.ts` (additive `auth` answer),
  `backend/test/installer/helpers.ts` (type re-export).
- `factory/runs/cycle-0016/02-architect.md`, ADR-0016, `docs/architecture/contracts/e2e-harness.md`,
  `factory/runs/cycle-0016/03-backend.md`.
- `factory/runs/cycle-0013/04-security-rerun1.md`, for the lesson about real az and real fetch.
- The uncommitted `.claude/settings.json` change is not part of this cycle and was ignored, as instructed.

## Work done
- **Product code unchanged.** `git diff main...HEAD --stat` over `backend/plugin`, `backend/validator`,
  `backend/installer`, `backend/personal-config`, `backend/shared-config`, `backend/tools`,
  `backend/package.json`, `backend/package-lock.json` and `backend/tsconfig.json` is empty. The cycle
  changes only tests and docs.
- **Spy run (cycle-0013 method, made stronger).** I wrote a scratchpad preload (`spy.mjs`). It:
  - wraps every `child_process` function (`spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`,
    `execSync`, `fork`) and calls `syncBuiltinESMExports()`, so the plugin's named `execFile` import
    is wrapped too;
  - wraps the real `globalThis.fetch` before any fake can replace it, so any call to the original
    implementation is logged;
  - subscribes to the `net.client.socket`, `undici:request:create`, `undici:client:beforeConnect` and
    `http.client.request.start` diagnostics channels;
  - adds itself to every child Node process: through argv for `process.execPath` spawns (the simulator
    and probe children build their env from scratch) and through `NODE_OPTIONS` for the installer's
    bash → node chain.

  Command: `SPY_LOG=... node --import=spy.mjs test/e2e/startup.test.ts` → **8/8 pass**.
  - 39 Node processes were instrumented: the test runner, 13 simulator runs, 1 probe, and the installer
    helpers and `node` probes started from bash.
  - **0 REAL-FETCH, 0 NET/undici events.** Every child process saw `globalThis.fetch` as the preload's
    function, and the fake replaced it.
  - **26 spawns, all from the test process**: `bash.exe install.sh ...` (installer runs, PATH = sandbox
    `bin` only), `node.exe --import=fake-network.ts kilo-start-simulator.ts --out <sandbox>`, one probe
    `node --import=fake-network.ts -e ...`, and one guard-test `node kilo-start-simulator.ts` without the
    preload.
  - **0 spawns from any simulator or plugin process**: no `execFile`, so neither the real az nor the stub
    az ran.
  - Every child had `HOME`/`USERPROFILE` inside `%TEMP%\kilo-inst-*`.
  - Simulator child env keys were exactly `HOME, USERPROFILE, PATH, KILO_TEST_FAKE_NET, SYSTEMROOT,
    ComSpec, TEMP, TMP, AZDO_PAT`. The probe had the same set without `AZDO_PAT`.
- **Positive controls (they prove the spy detects these calls):**
  1. A script that calls `fetch(127.0.0.1)` itself and in a child `node` → the spy logged REAL-FETCH in
     both processes and the `execFileSync` spawn.
  2. Install, then `runStart` **without** `AZDO_PAT`, under the spy → the spy logged `execFile
     C:\WINDOWS\system32\cmd.exe /d /s /c az account get-access-token ...` inside the simulator child.
     The sandbox `az.log` was written, which shows the plugin resolved the **stub** `az.cmd` through the
     sandbox-only PATH. So even this path, which F-014 does not exercise, cannot reach the real az. The
     shipped tests always pass the PAT and assert `azLogExists(sb) === false`
     (`startup.test.ts:87`).
- **Host isolation.** After the run, no `kilo-inst-*` directories were left in `%TEMP%`: `withSandbox`
  removes them in `finally`. The real `~/.config/kilo/kilo.jsonc` mtime is unchanged
  (2026-10-07). The real `~/.cache/kilo-azdo` does not exist.
- **Simulator guard** (`kilo-start-simulator.ts:45-50`). The simulator refuses to run unless
  `KILO_TEST_FAKE_NET` is non-empty **and** `globalThis.fetch.name === "fakeFetch"`. Without the preload
  it exits 2 and writes no output file. The harness test covers this, and it still holds under the spy:
  the spy renames fetch, which also triggers exit 2. The guard runs before any config read or plugin
  import.
- **Secrets.**
  - The diff contains only sentinel values: `sk-bf-AbCdEf…`, `sk-bf-OtherKey…`,
    `SENTINEL_PAT_VALUE_0016`, canaries and a decoy. There are no real credentials and no
    `.env`/key/pem files.
  - Secrets exist only in sandbox temp files (scenario JSON, net log, simulator result file, cache) and
    in child env. All of these are deleted with the sandbox.
  - Simulator stdout is the fixed string `kilo-start-simulator: ok`. Stderr carries only the phase name
    or a fixed misuse reason, never `err.message` (`:165-173`). The result goes to the `--out` file
    (`:159`).
  - The tests scan stdout, stderr, log records and the cache for the key, the key tail, the PAT, the
    base64 Basic credential and the canaries (T7 plus `start()`). `assertNoLeaks` reports the index of
    a leaked value, not the value.
- **`auth` answer** (`fake-network.ts:84-90`). It is a new tagged variant. It returns the configured
  static answer only when the `authorization` header matches exactly; otherwise it returns 401.
  - Existing answers are unchanged: `renderStatic` is a straight extraction of the old code.
  - Default-deny still applies: no answer → throw.
  - It cannot loosen any existing scenario.
  - `start()` also asserts that every request goes to `dev.azure.com` or `bifrost.yourcompany.internal`.
- **Injection / path.** The simulator resolves plugin specs only as relative, absolute or `file:` paths
  (no bare package specs), and only within the sandbox config dir. It is test-only and never imported by
  product code.

## Files changed
- `factory/runs/cycle-0016/04-security.md` — this report. No source changes.

## Verification
- Spy run of `node test/e2e/startup.test.ts` → 8/8 pass; 0 real fetch, 0 sockets, 0 spawns from
  simulator/plugin processes. Both positive controls fired.
- `npm audit --omit=dev --audit-level=high` → found 0 vulnerabilities.
- `npx tsc --noEmit -p tsconfig.json` → OK. `node tools/check-fr11.mjs` → PASS.
- `git diff main...HEAD --stat` over the product paths → empty.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/test/e2e/helpers.ts:69-70 | The fallbacks `"C:\Windows"` and `"C:\Windows\System32\cmd.exe"` use single backslashes, so JS turns them into `C:Windows` and `C:WindowsSystem32cmd.exe`. These are drive-relative paths. They are used only when the host has no `SYSTEMROOT`/`ComSpec`, which does not happen on a normal Windows host, and az is never invoked in these tests. The same code in `installer/helpers.ts:198-199` is correct. | Backlog: escape them as `"C:\\Windows"` and `"C:\\Windows\\System32\\cmd.exe"`. |
| 2 | info | backend/test/e2e/fixtures/kilo-start-simulator.ts:45-50 | The guard is name-based (`fetch.name === "fakeFetch"`). A deliberately misnamed function would pass it. This is acceptable for a test-only fixture, because the harness always builds the env from scratch with a sandbox HOME. | None. |

## Assumptions made (no human available)
- I ran the suite directly (`node <file>`) instead of `node --test <file>`, so that the spy also covers
  the test process itself. `node:test` runs the same 8 tests either way.
- Finding #1 is not a security issue in practice (fallback only, fails closed), so it does not block.

## Follow-ups for the backlog
- Fix the escaping of the Windows fallback paths in `backend/test/e2e/helpers.ts:69-70` (finding #1).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0016/04-security.md
summary: PASS — test-only change; a spy showed 0 real fetch/sockets and 0 az/child spawns from simulator/plugin (both positive controls fired); sandboxed HOME and from-scratch env; secrets only as sentinels; 0 vulns; 1 low follow-up.
