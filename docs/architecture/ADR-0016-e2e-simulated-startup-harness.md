# ADR-0016: End-to-end simulated startup harness (install.sh + Kilo start simulator)
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0016 / F-014
- Contract: `contracts/e2e-harness.md` 1.0.0 (test-only)
- Extends: ADR-0013 section 6 (fake-network preload; additive `auth` answer)

## Context

F-014 checks vision AC-1/2/3/4/6/7/9/10/12 end to end (startup sequence steps 1-7). Each step
already has its own tests: plugin helpers through `__internals` (ADR-0003 to ADR-0008), installer
edits and install.sh in child bash (ADR-0012), and the smoke test with the fake-network preload
(ADR-0013). Nothing chains them yet. No test currently loads the **installed** plugin file,
using the **installed** personal config's options and the same home directory that the installer
wrote to.

Constraints:
- This item only adds tests. Product files (`backend/plugin/`, `validator/`, `installer/`,
  `personal-config/`, `shared-config/`, `tools/`) do not change. If the harness finds a defect,
  it is reported as a finding. The test is not weakened to make it pass.
- Tests never touch the real home directory, the real network, real `az` or real Kilo. F-019
  (cycle 0013, security medium) taught that calling a plugin helper with `null` or empty deps
  falls back to the real `az` and the real `fetch`. The harness must not depend on such defaults
  in the test process.
- FR-11 lint rule 7: no `KILO_TEST_` / `NODE_OPTIONS` text in `backend/installer/*`. So the
  installer cannot gain a seam. Everything goes through process boundaries and the existing
  preload.
- The AzDO host is a module constant (`https://dev.azure.com/`) and Bifrost must use https. So
  local HTTP servers cannot stand in for them (ADR-0013). The preload is the only fake.
- Must run on Linux CI (Node 22) and on Windows dev machines (Git Bash for install.sh). Zero
  runtime deps.
- Kilo runs plugins in its own runtime and the real Kilo cannot run in CI. A stand-in has to call
  the plugin exactly as the plugin contract says Kilo does (`plugin-interface.md` 0.7.0,
  sections 1, 3 and 2f; ADR-0008 section 1).

## Decision

### 1. Location and files (all under `backend/test/`)

```
backend/test/e2e/startup.test.ts                  # the node:test suite (picked up by "test/**/*.test.ts")
backend/test/e2e/helpers.ts                       # sandbox + runStart + probe + leak scan
backend/test/e2e/fixtures/kilo-start-simulator.ts # child Node process standing in for Kilo
backend/test/installer/fixtures/fake-network.ts   # extended additively (section 4)
```

No change to `package.json`, `scripts/ci.sh`, `tsconfig.json` or `check-fr11.mjs`.
`npm test` already finds `test/e2e/*.test.ts`, and `tsc` already includes `test/**/*.ts`.

### 2. Chain per scenario

```
withE2eSandbox (temp root: home/, bin/{node stub, az stub "fail"}, work/, t/)
  1. runInstall(sb, args, {AZDO_PAT, KILO_BIFROST_KEY}, {smoke?, scenario})   # existing helper, child bash
  2. runStart(sb, scenario)                                                   # new, child node
       node --import=<fake-network URL> kilo-start-simulator.ts --out <root>/start-N.out.json
       env = allow-list only (section 6); cwd = <root>/work
       simulator: config dir -> parse kilo.jsonc -> resolve plugin entries -> import INSTALLED
                  plugin -> server(input, options) -> await hooks.config(config) -> write result
  3. assertions on: result file (config, logs, entries, call counts), the start's own net log,
     files under home (cache, config dir snapshot), stdout/stderr of every child
```

Several starts in one sandbox share the same HOME. The plugin writes the cache to
`<home>/.cache/kilo-azdo/remote-config.json` and the next start reads it from there, exactly as
on an engineer's machine. A fresh sandbox means a fresh machine with no cache.

### 3. Kilo start simulator (test-only stand-in for Kilo)

The simulator is a script, not a library. It does what the plugin contract says Kilo does, and
nothing more:

