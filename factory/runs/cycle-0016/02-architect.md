# Architect report — cycle 0016 — F-014: End-to-end simulated startup test

## Inputs read
- `factory/runs/cycle-0016/01-product-owner.md` (F-014, 8 ACs), `factory/backlog.json`
- `docs/architecture/ADR-0001` (stack, lint rules 1-8), `ADR-0007`, `ADR-0008`, `ADR-0012`, `ADR-0013`, `overview.md`, `README.md`
- `docs/architecture/contracts/plugin-interface.md` 0.7.0 (sections 1, 2, 2e, 2f, 2f-L, 3, 4, 5),
  `installer-cli.md` 1.2.0, `personal-config-template.md` 1.0.0
- `backend/test/installer/helpers.ts`, `fixtures/fake-network.ts`, `install-smoke.test.ts`;
  `backend/shared-config/kilo.jsonc`; `backend/tools/check-fr11.mjs`; `backend/package.json`, `tsconfig.json`; `scripts/ci.sh`
- `factory/runs/cycle-0013/04-security*.md` (F-019 lesson: null deps -> real az / fetch)

## Work done
- Designed the test-only harness and recorded it in **ADR-0016**.
- New test-only contract **`contracts/e2e-harness.md` 1.0.0**: the simulator CLI, the result file
  schema, the additive `auth` answer in the fake-network preload, and the harness helper API.
- Updated `overview.md` (header, new "End-to-end simulated startup" data flow, directory layout,
  quality gate), `README.md` (contract list), and `ADR-0013` ("Amended by ADR-0016" note).
- Spike, run in the scratchpad and deleted afterwards: under Node 24 on Windows, a copy of the
  plugin in a temp home with no `package.json` imports through `pathToFileURL`. `server()` then
  `hooks.config()` ran, and with fetch denied it logged L-NONE through a prototype-method logger.
  `os.homedir()` followed `HOME`/`USERPROFILE`. Stderr was empty.

### Design summary
1. **Location**: `backend/test/e2e/startup.test.ts` (suite), `backend/test/e2e/helpers.ts`, and
   `backend/test/e2e/fixtures/kilo-start-simulator.ts` (not `*.test.ts`, so node:test does not
   run it directly). `npm test` / `tsc` / `ci.sh` pick these up without changes.
