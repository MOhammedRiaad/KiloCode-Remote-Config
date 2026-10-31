# ADR-0013: Installer smoke test (FR-22) in the install helper, test seam via Node preload
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0013 / F-019
- Amends: ADR-0012 (installer), contract `installer-cli.md` 1.0.0 -> 1.1.0

## Context

FR-22 / AC-10: after a successful install, `install.sh` must prove that the engineer's machine can
(1) read the shared config from Azure DevOps with the same URL / auth rules as the plugin
(FR-2/FR-3, ADR-0007) and (2) reach Bifrost with the engineer's virtual key
(`GET <baseURL>/models`, `Authorization: Bearer <key>`). Constraints from the PO (F-019):

- No second AzDO HTTP/auth implementation: reuse `__internals.fetchRemoteConfig` and
  `__internals.parseJsonc`. The plugin file, its export surface (6 `__internals` keys), the
  validator and the personal config template do not change. Zero runtime deps (FR-11).
- The virtual key and any PAT / az token never appear in argv, output, or a non-https request.
- New exit code 4 = installed but a smoke check failed; the installation is never undone.
- `--no-smoke` skips it (offline machines, and the F-010 tests must stay off the network).
- Tests must fake Azure DevOps and Bifrost without any product option that could redirect the
  AzDO host or relax the https rule. The AzDO host is a module constant
  (`https://dev.azure.com/`) and Bifrost must be https, so plain local HTTP servers cannot stand
  in for them.
- Must run on Linux CI and Windows Git Bash (MSYS2 rewrites path-looking argv/env values).

## Decision

### 1. Placement: smoke phase inside `install-helper.ts`, logic in `installer/smoke.ts`

- `install.sh` gains a `--no-smoke` flag and sends one more stdin record, `smoke=on|off`
  (`on` unless `--no-smoke`). The record is **optional** in the helper protocol (absent = `off`),
  so a 1.0.0 front end keeps working unchanged (additive, contract 1.1.0).
- `install-helper.ts` runs the smoke phase **after** a successful write phase (exit 0 path only:
  never after exit 1/2/3, which all end before it). It prints the install lines as before, then
  the smoke lines, then `Done.`; sets exit code 4 if any check failed.
- The smoke logic lives in a new module `backend/installer/smoke.ts` with injectable
  `fetch` / `runAz` / `env` / timers (unit-tested with fakes, never touches the real network).
  It imports only `../plugin/azdo-remote-config.ts` (for `__internals`) and
  `./personal-config-edit.ts` (for `PLACEHOLDER_KEY`, `isPlainObject`, `Values`), so FR-11 lint
  rule 6 (installer import allow-list) already admits it.

Why in the same process (not a separate `smoke-helper.ts` called by `install.sh`): the helper
already holds the **normalised** settings (`path` with leading `/`, trimmed values) and the
**effective** key that it just planned/wrote (supplied key, or the existing `apiKey` kept on
update, or the placeholder). A second process would need a second stdin protocol, would have to
re-resolve the config dir, re-read and re-parse the file it just wrote (TOCTOU, a second parse
path) and would cost a second Node start. The key never leaves helper memory except as the
Bearer header to the https Bifrost URL (and, as before, the personal config file).

### 2. Inputs of the smoke phase

| Input | Source |
|---|---|
| org, project, repo, path, branch | The validated, normalised values of the install (`Values`). |
| PAT | `resolveSettings(values, { env })` maps `KILO_AZDO_PAT` to the non-enumerable `settings.pat`; `fetchRemoteConfig(settings, { env })` then reads `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT` from `env`, then falls back to the plugin's own az runner. Exactly the FR-3 order. |
| `env` | A **filtered copy** of `process.env` holding only `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`, `KILO_AZDO_PAT`, `KILO_AZDO_TIMEOUT_MS` (absent names omitted). Passed explicitly to both plugin functions, so the plugin never reads `process.env` here and no other `KILO_AZDO_*` (e.g. an MSYS-rewritten `KILO_AZDO_PATH`) can change the target. `resolveSettings` warnings are ignored (not printed); an invalid value just falls back to the default. |
| timeout | `settings.timeoutMs` (`KILO_AZDO_TIMEOUT_MS`, default 5000 ms). One deadline per check. |
| az runner | Not injected in production: the plugin's `defaultRunAz` (execFile `az`, no shell; `cmd.exe /d /s /c` constant line on Windows; cwd = home). |
| fetch | Not injected in production: `globalThis.fetch`, read **at call time** (the plugin already does this; `smoke.ts` must do the same for the Bifrost request). |
| Bifrost key | The `apiKey` now in the personal config, from the plan in memory: fresh -> supplied key or placeholder; update -> `storedApiKey(update.result)`. Never re-read from disk, never printed. |
| baseURL | `provider.bifrost.options.baseURL` of the **fetched shared config** (own properties of plain objects only; ADR-0009: untrusted). Placeholders (`{env:}` / `{file:}`) are not resolved. |

### 3. Check `azdo`

`fetchRemoteConfig(settings, { env })` (deps also carry `fetch` / `runAz` / timers in unit tests
only). `ok: false` -> `fail <code>` with the plugin's fixed code (`invalid-settings`,
`auth-unavailable`, `timeout`, `too-large`, `bad-response`, `network`, `http-<status>`).
`ok: true` -> `parseJsonc(text)`; throws -> `fail invalid-jsonc`; root not a plain object ->
`fail invalid-shape`; else `pass`. The fetched text is not cached, not written, not printed.

### 4. Check `bifrost`

