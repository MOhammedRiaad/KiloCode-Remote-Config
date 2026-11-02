# Contract: end-to-end startup harness (TEST ONLY)

- Version: 1.1.1 (cycle-0027, ADR-0022: the `auth` answer gains an optional `header` name, default
  `authorization`; the e2e fake Bifrost checks `x-bf-vk: <key>` instead of
  `Authorization: Bearer <key>`; section 3). 1.1.0 (cycle-0022, F-020: fake-network gains optional `azdoProbe` / `bifrostProbe`
  answers for origin-only requests, section 3a; ADR-0019). 1.0.1 (cycle-0019, T-013: `expectedCache` returns the bound cache envelope of
  plugin-interface 0.8.0 section 2f-C, `DEFAULT_BINDING` added; ADR-0018). 1.0.0 was cycle-0016,
  F-014. Decision record: ADR-0016.
- Files: `backend/test/e2e/fixtures/kilo-start-simulator.ts` (simulator CLI),
  `backend/test/e2e/helpers.ts` (harness API), `backend/test/e2e/startup.test.ts` (suite),
  `backend/test/installer/fixtures/fake-network.ts` (preload; `auth` answer added in this version).
- Consumers: the F-014 suite only. Product code never imports or mentions any of these files
  (FR-11 lint rule 7 forbids `KILO_TEST_` / `NODE_OPTIONS` in `backend/installer/*`).
- Not a product interface. It can change with any later test item, provided this file is
  updated at the same time.

## 1. Simulator command line

```
node --import=<file URL of fake-network.ts> backend/test/e2e/fixtures/kilo-start-simulator.ts --out <absolute path>
```

| Aspect | Contract |
|---|---|
| Arguments | Exactly `--out <path>`. Anything else -> exit 2. |
| Env read | `KILO_TEST_FAKE_NET` (must be non-empty, else exit 2), `XDG_CONFIG_HOME`, and what `os.homedir()` reads (`HOME` / `USERPROFILE`). The **installed plugin** additionally reads `process.env` as it does in production (`KILO_AZDO_*`, `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`, `PATH`, `ComSpec`). |
| Preload guard | `typeof globalThis.fetch === "function" && globalThis.fetch.name === "fakeFetch"`, else exit 2 before any plugin import. |
| Config dir | `join(XDG_CONFIG_HOME, "kilo")` if `XDG_CONFIG_HOME` is non-empty and absolute; otherwise `join(os.homedir(), ".config", "kilo")`. |
| Personal config | `<configDir>/kilo.jsonc`, read as UTF-8, parsed with `__internals.parseJsonc` from `backend/plugin/azdo-remote-config.ts` (source module; only `parseJsonc` is used from it). Missing / unparsable / root not a plain object -> exit 2. |
| Plugin entries | (a) each element of `plugin` (absent = `[]`; not an array -> exit 2): string `spec` or array whose `[0]` is a string `spec` and `[1]` the options (absent -> `undefined`). `./` or `../` spec -> `resolve(configDir, spec)`; absolute path -> as is; `file:` URL -> `fileURLToPath`; anything else -> exit 2. (b) then regular files ending in `.ts` / `.js` / `.mts` / `.mjs` in `<configDir>/plugin/` and then `<configDir>/plugins/`, each sorted by name, options `undefined`, `source: "auto"`. No de-duplication. |
| Load | For each entry, in order: `mod = await import(pathToFileURL(resolved).href)`; `mod.default` must be an object with a function `server`, else exit 1 (`load`). `hooks = await mod.default.server(input, options)`; `serverCalls += 1`. |
| `input` | `{ client: { app }, directory: process.cwd(), worktree: process.cwd() }`. `app` is an instance of a class with a prototype method `log(args)` that pushes `JSON.parse(JSON.stringify(args))` to the record list (using `this`) and returns `Promise.resolve(true)`. |
| Hooks | `config` = the parsed personal config object; `initialConfig` = `structuredClone(config)` before any hook. Then for each `hooks` (in entry order) whose `config` is a function: `await hooks.config(config)`; `hookCalls += 1`. |
| Success | Write the result (section 2) as `JSON.stringify(result, null, 2) + "\n"` to `--out`, print exactly `kilo-start-simulator: ok\n` to stdout, exit 0. |
| Failure | A throw / rejection in import (`load`), `server` (`server`) or a hook (`hook`) -> stderr exactly `kilo-start-simulator: error: <phase>\n`, no `--out` file, exit 1. Usage / environment / config problems -> stderr `kilo-start-simulator: error: <fixed reason>\n`, exit 2. Never prints an error message from a caught error, a stack trace, a config value, the key or the PAT. |
| Never | Passes deps to the plugin, calls `__internals.runConfigHook`, writes any file other than `--out`, prints the result. |