1. Guard: `KILO_TEST_FAKE_NET` must be non-empty and `globalThis.fetch.name` must be
   `"fakeFetch"` (the preload is active). Otherwise it exits 2 without importing the plugin. This
   is a second layer on top of the env allow-list, so a broken harness cannot reach the network.
2. Config dir like Kilo/the installer: `$XDG_CONFIG_HOME/kilo` when that variable is non-empty and
   absolute, otherwise `join(os.homedir(), ".config", "kilo")`. The harness never sets
   `XDG_CONFIG_HOME`.
3. Reads `<configDir>/kilo.jsonc` and parses it with `__internals.parseJsonc`, imported from the
   **source** plugin (`../../../plugin/azdo-remote-config.ts`). This stands in for Kilo's own
   JSONC parser. Only this pure function is used from the source module. Its `server` is never
   called.
4. Plugin entries, in Kilo's order. First the `plugin` array: a string, or a `[string, options]`
   tuple. A spec starting with `./` or `../` is resolved against the **config dir**. An absolute
   path or a `file:` URL is used as is. Any other spec (an npm name) makes the simulator exit 2,
   because npm plugins are not simulated. Then the auto-load dirs `<configDir>/plugin/` and
   `<configDir>/plugins/`: each regular file ending in `.ts`, `.js`, `.mts` or `.mjs`, sorted by
   name, with options `undefined`. **No de-duplication.** A plugin listed twice is loaded and
   called twice, which is how the harness detects AC-12 double loads.
5. For each entry: `await import(pathToFileURL(resolved).href)` loads the **installed** file. It
   checks that `mod.default.server` is a function and calls
   `await mod.default.server(input, options)`. Every call increments `serverCalls`.
   `input = { client: { app }, directory: cwd, worktree: cwd }`. `app` is an instance of a small
   class whose `log(args)` is a **prototype method** that uses `this` (the SDK shape, ADR-0008
   section 5). It pushes a JSON deep copy of the whole `args` object into the record list and
   returns `Promise.resolve(true)`.
6. `config` = the parsed personal config. `initialConfig` = a deep copy taken before any hook.
   For each returned hooks object whose `config` is a function, it runs `await hooks.config(config)`
   in entry order. Every call increments `hookCalls`. Kilo awaits the hook; the simulator does
   too.
7. Writes the result JSON (contract section 2) to the `--out` path, prints exactly
   `kilo-start-simulator: ok` to stdout and exits 0.
8. If import, `server`, or a hook throws or rejects (a product defect: both must never reject),
   it writes the fixed line `kilo-start-simulator: error: <phase>` to stderr and exits 1. It never
   prints `err.message` or a stack trace.