Order (first match wins; nothing is sent before step 5):
1. azdo not `pass` -> `skipped azdo-failed`.
2. baseURL: not an own string property -> `fail no-base-url`; `new URL(base.trim())` throws, or it
   has username/password, a query or a fragment -> `fail invalid-base-url`; protocol is not
   `https:` -> `fail insecure-base-url`. URL = same URL with `pathname` trailing `/` removed plus
   `/models` (`https://bifrost.yourcompany.internal/v1` -> `.../v1/models`; `https://h` -> `https://h/models`).
3. Key: not a string, empty, or equal to `sk-bf-<your-virtual-key>` -> `skipped no-key`; contains
   `{env:` or `{file:` -> `skipped key-reference`.
4. Key not 1..4096 chars of visible ASCII (0x21-0x7E) -> `fail invalid-key` (no request).
5. One request: `fetch(url, { method: "GET", headers: { Accept: "application/json",
   Authorization: "Bearer " + key }, redirect: "manual", signal })` with one AbortController and
   one timer of `timeoutMs` covering request and body. Status not an integer 100..599 ->
   `fail bad-response`; not 2xx -> `fail <status>` (bare number, e.g. `fail 401`, `fail 302`;
   redirects are never followed, the body is cancelled); `content-length` > 1 MiB or more than
   1 MiB streamed -> `fail too-large`; deadline -> `fail timeout`; any throw / rejection ->
   `fail network`; body not UTF-8 JSON with a plain-object root -> `fail bad-response`; else `pass`.
   This is a small dedicated reader in `smoke.ts` (the plugin's reader is not exported and the
   export surface may not grow); it is not an AzDO/auth implementation.

Each check is wrapped: an unexpected throw becomes `fail internal`. `runSmoke` never throws.

### 5. Output and exit code

Smoke lines on stdout, after the install lines and before `Done.`:
`smoke azdo: <pass|fail <code>>`, `smoke bifrost: <pass|fail <code>|skipped <code>>`.
`skipped no-key` is followed by
`Smoke test: set KILO_BIFROST_KEY and re-run install.sh to check your Bifrost virtual key.`
Any `fail` -> stderr `install.sh: error: smoke test failed; the installation was kept.` and exit
4. No fetch error text, response body, URL query, key, PAT, token or Basic credential is ever
printed (fixed codes and integer statuses only). The smoke phase writes no file.

### 6. Test seam: Node `--import` preload that replaces `globalThis.fetch` (test-only)

- `backend/test/installer/fixtures/fake-network.ts` is loaded only by tests, through the child
  environment `NODE_OPTIONS=--import=<file URL of the fixture>`. It replaces `globalThis.fetch`
  with a fake that appends every request (url, method, headers, redirect) as a JSON line to a log
  and answers from a scenario file named by `KILO_TEST_FAKE_NET` (read **only** by the fixture).
  Without a scenario it rejects every request (deny-all) and still logs it.
- Fake AzDO answers the real Items API URL with `{ "content": <text> }`; fake Bifrost answers
  `https://bifrost.yourcompany.internal/v1/models`. Responses are real `Response` objects, so the
  plugin's streaming reader runs unchanged. `hang` answers never resolve (they reject on abort).
- `az` is faked as today by a stub on the sandbox `PATH` (extended to print a token for
  `account get-access-token`). On Windows the plugin runs `cmd.exe`, so a child test there needs
  `az.cmd` and `ComSpec`; it may `t.skip` with a reason, AC-5 is also covered by unit tests.

Why this is safe for production: the product code has **no** test switch at all. It always uses
the fixed AzDO host and `globalThis.fetch`. `NODE_OPTIONS` is Node's own code-loading mechanism: a
party that can set it (or `PATH`, which chooses `node` itself) can already run arbitrary code as
the engineer, so the seam adds no new capability. A new lint rule 7 makes sure product installer
files never mention `KILO_TEST_` or `NODE_OPTIONS`.

### 7. Keeping the F-010 tests off the network

`runInstall` in `test/installer/helpers.ts` prepends `--no-smoke` (before the test's own args, so
"flag without value" cases keep their meaning) unless a test opts in, and always sets the
deny-all preload, so even a regression that ignores `--no-smoke` cannot reach the network.

## Consequences

- One AzDO code path for plugin and installer; the smoke result predicts what Kilo will see.
- Exit code 4 is new: automation that treated "0 = installed" must also accept 4 as "installed,
  but the environment is not working yet".
- `defaults` mode lets a personal `baseURL` override the shared one at Kilo runtime; the smoke
  test checks the shared value only (template has none). Placeholders in `baseURL` / `apiKey` are
  not resolved (`key-reference` skip; an `{env:}` baseURL fails as `invalid-base-url`).
- The key is sent to whatever https `baseURL` the shared file names; Kilo itself does the same
  at runtime, and the shared repo is protected by the PR-gate validator (`--allowed-hosts`).
- F-011 (`install.ps1`) reuses the helper and only needs to send `smoke=on|off`.

## Alternatives considered

- **Separate smoke helper process**: second protocol, re-reads the written file, second parse.
  Rejected (section 1).
- **Product env var / flag for the AzDO or Bifrost base URL** (e.g. `KILO_SMOKE_AZDO_URL`): would
  let any environment influence redirect PAT-bearing requests. Explicitly forbidden. Rejected.
- **Local fake HTTPS servers + `NODE_EXTRA_CA_CERTS` + hosts override**: needs certificates and
  DNS changes on CI and Windows. Rejected.
- **Env-gated test module inside product code** (`if (process.env.KILO_TEST_...) import(...)`):
  a product-level switch an attacker could flip. Rejected for the external preload.
- **Exporting the plugin's body reader / adding an `__internals` key**: plugin surface is frozen.
  Rejected.
- **Pass = 2xx without reading the body**: a captive portal returning 200 HTML would pass.
  Rejected; a JSON object body is required.