Exit codes: `0` hooks completed (whatever the plugin logged); `1` plugin load / server / hook threw
or rejected (a product defect: report it as a finding); `2` harness misuse.

## 2. Result file (`--out`)

```ts
interface SimResult {
  homedir: string;                       // os.homedir() inside the simulator
  configDir: string;                     // section 1
  entries: { source: "config" | "auto"; spec: string; resolved: string }[];
  serverCalls: number;
  hookCalls: number;
  initialConfig: Record<string, unknown>; // parsed personal config before any hook
  config: Record<string, unknown>;        // the same object after all hooks
  logs: unknown[];                        // every args object passed to client.app.log, in call order
}
```

The file holds the engineer's key (inside `config` and `initialConfig`). It stays in the sandbox,
and tests never print it.

## 3. Fake-network preload (`backend/test/installer/fixtures/fake-network.ts`), version for 1.0.0

Unchanged since ADR-0013: activation via `--import`, scenario file from `KILO_TEST_FAKE_NET`
(`{ log?, azdo?, bifrost? }`), routing (`https://dev.azure.com/` prefix -> `azdo`, every other
URL -> `bifrost`), JSON-lines log (`{"event":"loaded"}` once at load, then
`{"event":"request", url, method, headers (lower-case keys), redirect}`), deny-all
(`throw new Error("fake-network: request denied")`) when the answer is absent, and the variants
`{status, content}`, `{status, body?}`, `{mode:"hang"}`, `{mode:"throw"}`.

New in this version:

```ts
export type FakeStaticAnswer =
  | { status: number; content: string; headers?: Record<string, string> }
  | { status: number; body?: string; headers?: Record<string, string> };
export type FakeAnswer =
  | FakeStaticAnswer
  | { mode: "hang" }
  | { mode: "throw"; message?: string }
  | { mode: "auth"; authorization: string; header?: string; answer: FakeStaticAnswer };
  // `header` added in 1.1.1 (cycle-0027, ADR-0022)
```

| `auth` aspect | Contract |
|---|---|
| Match | `headers[header ?? "authorization"] === authorization` (exact, case-sensitive value). `header` is the request header **name** to check and must be written **lower-case** (e.g. `"x-bf-vk"`), because the fixture collects header names lower-cased; a mixed-case name such as `"X-BF-VK"` never matches and always yields 401. Absent `header` -> `"authorization"` (pre-1.1.1 behaviour, byte-for-byte). The field name `authorization` is kept for compatibility: it holds the expected **value** of whichever header is checked. |
| Scenario values used by the F-014 suite | fake AzDO: `{ mode: "auth", authorization: "Basic <base64(':' + PAT)>", answer: { status: 200, content } }` (header defaults to `authorization`). Fake Bifrost (1.1.1, ADR-0022): `{ mode: "auth", header: "x-bf-vk", authorization: <key>, answer: { status: 200, body: '{"object":"list","data":[]}' } }`, i.e. the request must carry `x-bf-vk: <key>`; up to 1.1.0 it was `Authorization: Bearer <key>`. Dropping `header` from the Bifrost scenario makes the e2e Bifrost check get 401. |
| Match -> | `answer` rendered exactly like a top-level static answer (same code path). |
| No match / header missing -> | `new Response('{"error":"unauthorized"}', { status: 401, headers: { "content-type": "application/json" } })`. |
| Logging | The request is logged before the decision, as for every request. |
| Compatibility | Existing variants behave byte-for-byte as before; `FakeAnswer` / `FakeScenario` stay exported from `fake-network.ts` and re-exported from `test/installer/helpers.ts` (add `FakeStaticAnswer` to the re-export). |

## 3a. Origin-probe answers (1.1.0, cycle-0022, F-020; ADR-0019)