The result goes to a **file**, not to stdout, on purpose: the merged config legitimately holds
`provider.bifrost.options.apiKey` (the engineer's key). The AC-9 leak scan then covers stdout,
stderr and the log records without exceptions. The result file is never printed.

The simulator never passes deps and never calls `__internals.runConfigHook`. The installed
plugin runs with its production defaults: `globalThis.fetch` (the fake), the real `node:fs`
(inside the sandbox HOME), `os.homedir()` (the sandbox HOME) and `process.env` (the allow-list).
This is the "exactly as Kilo would" requirement. Isolation comes only from the process
boundary, never from in-process deps (the F-019 lesson).

### 4. Fake network: additive `auth` answer

`FakeAnswer` gets one new variant. The other variants keep their exact current behaviour, so the
existing installer suites do not change.

```ts
export type FakeStaticAnswer =
  | { status: number; content: string; headers?: Record<string, string> }
  | { status: number; body?: string; headers?: Record<string, string> };
export type FakeAnswer =
  | FakeStaticAnswer
  | { mode: "hang" }
  | { mode: "throw"; message?: string }
  | { mode: "auth"; authorization: string; answer: FakeStaticAnswer };   // new
```

`auth`: if the request's `authorization` header (lower-cased key, as already collected) is
**exactly** `authorization`, the fixture serves `answer` (rendered by the existing static code
path). Otherwise, including when the header is missing, it serves HTTP 401 with body
`{"error":"unauthorized"}` and `content-type: application/json`. The request is logged as
before. Used for:
- fake Bifrost: `{ mode: "auth", authorization: "Bearer <KEY>", answer: { status: 200, body: '{"object":"list","data":[]}' } }`;
- fake AzDO: `{ mode: "auth", authorization: "Basic <base64(':' + PAT)>", answer: { status: 200, content } }`.
  This proves the PAT reached the plugin from the simulated engineer's environment.

Amended by ADR-0022 (cycle-0027, `contracts/e2e-harness.md` 1.1.1): the `auth` answer gains an
optional `header?: string` (a lower-case header name, default `"authorization"`) and matches
`headers[header ?? "authorization"] === authorization`. The fake Bifrost is now
`{ mode: "auth", header: "x-bf-vk", authorization: "<KEY>", answer: ... }`, i.e. it checks
`x-bf-vk: <KEY>` instead of `Authorization: Bearer <KEY>`. The contract is authoritative.

Content changes between starts need **no** fixture change. Each `runStart` writes its own
scenario file `<root>/start-N.json` with its own log `<root>/start-N.net.log`. "Shared file
changed", "AzDO throws", "AzDO 500" are just different scenario files for successive starts in
the same sandbox.

AC-10's "request without Authorization header gets 401" uses `probeFetch`. It spawns
`node --import=<fake-network URL> --input-type=module -e <fixed script> <url>` with the same
allow-listed env and a scenario file, and the child prints only the status number. This uses the
same preload and the same scenario semantics.

### 5. Scenario switches (summary; exact steps in the architect report task list)

| Scenario | How |
|---|---|
| Fresh install | new sandbox, `runInstall` with `--no-smoke`, `AZDO_PAT`, `KILO_BIFROST_KEY` |
| Shared file changes | same sandbox, second `runStart` with a scenario whose content is v2 (no installer re-run) |
| AzDO unreachable with cache | same sandbox after a successful start; scenario azdo `{mode:"throw"}`, then `{status:500, body}` |
| AzDO unreachable without cache | new sandbox, install, first start with azdo `{mode:"throw"}` |
| defaults vs enforce | edit the installed `kilo.jsonc` (add `model`), start; re-run `runInstall` with `--mode enforce`, start |
| Right / wrong / disabled key | `runInstall` with `{smoke:true}` and the Bifrost `auth` answer; wrong key = a different `KILO_BIFROST_KEY`; disabled key = same key, fake expects another |

### 6. Isolation (never real home, network, az or Kilo)

- **Sandbox**: the existing `withSandbox` (temp root under `os.tmpdir()`, removed in `finally`),
  plus `stubAz(sb, "fail")` (a stub `az` / `az.cmd` that logs and fails) and a `work/` dir.
- **Installer child**: the existing `runInstall` (allow-listed env, `PATH` = sandbox bin, deny-all
  preload via `NODE_OPTIONS`, `--no-smoke` unless the test opts in).
- **Simulator / probe child**: `spawnSync(process.execPath, [...])`, not through bash (so no
  MSYS path rewriting), `timeout: 30000`. The env is built from scratch and does **not** inherit
  `process.env`:
  `HOME`, `USERPROFILE` = sandbox home; `PATH` = sandbox bin (only the stub `az`);
  `AZDO_PAT` = sentinel; `KILO_TEST_FAKE_NET` = the scenario file; on Windows also `SYSTEMROOT`,
  `ComSpec` (from the parent, with defaults as in `runInstall`) and `TEMP` / `TMP` = `<root>/t`.
  So a developer's real `AZDO_PAT`, `KILO_AZDO_*` or `XDG_CONFIG_HOME` cannot leak in. The
  preload is passed as a `--import=` argv flag, not as `NODE_OPTIONS`.
- **Assertions that prove it**: every start's net log has the `loaded` marker. Every request URL
  starts with `https://dev.azure.com/` or `https://bifrost.yourcompany.internal/`. `az.log` does
  not exist (with a usable PAT the plugin never runs az, ADR-0007). The result's `homedir` and
  `configDir` are inside the sandbox root.
- The test process itself imports only `__internals.parseJsonc` (pure) from the source plugin and
  the helpers. It never imports the preload and never calls a plugin helper with deps.

### 7. Portability

- bash is required for install.sh. `e2e/helpers.ts` exports `bashOrSkip`: `findBash()` inside
  `try`. When it throws, every test uses `{ skip: "bash not found on PATH (set KILO_TEST_BASH): end-to-end startup suite skipped" }`.
  It is never a silent pass: node:test reports the skip with its reason.
- POSIX-only assertions (file modes, e.g. cache file 0600) are skipped on Windows with a reason,
  as in `install-sh.test.ts`.
- Paths in scenario files and argv are native paths. The simulator runs as a direct Node child,
  so no MSYS conversion applies. The installer path goes through `runInstall`, which already
  handles Git Bash.
- On Windows, `os.homedir()` reads `USERPROFILE`, and on POSIX it reads `HOME`. Both are set.
- Node 22.18+ type stripping loads the installed `.ts` from the temp dir. There is no
  `package.json` above it, so module syntax detection treats it as ESM. A spike in this cycle
  confirmed this on Node 24. CI uses Node 22. The suite does not assert an empty simulator
  stderr (a Node `ExperimentalWarning` is allowed). It asserts no stack trace and no secret.

### 8. Leak scan (AC-9)

A helper `assertNoLeaks(label, text)` checks for `KEY`, the key tail `AbCdEf1234567890`, the PAT
sentinel, its Basic credential (base64 of `":" + PAT`), and the "other" key used by the wrong-key
case. Every test applies it to every installer stdout/stderr, every simulator stdout/stderr,
`JSON.stringify(result.logs)`, every probe output and the cache file text. A dedicated AC-9 test
also runs a full chain (install with smoke, successful start, failing start with cache, failing
start without cache) and scans the concatenation. It also asserts that every log record has
exactly the keys `service`, `level`, `message` (no `extra`, FR-9) with
`service === "azdo-remote-config"`.

## Consequences

- One suite proves that the shipped pieces fit together. It uses the installed files, the
  installer's normalised options, the real cache path, the real logger call shape and the real
  merge.
- The simulator encodes our reading of Kilo's loader: relative specs resolved against the config
  dir, tuple options, auto-load dirs, an awaited config hook. If Kilo differs, this suite will not
  catch it. The real check stays the manual Phase 0 step (vision AC-1 part below), which F-016
  documents.
- Not covered by the simulation, so it stays a **manual Phase 0** check: running the real Kilo
  CLI (`/models`) and the VS Code extension model list against a real AzDO repo and a real
  Bifrost; Kilo's own runtime loading the `.ts` plugin from `~/.config/kilo/azdo/`; Kilo
  resolving placeholders in the personal config before the hook; Kilo's handling of a disabled
  key at request time; the real `az` Entra-token path.
- Runtime: about 10 installer runs and 12 simulator starts. That is a few seconds on Linux and
  more under Git Bash on Windows. Acceptable.
- The fake-network fixture is now shared by two suites. Its existing variants must stay
  backward compatible.

## Alternatives considered

- **Call `__internals.runConfigHook` in the test process with injected deps**: already covered
  by `hook.test.ts`. It would not use the installed file or the production defaults, and it
  repeats the F-019 risk (wrong deps fall back to the real az / fetch). Rejected.
- **Simulator prints the result JSON on stdout**: the merged config contains the key, so AC-9
  would need exceptions for stdout. Rejected in favour of an `--out` file.
- **Stateful fake (switch content after N requests) in one long-lived simulator process**: Kilo
  does one hook call per start, so separate processes per start match reality and keep the
  fixture stateless. Rejected.
- **Local HTTPS servers**: certificates and DNS changes (ADR-0013). Rejected.
- **Drive `install.ps1` instead of install.sh**: CI runs bash, and install.ps1 parity is
  covered by the F-011 suites. Rejected for this item.
- **Import the installed plugin into the test process**: it would share globals with node:test,
  need an in-process fetch fake, and use the developer's `os.homedir()`. Rejected.