2. **Chain**: the existing `runInstall` (child bash, temp HOME, stub node/az, deny-all preload)
   runs first. Each simulated Kilo start is then a **separate child Node process**:
   `node --import=<fake-network URL> kilo-start-simulator.ts --out <file>`. The simulator:
   - reads the **installed** `<home>/.config/kilo/kilo.jsonc` (parsed with the source
     `__internals.parseJsonc`, the stand-in for Kilo's parser);
   - resolves `./` specs against the config dir and also scans the auto-load dirs `plugin/` and
     `plugins/`, without de-duplication;
   - imports the **installed** `<home>/.config/kilo/azdo/azdo-remote-config.ts`;
   - calls `default.server(input, options)` with `input = { client: { app }, directory, worktree }`.
     `app.log` is a prototype method using `this` that captures every `args`, as ADR-0008 requires;
   - runs `await hooks.config(parsedConfig)`;
   - writes `{homedir, configDir, entries, serverCalls, hookCalls, initialConfig, config, logs}` to
     the `--out` file and prints only `kilo-start-simulator: ok`.
   - The result goes to a file and not to stdout, because the merged config legitimately holds
     the key. That keeps the AC-9 scan of stdout/stderr/logs free of exceptions.
3. **No deps, production defaults**: the simulator never passes deps and never calls
   `runConfigHook`. The installed plugin uses `globalThis.fetch` (the preload fake), real `node:fs`
   inside the sandbox HOME, `os.homedir()` = sandbox HOME, and `process.env` = an allow-list built
   from scratch: `HOME`, `USERPROFILE`, `PATH` = stub bin, `AZDO_PAT`, `KILO_TEST_FAKE_NET`, plus
   `SYSTEMROOT` / `ComSpec` / `TEMP` / `TMP` on Windows. Isolation comes only from the process
   boundary (the F-019 lesson). The simulator refuses to run (exit 2) unless `KILO_TEST_FAKE_NET`
   is set and `globalThis.fetch.name === "fakeFetch"`.
4. **Fake network**: one additive variant
   `{ mode: "auth", authorization, answer }` serves `answer` only when the `Authorization` header
   matches exactly, and otherwise returns 401 `{"error":"unauthorized"}`. Fake Bifrost uses
   `Bearer <KEY>`. Fake AzDO uses `Basic base64(":"+PAT)`, which proves the PAT flows from the
   engineer's environment. The AzDO content is the shipped `backend/shared-config/kilo.jsonc`
   text, or JSON variants of it. Each start gets its own scenario and log file
   (`start-N.json`, `start-N.net.log`), so switching scenarios between starts needs no fixture
   state.
5. **Cache across starts**: starts in the same sandbox share HOME, so the plugin's own
   `<home>/.cache/kilo-azdo/remote-config.json` written by start N is read by start N+1. A fresh
   sandbox is a machine without a cache.
6. **Portability**: `BASH_SKIP` is set when `findBash()` throws, and every test then skips with
   `bash not found on PATH (set KILO_TEST_BASH): end-to-end startup suite skipped`. The simulator
   and probe run as direct Node children (no MSYS rewriting). POSIX file-mode assertions are
   skipped on Windows. Simulator stderr is not required to be empty (a Node ExperimentalWarning
   is tolerated). It must contain no stack trace and no secret.
7. **Product code unchanged**: `backend/plugin/`, `validator/`, `installer/`,
   `personal-config/`, `shared-config/`, `tools/` stay untouched. Lint rule 7 is unaffected,
   because there is no seam in `installer/`. A defect found becomes a finding in `03-backend.md`.
   The test is not weakened, and the product is not fixed under this item.
8. **Vision AC-1, manual Phase 0 part** (not simulated; F-016 must document it): start the real
   Kilo CLI and run `/models`, and open the VS Code extension model list. Use a real AzDO
   `kilo-config` repo (PAT and `az login` paths), a real Bifrost with a real virtual key, Kilo's
   own runtime loading the `.ts` plugin from `~/.config/kilo/azdo/`, Kilo's real plugin-path and
   tuple-option handling, Kilo's resolution of personal-config placeholders, and a real disabled
   key being rejected at request time.

## Backend tasks

Owner: senior-backend. These are test-only changes, all under `backend/test/`. Follow ADR-0001,
ADR-0013 and ADR-0016 and `contracts/e2e-harness.md` 1.0.0 exactly.

### B1. Extend the fake-network preload (AC-6, AC-1)
- Modify `backend/test/installer/fixtures/fake-network.ts`:
  - export `FakeStaticAnswer` and add the `{ mode: "auth"; authorization: string; answer: FakeStaticAnswer }`
    variant to `FakeAnswer` (contract section 3);
  - move the existing static rendering into a local `renderStatic(answer)` so that top-level
    static answers and `auth.answer` share one code path;
  - on mismatch or a missing header, return 401 with body `{"error":"unauthorized"}` and
    `content-type: application/json`;
  - keep the function name `fakeFetch` (the simulator guard depends on it);
  - existing variants must not change behaviour.
- Modify `backend/test/installer/helpers.ts`: add `FakeStaticAnswer` to the type re-export and
  change nothing else.
- Test: all existing installer suites pass unchanged. AC-10 (B4/T6) covers the new variant both
  ways (match -> 200 `pass`, mismatch -> 401, no header -> 401).

### B2. Kilo start simulator (AC-1, AC-2, AC-3, AC-4, AC-12)
- Create `backend/test/e2e/fixtures/kilo-start-simulator.ts` exactly per contract section 1.
  - Imports: `node:` built-ins and `../../../plugin/azdo-remote-config.ts` (only for
    `__internals.parseJsonc`).
  - Load the installed plugin with `await import(pathToFileURL(resolved).href)`.
  - Fixed stderr texts only. Never print `err.message`, a stack trace or any config value.
  - Exit codes 0 / 1 (phase `load` | `server` | `hook`) / 2 (harness misuse).
  - The logger: `class FakeApp { records: unknown[]; constructor(records: unknown[]) { this.records = records; } log(args: unknown) { this.records.push(JSON.parse(JSON.stringify(args))); return Promise.resolve(true); } }`.
    It uses an explicit field rather than a parameter property, because `erasableSyntaxOnly` is on.
  - The result file is written only on success: `JSON.stringify(result, null, 2) + "\n"`.
- It must type-check under the repo `tsconfig.json` (strict, `noUncheckedIndexedAccess`,
  `erasableSyntaxOnly`).

### B3. Harness helpers (all ACs)
- Create `backend/test/e2e/helpers.ts` per contract section 4. It reuses `withSandbox`, `stubAz`,
  `runInstall`, `findBash`, `fakeNetworkUrl`, `backendRoot`, `expectedItemsUrl`, `snapshot`,
  `isWindows` and the types from `../installer/helpers.ts`. Exports:
  - `simulatorPath`;
  - `BASH_SKIP`;
  - `withE2eSandbox`: `withSandbox` + `stubAz(sb, "fail")` + `mkdir work`, with
    `cacheFile = join(home, ".cache", "kilo-azdo", "remote-config.json")`;
  - `runStart(sb, scenario, { AZDO_PAT })`: per-sandbox counter, own scenario/log/out files, env
    built from scratch, `timeout: 30000`, parsed `result`, `requests`, `loaded`;
  - `probeFetch(sb, scenario, url)`;
  - `assertNoLeaks(label, text, secrets)`: the failure message names the label and the secret
    index, never the value;
  - `parseShared()`: `__internals.parseJsonc` of the shipped `shared-config/kilo.jsonc`;
  - `expectedCache(shared)`: a deep copy without top-level `$schema` / `plugin` and without any
    `apiKey` key at any depth, mirroring sanitizeShared for the test inputs used here.
- Never import the preload into the test process. Never call a plugin helper with deps.

### B4. Suite `backend/test/e2e/startup.test.ts`
Constants:
- `KEY = "sk-bf-AbCdEf1234567890"`, `KEY_TAIL = "AbCdEf1234567890"`;
- `OTHER_KEY = "sk-bf-OtherKey0987654321"`;
- `PAT = "SENTINEL_PAT_VALUE_0016"`, `BASIC = base64(":" + PAT)`;
- canaries `FETCH_THROW_CANARY_0016`, `HTTP_BODY_CANARY_0016`;
- `SECRETS = [KEY, KEY_TAIL, OTHER_KEY, PAT, BASIC, both canaries]`;
- `ENV = { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY }`;
- `azdoOk(content) = { mode: "auth", authorization: "Basic " + BASIC, answer: { status: 200, content } }`.

Every test is declared with `{ skip: BASH_SKIP }`. Every test runs `assertNoLeaks` on every
installer and simulator stdout/stderr, `JSON.stringify(result.logs)`, and the cache file text when
it exists. Every simulator stderr must also not match `/\n\s+at /`. Every start must assert
`status === 0`, `stdout === "kilo-start-simulator: ok\n"` and `loaded === true`, that every
request URL starts with `https://dev.azure.com/` or `https://bifrost.yourcompany.internal/`, and
that `azLogExists(sb) === false`.

- **T1 AC-1 + AC-12, fresh install and first start**:
  - `runInstall(sb, REQUIRED_ARGS, ENV)` (no smoke) exits 0.
  - The installed plugin bytes equal the bytes of `backend/plugin/azdo-remote-config.ts`.
  - Start with `{ azdo: azdoOk(sharedText) }`. Then:
    - `config.provider.bifrost.options.baseURL` equals the shared value;
    - the sorted model keys are `["azure/gpt-5","azure/gpt-5-mini"]`;
    - `apiKey === KEY`;
    - there is exactly 1 request, with URL `expectedItemsUrl("acme","proj","cfg","/kilo.jsonc","main")` and `authorization === "Basic " + BASIC`;
    - `logs` deep-equal `[{body:{service:"azdo-remote-config",level:"info",message:"Loaded shared config from Azure DevOps."}},{body:{service:"azdo-remote-config",level:"info",message:"Applied shared config from remote in defaults mode."}}]`.
  - AC-12:
    - `entries` has length 1, `source: "config"`, and `resolved` equals
      `resolve(sb.configDir, "azdo", "azdo-remote-config.ts")`;
    - `serverCalls === 1` and `hookCalls === 1`;
    - neither `<configDir>/plugin` nor `<configDir>/plugins` exists;
    - `result.homedir` and `result.configDir` are inside `sb.root`.
  - The cache file exists and `JSON.parse` of it deep-equals `expectedCache(shared)`. Its mode is
    0600 on POSIX (skip on Windows).
- **T2 AC-2, the shared file changes and no installer re-run is needed**:
  - Install, then `snap0 = snapshot(sb.configDir)`.
  - v1 = shared + `small_model: "azure/gpt-5-mini"`. v2 = v1 +
    `provider.bifrost.models["azure/gpt-5-nano"] = {}` + `small_model: "azure/gpt-5-nano"`. Both
    are served as `JSON.stringify`.
  - Start 1 serves v1 and start 2 serves v2.
  - Result 2 has the nano model and `small_model === "azure/gpt-5-nano"`. A copy of result 2
    with nano deleted and `small_model` set back to the v1 value deep-equals result 1's config.
  - `snapshot(sb.configDir)` deep-equals `snap0`. The cache deep-equals `expectedCache(v2)`.
  - Each start sent exactly 1 AzDO request.
- **T3 AC-3, AzDO unreachable with a cache**:
  - Install, then start 1 succeeds (shared) and gives `R`. Save the cache bytes.
  - Start 2 uses azdo `{mode:"throw", message: FETCH_THROW_CANARY_0016}`. Start 3 uses azdo
    `{status:500, body: HTTP_BODY_CANARY_0016}`.
  - In both, `config` deep-equals `R.config`, and `logs` deep-equal
    `[warn "Remote config unavailable (network|http-500); using cached config.", info "Applied shared config from cache in defaults mode."]`
    (service `azdo-remote-config`).
  - The cache bytes are unchanged after each start.
- **T4 AC-4 / FR-10, AzDO unreachable without a cache**:
  - Fresh install, then the first start uses azdo `{mode:"throw"}`. The simulator exits 0.
  - `config` deep-equals `initialConfig`, and also deep-equals `parseJsonc(readFileSync(<configDir>/kilo.jsonc))` computed in the test.
  - `logs` deep-equal `[error "Remote config unavailable (network) and no usable cache (cache-missing); continuing with local config only."]`.
  - The cache file does not exist.
- **T5 AC-6 / AC-7, defaults and enforce**:
  - Install with defaults. Edit the installed `kilo.jsonc`: parse it, set `model = "local-model"`,
    and write `JSON.stringify(obj, null, 2) + "\n"`.
  - Shared = shipped + `model: "azure/gpt-5"` + `provider.bifrost.options.apiKey = "sk-bf-SharedDecoy00000000"`.
  - Start: `model === "local-model"`, `apiKey === KEY`, and L-APPLIED `... in defaults mode.`.
  - Re-run `runInstall(sb, [...REQUIRED_ARGS, "--mode", "enforce"], ENV)` and expect exit 0.
    The installed file now has `plugin[0][1].mode === "enforce"`, still has `model === "local-model"`
    and `apiKey === KEY`.
  - Start: `model === "azure/gpt-5"`, `apiKey === KEY`, and L-APPLIED `... in enforce mode.`.
  - In both starts the decoy appears neither in `JSON.stringify(config)` nor in the cache text.
- **T6 AC-10, key check through the smoke test**:
  - bifrostAuth(k) = `{ mode:"auth", authorization: "Bearer " + k, answer: { status: 200, body: '{"object":"list","data":[]}' } }`.
  - (a) sbA: `runInstall(sbA, REQUIRED_ARGS, ENV, {smoke:true, scenario:{azdo: azdoOk(sharedText), bifrost: bifrostAuth(KEY)}})`
    exits 0 and stdout matches `/\nsmoke azdo: pass\nsmoke bifrost: pass\nDone\.\n$/`. The Bifrost
    request carries `Bearer KEY`.
  - (b) Disabled key, same sbA: take a snapshot, re-run with the same ENV and
    `bifrost: bifrostAuth(OTHER_KEY)`. Expect exit 4, `smoke bifrost: fail 401`, and stderr
    containing `install.sh: error: smoke test failed; the installation was kept.`. The snapshot is
    unchanged.
  - (c) Wrong key: fresh sbB with `KILO_BIFROST_KEY = OTHER_KEY` and `bifrostAuth(KEY)`. Expect
    exit 4 with `fail 401`. `snapshot(sbB.configDir)` deep-equals the snapshot of a fresh sbC
    installed with `OTHER_KEY` and `--no-smoke` (exit 0).
  - (d) `probeFetch(sbA, {bifrost: bifrostAuth(KEY)}, "https://bifrost.yourcompany.internal/v1/models")`
    exits 0 with stdout `401`.
- **T7 AC-9, dedicated leak scan**:
  - One chain: install with smoke (pass), start success, start throw (cache). Plus a fresh
    sandbox with install and a start that throws (no cache).
  - Concatenate all stdout/stderr, `JSON.stringify` of every `logs`, and the cache texts, then run
    `assertNoLeaks(SECRETS)`.
  - Every log record has `Object.keys(rec)` = `["body"]` and `Object.keys(rec.body)` =
    `["service","level","message"]`, with `service === "azdo-remote-config"` (no `extra`, FR-9).

### B5. Verification (AC-8)
- `cd backend && npm run lint && npm run typecheck && npm test`, then `bash scripts/ci.sh`; both
  must exit 0. The e2e suite runs (or reports the skip reason).
- `git diff --stat main -- backend/plugin backend/validator backend/installer backend/personal-config backend/shared-config backend/tools`
  must be empty. `backend/package.json` must have no `dependencies`.
- The new files must be LF (`scripts/check-lf.sh`).
- If a product defect shows up, record it in `03-backend.md` (file:line, reproduction) and do
  not change product code. If the defect makes an AC test fail, keep the test, report
  `status: FAIL`, and do not skip or weaken it.

## Frontend tasks
- None. `scope.frontend` is false, and the product has no frontend (`frontend/` is intentionally
  absent).

## Security notes (for the Security engineer)
- **Test-only surface**: no product file changes. Lint rule 7 still keeps `KILO_TEST_` /
  `NODE_OPTIONS` out of `backend/installer/*`. The simulator and preload live under
  `backend/test/` and are never imported by product code.
- **Hermeticity**:
  - The simulator and probe env is built from scratch (no `process.env` inheritance), so a
    developer's real `AZDO_PAT`, `KILO_AZDO_*` or `XDG_CONFIG_HOME` cannot leak in.
  - `PATH` holds only the stub `az`, which logs and fails, and `az.log` must not exist.
  - The deny-all preload is used together with the simulator guard on `fetch.name` /
    `KILO_TEST_FAKE_NET`.
  - The test process never calls plugin helpers with deps (the F-019 null-deps lesson). A
    security spy rerun (as in cycle 0013) of `node --test test/e2e/startup.test.ts` is
    recommended.
- **Secrets on disk**: only sentinel values. They sit in temp sandbox files (scenario files hold
  the expected `Authorization` values, the result file holds the key in `config`), and the files
  are removed in `finally`. The result is written to a file so that stdout carries no key.
  `assertNoLeaks` failure messages never echo the secret.
- **What it verifies for FR-9 / AC-9**: no key, PAT or Basic credential in installer output,
  simulator output or logger records. Logger records have no `extra`. The cache holds no `apiKey`
  (the shared decoy is sanitised) and is 0600 on POSIX.

## Files changed
- `docs/architecture/ADR-0016-e2e-simulated-startup-harness.md`: new ADR (harness design, isolation, portability, manual Phase 0 remainder).
- `docs/architecture/contracts/e2e-harness.md`: new test-only contract 1.0.0 (simulator CLI, result schema, `auth` answer, helper API).
- `docs/architecture/overview.md`: header, new e2e data-flow section, directory layout, quality gate.
- `docs/architecture/README.md`: contract list.
- `docs/architecture/ADR-0013-installer-smoke-test.md`: "Amended by ADR-0016" header note.

## Verification
- `bash scripts/check-lf.sh`: PASS.
- Spike under Node v24.15.0 on Windows: importing the installed plugin from a temp home and
  calling server, then the config hook, worked with no stderr output. The spike files were
  deleted.
- No product or test code was written by the Architect.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Kilo resolves a relative plugin spec against the directory of the config file that lists it
  (the global config dir), passes tuple element `[1]` as `options`, auto-loads `plugin/` and
  `plugins/`, and awaits the config hook once per start. This follows `plugin-interface.md` 0.7.0,
  ADR-0002/0008/0012, and is not verified against a real Kilo (manual Phase 0).
- The "resolved config" handed to the hook is the parsed global personal config. There is no
  project config (ADR-0009 does not support project-level settings) and no placeholder resolution
  by Kilo. The personal config has no placeholders.
- AC-10 "installed files unchanged" covers two cases. (b) A re-run in the same sandbox with the
  same inputs leaves the files byte-identical. (c) A fresh install with a rejected key is
  byte-identical to the same install with `--no-smoke`. A different key on an existing install
  legitimately rewrites `apiKey`.
- AC-2 "small_model value changed" is modelled as v1 with `small_model: "azure/gpt-5-mini"` and
  v2 with `"azure/gpt-5-nano"`. The shipped file has no `small_model`.
- Simulator stderr may carry a Node ExperimentalWarning on Node 22 (type stripping), so it is
  checked for secrets and stack traces only, not for emptiness.

## Follow-ups for the backlog
- F-016 (docs) must describe the manual Phase 0 check listed in Design summary item 8 (real Kilo
  CLI `/models`, VS Code model list, real AzDO, Bifrost, key).
- Optional: an `install.ps1`-driven variant of the e2e chain for Windows-only runners (parity is
  already covered by the F-011 suites; low priority).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0016/02-architect.md
summary: F-014 test-only harness: install.sh in temp HOME, then per-start child Node Kilo simulator that imports the INSTALLED plugin and runs server/config hook with production defaults behind an env allow-list and the fake-network preload (+ additive "auth" answer); ADR-0016, contract e2e-harness 1.0.0; 5 backend tasks, no frontend.