```ts
export interface FakeScenario {
  azdo?: FakeAnswer;
  bifrost?: FakeAnswer;
  azdoProbe?: FakeAnswer;    // new, optional
  bifrostProbe?: FakeAnswer; // new, optional
}
```

| Aspect | Contract |
|---|---|
| Origin request | `new URL(url)` succeeds and `pathname === "/"`, `search === ""`, `hash === ""` (e.g. `https://dev.azure.com/`, `https://bifrost.yourcompany.internal/`). |
| Routing | Origin request to a `https://dev.azure.com/` URL -> `azdoProbe` **if present**; origin request to any other URL -> `bifrostProbe` **if present**. Otherwise (key absent, or not an origin request) -> the existing `azdo` / `bifrost` routing, unchanged. So a hanging / throwing / absent (deny-all) target also hangs / throws / denies its probe, and an `auth` target answers the credential-less probe with 401. |
| Rendering | Same code path as section 3 for every variant (`hang`, `throw`, `auth`, static). |
| Logging | Unchanged: every request, including probes, is logged before the decision. |
| Product code | Unchanged rule: never mentions the fixture, `KILO_TEST_`, `NODE_OPTIONS` (lint rule 7). |

## 4. Harness API (`backend/test/e2e/helpers.ts`)

```ts
export const simulatorPath: string;                 // absolute path of kilo-start-simulator.ts
export const BASH_SKIP: string | false;             // skip reason when findBash() throws, else false
export interface E2eSandbox extends Sandbox { work: string; cacheFile: string } // cacheFile = <home>/.cache/kilo-azdo/remote-config.json
export function withE2eSandbox(fn: (sb: E2eSandbox) => void): void;  // withSandbox + stubAz(sb,"fail") + mkdir work
export interface StartRun {
  status: number | null; stdout: string; stderr: string;
  result: SimResult | undefined;                    // parsed --out file when it exists
  requests: NetLogRequest[];                        // this start's net log, request events only
  loaded: boolean;                                  // the "loaded" marker is present in this start's log
}
export function runStart(sb: E2eSandbox, scenario: FakeScenario, env?: { AZDO_PAT?: string }): StartRun;
export function probeFetch(sb: E2eSandbox, scenario: FakeScenario, url: string): { status: number | null; stdout: string; stderr: string };
export function assertNoLeaks(label: string, text: string, secrets: readonly string[]): void;
// Since 1.0.1 (cycle-0019, T-013): the expected bound cache envelope (plugin-interface.md 2f-C).
export const DEFAULT_BINDING: { org: "acme"; project: "proj"; repo: "cfg"; path: "/kilo.jsonc"; branch: "main" };
export function expectedCache(
  shared: Record<string, unknown>,
  binding?: { org: string; project: string; repo: string; path: string; branch: string }, // default DEFAULT_BINDING
): Record<string, unknown>; // { format: "kilo-azdo-cache-v1", binding: { ...binding }, config: <shared without apiKey, $schema, plugin> }
```

- `runStart` numbers starts per sandbox (`start-1`, `start-2`, ...): scenario file
  `<root>/start-N.json` = `{ log: <root>/start-N.net.log, ...scenario }`, out file
  `<root>/start-N.out.json`; `spawnSync(process.execPath, ["--import=" + fakeNetworkUrl, simulatorPath, "--out", out], { cwd: sb.work, env, encoding: "utf8", timeout: 30000 })`.
- `env` (built from scratch, never from `process.env`): `HOME`, `USERPROFILE` = `sb.home`;
  `PATH` = `sb.bin`; `KILO_TEST_FAKE_NET` = scenario file; `AZDO_PAT` when given; Windows:
  `SYSTEMROOT`, `ComSpec` (parent value or `C:\Windows`, `C:\Windows\System32\cmd.exe`),
  `TEMP` / `TMP` = `<root>/t`.
- `probeFetch` uses the same env shape (no `AZDO_PAT`) and runs
  `[--import=<fakeNetworkUrl>, --input-type=module, -e, "const r = await fetch(process.argv[1]); process.stdout.write(String(r.status));", url]`.
  It sends no headers.
- `assertNoLeaks` fails with a message that names `label` and the **index** of the secret, never
  the secret itself.
