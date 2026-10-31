# Architect report — cycle 0013 — F-019: Bootstrap installer smoke test (install.sh)

## Inputs read
- factory/runs/cycle-0013/01-product-owner.md (F-019, 8 ACs), factory/backlog.json (F-019, T-019)
- factory/runs/cycle-0011/02-architect.md (F-019 hand-off note)
- docs/architecture/ADR-0001, ADR-0007, ADR-0009, ADR-0012, contracts/installer-cli.md 1.0.0, overview.md
- backend/installer/install.sh, install-helper.ts, personal-config-edit.ts
- backend/plugin/azdo-remote-config.ts (resolveSettings, fetchRemoteConfig, readOwn/selectEnv, defaultRunAz, __internals)
- backend/tools/check-fr11.mjs, backend/tsconfig.json, backend/package.json
- backend/test/installer/helpers.ts, install-sh.test.ts; backend/shared-config/kilo.jsonc

## Work done
- Designed the FR-22 smoke test on top of ADR-0012 and recorded it in **ADR-0013**.
- Amended contract `installer-cli.md` **1.0.0 -> 1.1.0**: `--no-smoke`, optional `smoke=on|off`
  stdin record, smoke-phase env reads, processing step 7, exit code 4, output lines, new
  section 9 (exact checks, codes, request shape, ordering, time bound). AC-8's "contract documents
  the smoke output, exit 4 and --no-smoke" is satisfied by this change.
- Added FR-11 lint **rule 7** to ADR-0001 section 3 (no `KILO_TEST_` / `NODE_OPTIONS` text in
  `installer/*`), noted the amendment in ADR-0012, updated overview.md (C5 row, install data flow,
  layout).

### Design summary
1. **Where**: the smoke phase runs inside `install-helper.ts` right after a successful write
   phase (never after exit 1/2/3), with the logic in a new module `backend/installer/smoke.ts`
   (injectable `fetch` / `runAz` / `env` / timers). `install.sh` only parses `--no-smoke` and
   sends `smoke=on|off` as an extra NUL record. Same process = normalised settings and the
   effective key are already in memory; no re-read of the file just written, no second protocol.
2. **azdo check**: `__internals.resolveSettings(values, { env })` then
   `__internals.fetchRemoteConfig(settings, { env })` and `__internals.parseJsonc`. `env` is a
   filtered copy with only `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`, `KILO_AZDO_PAT`,
   `KILO_AZDO_TIMEOUT_MS`. No second AzDO HTTP/auth code. Fixed codes = the plugin's codes plus
   `invalid-jsonc`, `invalid-shape`, `internal`.
3. **bifrost check**: baseURL from the fetched shared config; https only, no credentials /
   query / fragment; URL = pathname without trailing `/` + `/models`; effective key = the apiKey
   now in the personal config (from the plan in memory); placeholder -> `skipped no-key`;
   `{env:`/`{file:` -> `skipped key-reference`; non visible-ASCII or > 4096 chars ->
   `fail invalid-key`; one GET with `Accept` + `Authorization: Bearer`, `redirect: "manual"`,
   one timeoutMs deadline, 1 MiB cap, 2xx + JSON-object body = pass; non-2xx -> bare status.
4. **Exit 4** on any `fail`; install never undone; `Done.` printed on 0 and 4.
5. **Test seam**: a TEST-ONLY Node preload `backend/test/installer/fixtures/fake-network.ts`
   loaded via the child env `NODE_OPTIONS=--import=<file URL>`; it replaces `globalThis.fetch`,
   logs every request to a file and answers from a scenario file named by `KILO_TEST_FAKE_NET`
   (read only by the fixture). Product code has no switch at all (fixed AzDO host,
   `globalThis.fetch` read at call time); `NODE_OPTIONS` already implies arbitrary code execution,
   so it adds no capability for an attacker. Lint rule 7 guarantees product installer files never
   reference `KILO_TEST_` or `NODE_OPTIONS`.
6. **F-010 tests stay offline**: `runInstall` prepends `--no-smoke` (before the test's args) and
   always sets the deny-all preload.

Full detail: `docs/architecture/ADR-0013-installer-smoke-test.md`,
`docs/architecture/contracts/installer-cli.md` section 9.

## Backend tasks

All paths are under `backend/`. Do not modify `plugin/azdo-remote-config.ts`,
`personal-config/kilo.jsonc`, `validator/**`, or `package.json` dependencies (AC-8). No new npm
packages.

### BE-1 `installer/install.sh`: `--no-smoke` and the `smoke` record (AC-7, AC-8)
- Add `smoke=on` default; `--no-smoke)` case in the parse loop sets `smoke=off; shift` (no value;
  bash 3.2 compatible; `--no-smoke=x` stays an unknown option; a flag taking a value still takes
  `--no-smoke` as its value).
- Usage text: add `[--no-smoke]` to the synopsis and one line, e.g.
  `After installing, a smoke test reads the shared config from Azure DevOps and calls Bifrost GET <baseURL>/models; --no-smoke skips it.`
  and `Exit codes: 0 ok, 1 prerequisite, 2 usage, 3 file system, 4 installed but smoke test failed.`
- Append `"smoke=$smoke"` to the existing `printf '%s\0' ...` record list. Nothing else changes:
  still builtins + `node` + `az`, no new external command, no `NODE_OPTIONS`/`KILO_TEST_` text
  (rule 7). Prerequisite behaviour unchanged (with `--no-smoke` the `az account show` check still
  runs when no PAT is set, per F-010).

### BE-2 `installer/smoke.ts` (new; AC-1..AC-6)
Imports only `../plugin/azdo-remote-config.ts` and `./personal-config-edit.ts` (rule 6). Exports
(names are binding for the tests in BE-6):
```ts
export const SMOKE_ENV_NAMES = ["AZDO_PAT", "AZURE_DEVOPS_EXT_PAT", "KILO_AZDO_PAT", "KILO_AZDO_TIMEOUT_MS"] as const;
export type SmokeOutcome =
  | { status: "pass" }
  | { status: "fail"; code: string }
  | { status: "skipped"; code: "azdo-failed" | "no-key" | "key-reference" };
export interface SmokeReport { azdo: SmokeOutcome; bifrost: SmokeOutcome }
export interface SmokeDeps {
  env: Readonly<Record<string, string | undefined>>;
  fetch?: (url: string, init: { method: "GET"; headers: Record<string, string>; redirect: "manual"; signal: AbortSignal }) => Promise<unknown>;
  runAz?: unknown;            // forwarded to fetchRemoteConfig only when present
  setTimeout?: unknown; clearTimeout?: unknown;
}
export function pickSmokeEnv(source: Readonly<Record<string, string | undefined>>): Record<string, string>;
export function modelsUrl(baseURL: unknown):
  { ok: true; url: string } | { ok: false; code: "no-base-url" | "invalid-base-url" | "insecure-base-url" };
export function classifyKey(key: unknown):
  { ok: true; key: string } | { ok: false; outcome: SmokeOutcome };   // no-key | key-reference | invalid-key
export function runSmoke(values: Values, apiKey: unknown, deps: SmokeDeps): Promise<SmokeReport>; // never rejects
export function formatSmoke(report: SmokeReport): string[];   // stdout lines incl. the no-key hint line
export function smokeFailed(report: SmokeReport): boolean;
```
Rules (contract section 9, exactly):
- `pickSmokeEnv` copies only `SMOKE_ENV_NAMES` that are strings; `runSmoke` applies it again to
  `deps.env` (defence in depth).
- azdo: `resolveSettings(values, { env })` (ignore warnings) -> `fetchRemoteConfig(settings,
  { env, fetch?, runAz?, setTimeout?, clearTimeout? })` -> `parseJsonc` -> plain-object root.
  Codes as contract 9.1. Fetched text is never printed, stored or returned.
- bifrost: order of contract 9.2 rows 1-9. baseURL read with own-property access on plain
  objects only (`Object.hasOwn` + `isPlainObject`). Request fn = `deps.fetch ?? globalThis.fetch`
  read **at call time**. Headers exactly `{ Accept: "application/json", Authorization: "Bearer " + key }`.
  One `AbortController` + one timer (`settings.timeoutMs`) for request and body; timer cleared in
  `finally`; body cancelled (guarded, not awaited) on every non-pass path after a response; body
  read via `getReader()` with a running total > 1048576 -> `too-large`; `content-length` > 1048576
  -> `too-large`; non-2xx -> `fail <status>` (bare integer string).
- Each check wrapped in try/catch -> `fail internal`. No error message, body, URL, key, PAT or
  token goes into the report.
- `formatSmoke`: `smoke azdo: pass|fail <code>`, `smoke bifrost: pass|fail <code>|skipped <code>`,
  plus `Smoke test: set KILO_BIFROST_KEY and re-run install.sh to check your Bifrost virtual key.`
  after `skipped no-key`.

### BE-3 `installer/install-helper.ts`: smoke phase (AC-1, AC-2, AC-4, AC-7)
- `parseRecords`: accept optional `smoke` (at most once, value `on`|`off`, else bad helper input
  exit 3); absent = `off`. The seven required names are unchanged.
- `Plan`: add `effectiveApiKey: unknown` = fresh: `apiKey ?? PLACEHOLDER_KEY`; update:
  `storedApiKey(update.result)`. Never printed.
- `run()`: after `applyPlan`, print warnings and install lines exactly as today (dropped-options
  note, key hint), then if smoke is `on`: `report = await runSmoke(values, plan.effectiveApiKey,
  { env: pickSmokeEnv(process.env) })` (no `fetch`/`runAz` injected in production), print
  `formatSmoke(report)` to stdout, print `Done.`; if `smokeFailed(report)` print
  `install.sh: error: smoke test failed; the installation was kept.` to stderr and set
  `process.exitCode = 4`. A throw from the smoke phase must not reach the top-level catch (that
  maps to exit 3): guard it and treat as exit 4 with the same stderr line.
- Smoke phase writes nothing. Exit 1/2/3 paths unchanged and never run the smoke phase.

### BE-4 `tools/check-fr11.mjs`: lint rule 7 (AC-8)
- For every file directly in `installer/` (any extension, raw text, comments included): error
  `forbidden test switch "<KILO_TEST_|NODE_OPTIONS>" in installer/<file>` when the text contains
  `KILO_TEST_` or `NODE_OPTIONS`. Skipped when `installer/` does not exist.
- `test/tools/check-fr11.test.ts`: one failing case per token (temp root with
  `installer/x.ts` and `installer/x.sh`) and the real repo passing.

### BE-5 Test infrastructure (test-only; AC-1..AC-7)
- `test/installer/fixtures/fake-network.ts` (preload, never imported by product code):
  - On load append `{"event":"loaded"}` to the log (sync `appendFileSync`).
  - Scenario file path from `process.env.KILO_TEST_FAKE_NET`: JSON
    `{ "log": "<abs path>", "azdo": <answer>, "bifrost": <answer> }`, answer one of
    `{ "status": n, "content": "<text>" }` (azdo: body `JSON.stringify({ content })`),
    `{ "status": n, "body": "<raw text>", "headers": {...} }`, `{ "mode": "hang" }` (never resolves,
    rejects with an AbortError when `init.signal` aborts), `{ "mode": "throw", "message": "<canary>" }`.
  - Replaces `globalThis.fetch`: logs `{"event":"request","url","method","headers"(lower-cased keys
    via new Headers),"redirect"}`, routes `https://dev.azure.com/` -> `azdo`, every other URL ->
    `bifrost` answer (an absent answer, or no scenario at all, = deny: log then reject).
  - Returns real `Response` objects (streaming bodies).
- `test/installer/helpers.ts`:
  - `runInstall(sb, args, extraEnv, opts?: { smoke?: boolean; scenario?: object })`: unless
    `opts.smoke`, spawn args become `[installShPath, "--no-smoke", ...args]`; always set
    `NODE_OPTIONS=--import=<pathToFileURL(fixture).href>` and `MSYS2_ENV_CONV_EXCL=NODE_OPTIONS`
    (harmless on Linux); with `opts.scenario` write it to `<root>/net.json` (log `<root>/net.log`)
    and set `KILO_TEST_FAKE_NET`. Extra env still merges last.
  - `readNetLog(sb)` -> parsed entries; `requests(sb)` filters `event === "request"`; tests assert
    the `loaded` marker whenever they rely on the fake (guards against a silently dropped preload).
  - `stubAz(sb, mode, token?)`: when `token` is given, `account get-access-token ...` prints it and
    exits 0 (log line kept). Windows: also write `az.cmd` (`@echo <token>`) and pass `ComSpec`;
    if that is not workable the AC-5 child test may `t.skip("az runner uses cmd.exe on Windows")`
    (AC-5 stays covered by BE-6 unit tests on every platform).
  - `expectedItemsUrl(org, project, repo, path, branch)` built literally (not by importing plugin
    internals) for AC-1.
- Existing `install-sh.test.ts` keeps working unchanged through the new `runInstall` default
  (`--no-smoke` + deny preload). Update the `--help` assertion only if it checks exact text.

### BE-6 Tests (must exist)
`test/installer/smoke.test.ts` (unit, fakes, no child process):
- modelsUrl: `https://bifrost.yourcompany.internal/v1` and `.../v1/` and `.../v1//` -> `.../v1/models`;
  `https://h` -> `https://h/models`; `http://...` -> insecure-base-url; `ftp:` -> insecure-base-url;
  `not a url`, `https://u:p@h/v1`, `https://h/v1?x=1`, `https://h/v1#f` -> invalid-base-url;
  missing / number / null -> no-base-url. (AC-3)
- classifyKey: placeholder, `""`, `undefined`, `42` -> skipped no-key; `{env:K}` -> skipped
  key-reference; `"a b"`, `"é"`, 4097 chars -> fail invalid-key; `sk-bf-x` -> ok. (AC-3, AC-4)
- runSmoke with fake fetch / runAz / env: success (one azdo + one bifrost call, headers exact,
  bifrost URL exact, `redirect: "manual"`); 401 -> `fail 401`; 302 -> `fail 302`; azdo `http-404`
  -> bifrost `skipped azdo-failed` and fetch called once; invalid JSONC -> `invalid-jsonc`;
  array root -> `invalid-shape`; no/insecure/invalid baseURL -> no bifrost call; hang with
  `KILO_AZDO_TIMEOUT_MS: "50"` -> `timeout` within a bounded time for each check; throwing fetch
  -> `network`; content-length 2 MiB and a 1 MiB + 1 streamed body -> `too-large`; 200 with
  non-JSON body -> `bad-response`; no PAT + runAz token -> azdo `Bearer <token>`, bifrost header
  only the key; PAT -> azdo `Basic`, bifrost never sees PAT/token (AC-5); `pickSmokeEnv` drops
  other names; report/format output never contains key, PAT, token, Basic credential, error
  message or body canary (AC-6).
`test/installer/install-smoke.test.ts` (child bash, temp HOME, stub node/az, fake-network preload):
- AC-1: shipped `shared-config/kilo.jsonc` via fake AzDO, Bifrost 200 `{"object":"list","data":[]}`,
  AZDO_PAT + KILO_BIFROST_KEY -> exit 0, both `pass`, AzDO URL equals expected Items URL with
  `api-version=7.1`, exactly one Bifrost request to `https://bifrost.yourcompany.internal/v1/models`
  with `authorization: Bearer <key>`; `loaded` marker present.
- AC-2: Bifrost 401 -> `smoke bifrost: fail 401`, exit 4; AzDO 404 -> `smoke azdo: fail http-404`,
  `smoke bifrost: skipped azdo-failed`, no non-AzDO request, exit 4; `snapshot(configDir)` equal
  to a success run with the same inputs in a second sandbox.
- AC-3: hang (`KILO_AZDO_TIMEOUT_MS=300`) for azdo and for bifrost -> `fail timeout`, elapsed
  < 10 s; invalid JSONC, no baseURL, `http://` baseURL, unparseable baseURL -> fixed codes, no
  request to any non-`https://dev.azure.com/` URL, exit 4.
- AC-4: no KILO_BIFROST_KEY fresh -> `skipped no-key` + hint line, no Bifrost request, exit 0;
  existing config with `sk-bf-existing` and no KILO_BIFROST_KEY -> `Bearer sk-bf-existing`.
- AC-5: no PAT, stub az with token -> AzDO `authorization: Bearer <token>`, Bifrost only the key
  (Windows skip allowed, see BE-5).
- AC-6: KILO_BIFROST_KEY `sk-bf-AbCdEf1234567890`, sentinel AZDO_PAT, sentinel az token, on
  success / 401 / 404 / timeout / throw (`message` canary) / body canary paths: stdout+stderr
  contain none of the sentinels, the base64 Basic credential, the canaries, nor a stack (`\n\s+at `).
- AC-7: `--no-smoke` with the recording scenario -> no request logged, no `get-access-token` in
  the az log, no line starting `smoke `, exit 0; exit-1/2/3 cases (missing creds, bad value,
  invalid existing config) with smoke on -> no request logged and no `smoke ` line.
- AC-8: extend the `install.sh avoids ...` test is not needed; rule 7 covers test switches.

### BE-7 Gate (AC-8)
- `npm run lint`, `npm run typecheck`, `npm test` in `backend/`, then `bash scripts/ci.sh` exit 0.
- `git diff --stat` shows no change to `plugin/azdo-remote-config.ts`,
  `personal-config/kilo.jsonc`, `package.json` `dependencies`.

### T-019 overlap (do NOT implement T-019 in this cycle)
- BE-1 edits `install.sh` next to the `script_dir` lines that T-019 (sec low 2) will change; leave
  them as they are so T-019 stays a separate, reviewable change.
- The AC-6 test uses an `sk-bf-` prefixed key for smoke runs, which partly covers T-019 review
  info 3 (leak test with an `sk-bf-` key) for the smoke path only; T-019 stays `todo`.
- The `runInstall` change (prepend `--no-smoke`) affects the existing tests T-019 will touch
  (Node 22.18 version test); no conflict expected.

## Frontend tasks
- None. F-019 scope is backend only (`frontend/` intentionally absent).

## Security notes for the Security engineer
- **Key handling**: the key enters via `KILO_BIFROST_KEY` -> stdin record (no argv/env leakage
  beyond what F-010 already had) -> helper memory -> personal config (as before) and the
  `Authorization` header of exactly one GET to an https URL. Never printed, never sent to AzDO,
  never to a non-https URL, no redirect following (`redirect: "manual"`), Node fetch rejects
  credentials-in-URL and the design rejects them earlier (`invalid-base-url`).
- **PAT / az token**: read by the helper only in the smoke phase from a filtered env copy and
  handed only to the plugin's `fetchRemoteConfig` (fixed host `https://dev.azure.com/`, ADR-0007).
  Never on the Bifrost request.
- **No redirect seam in product code**: no flag / env / record can change the AzDO host or relax
  https. The test preload is activated only through `NODE_OPTIONS`, which already grants
  arbitrary code execution; lint rule 7 keeps `KILO_TEST_` / `NODE_OPTIONS` out of `installer/`.
  Review that `smoke.ts` reads `globalThis.fetch` and nothing env-driven to choose URLs.
- **Untrusted shared config** (ADR-0009): only `provider.bifrost.options.baseURL` is read, own
  properties of plain objects; parse failures map to fixed codes; content never printed.
- **Residual risk (accepted, documented)**: the key is sent to whatever https `baseURL` the shared
  file names. Kilo does the same at runtime; the shared repo is protected by the validator's
  `--allowed-hosts` PR gate (F-007/F-008).
- **Bounded resources**: one deadline per check (`timeoutMs`), 1 MiB body cap, key length 4096.
- **Output**: fixed codes and integer HTTP statuses only; no fetch error text, body, stack.

## Files changed
- `docs/architecture/ADR-0013-installer-smoke-test.md` — new ADR (placement, checks, exit 4, test seam).
- `docs/architecture/contracts/installer-cli.md` — 1.0.0 -> 1.1.0 (`--no-smoke`, `smoke` record, env, exit 4, output, section 9).
- `docs/architecture/ADR-0012-posix-bootstrap-installer.md` — "Amended by ADR-0013" line.
- `docs/architecture/ADR-0001-tech-stack.md` — FR-11 lint rule 7.
- `docs/architecture/overview.md` — C5 row, install data flow with smoke phase, directory layout.
- `factory/runs/cycle-0013/02-architect.md` — this report.

## Verification
- Read-only design work; no product code changed. Checked against plugin source that
  `fetchRemoteConfig` reads `deps.env` / `deps.fetch` / `deps.runAz` via own properties and falls
  back to `globalThis.fetch` at call time and `defaultRunAz`, that `resolveSettings` maps
  `KILO_AZDO_PAT` / `KILO_AZDO_TIMEOUT_MS` from `deps.env`, and that `smoke.ts`'s planned imports
  pass the existing rule-6 allow-list in `tools/check-fr11.mjs`.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Smoke runs in the helper process (optional `smoke` record, absent = off) — keeps normalised
  values and the effective key in memory, backward compatible for 1.0.0 front ends.
- baseURL comes from the shared config only (PO text), even though in `defaults` mode a personal
  baseURL would win at runtime; the template has none.
- `{env:}` / `{file:}` placeholders are not resolved in the smoke test; a key reference is
  `skipped key-reference`, an `{env:}` baseURL fails `invalid-base-url`.
- Bifrost pass requires a 2xx JSON-object body (captive portals returning 200 HTML must not pass).
- `KILO_AZDO_TIMEOUT_MS` is honoured (same knob as the plugin); invalid values silently default.
- `Done.` is printed on exit 0 and exit 4 (the installation is done in both).
- Windows child-process AC-5 test may be skipped (cmd.exe-based az runner); unit tests cover AC-5.

## Follow-ups for the backlog
- F-011 (`install.ps1`): send `smoke=on|off`, support `-NoSmoke`, map exit 4; reuse
  `fixtures/fake-network.ts`.
- F-014 (e2e): reuse the fake-network preload and scenario format.
- F-016 (docs): document exit 4, `--no-smoke`, smoke codes and what to do for each.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0013/02-architect.md
summary: F-019 smoke phase in install-helper via new installer/smoke.ts reusing fetchRemoteConfig/parseJsonc; https-only Bifrost GET /models, exit 4, --no-smoke, test-only NODE_OPTIONS fetch preload, lint rule 7; contract installer-cli 1.1.0, ADR-0013; 7 backend tasks.
