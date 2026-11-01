# Architecture overview - Kilo Shared Config

Last updated: cycle-0022 (F-020). Stack: ADR-0001. Plugin module shape: ADR-0002.
JSONC parser: ADR-0003. Placeholder resolution: ADR-0004. Config merge: ADR-0005.
Settings resolution: ADR-0006. Azure DevOps fetch and auth: ADR-0007.
Hook wiring, cache, logging, never-crash: ADR-0008. Trust boundary: ADR-0009.
Shared config validator: ADR-0010. Personal config template: ADR-0011.
POSIX bootstrap installer: ADR-0012. Installer smoke test: ADR-0013.
Windows bootstrap installer (install.ps1): ADR-0014.
Shared config repo template, PR pipeline and branch-policy script: ADR-0015.
End-to-end simulated startup harness (test only): ADR-0016.
User/operator docs structure and the automated docs check: ADR-0017.
Config cache bound to the settings that produced it: ADR-0018.
Installer smoke-test network pre-flight (Azure IP firewall / VPN): ADR-0019.
Contracts: `contracts/plugin-interface.md`, `contracts/validator-cli.md`,
`contracts/personal-config-template.md`, `contracts/installer-cli.md`,
`contracts/shared-config-repo.md`, `contracts/e2e-harness.md` (test only),
`contracts/docs-check.md` (repo docs gate, F-016).

## Components

| ID | Component | Source in this repo | Deployed to | Status |
|---|---|---|---|---|
| C1 | Shared config repo: example config + validation (PR gate) | `backend/shared-config/` (kilo.jsonc, azure-pipelines.yml, set-branch-policies.sh, package.json, .gitattributes), `backend/validator/`, `backend/tools/assemble-shared-repo.ts` | Azure DevOps `kilo-config` repo, its PR pipeline and `main` branch policies | **example config + validator CLI (F-007)** + **repo template, assemble tool, PR pipeline, branch-policy script (F-008, ADR-0015)** |
| C2 | Remote config plugin (single file, FR-11) | `backend/plugin/azdo-remote-config.ts` | `~/.config/kilo/azdo/azdo-remote-config.ts` | **stub (T-001) + JSONC parser (F-001) + placeholder resolver (F-002) + merge (F-003) + settings resolution (F-004) + AzDO fetch/auth (F-005) + hook wiring, cache, fallback, logging (F-006) + cache bound to settings (T-013, ADR-0018) + firewall / network failure classification and log hints (F-021, ADR-0020)** |
| C3 | Personal config template | `backend/personal-config/kilo.jsonc` | `~/.config/kilo/kilo.jsonc` | **template + tests (F-009)**; copied by installers (F-010/F-011) |
| C4 | Bifrost gateway | external, not in repo | - | external |
| C5 | Bootstrap installer | `backend/installer/` (`install.sh` + `install.ps1` front ends; `install-helper.ts` + `personal-config-edit.ts` + `smoke.ts` + `fs-guard.ts`) | engineer runs it from a checkout that keeps `installer/`, `plugin/`, `personal-config/` side by side | **install.sh (F-010, ADR-0012) + smoke test (F-019, ADR-0013) + install.ps1 (F-011, ADR-0014)** |
| C6 | Key provisioning | `backend/provisioning/` | platform-team tooling | **skipped by user decision** (F-012/F-013): virtual keys are issued and disabled by hand by the platform team |

There is no frontend and no server process. `frontend/` is intentionally absent.

## Data flow (runtime, engineer machine)

```
Kilo start
  -> reads ~/.config/kilo/kilo.jsonc (C3), finds plugin tuple ["./azdo/azdo-remote-config.ts", {opts}]
  -> loads C2 (default export {id, server}) and calls server(input, opts) -> hooks
  -> calls hooks.config(resolvedConfig) = runConfigHook(input, opts, resolvedConfig) (ADR-0008)
       C2: config not a plain object -> log error, stop
           settings (ADR-0006: opts > KILO_AZDO_* env > defaults; trusted layers only, ADR-0009;
           returns {settings, missing, warnings}; pat non-enumerable; never throws)
           -> each warning logged at warn
           -> missing org/project/repo: log names only, skip fetch (no az) AND skip the cache
              (no binding to verify; log error "... (missing-settings) ... (cache-skipped) ..."), stop
           -> fetchRemoteConfig (ADR-0007): PAT (Basic) | az token (Bearer); fixed host; one
              deadline; 1 MiB cap; returns {ok,text} or a fixed error code; never throws
           -> validateShared: parseJsonc, root plain object, depth < 64 (untrusted, ADR-0009)
              ok:   log info "Loaded shared config from Azure DevOps."
                    write cache ~/.cache/kilo-azdo/remote-config.json = envelope {format
                    "kilo-azdo-cache-v1", binding {org,project,repo,path,branch}, config =
                    sanitised, UNRESOLVED shared config} (no PAT/token; dir 0700, file 0600,
                    temp file "wx" + rename; 2 MiB cap) (ADR-0018)
              fail: read cache (stat regular file <= 2 MiB, read, parse, format -> else
                    cache-outdated, envelope shape -> else cache-invalid, config depth,
                    binding === current settings exactly -> else cache-mismatch)
                    ok   -> log warn "Remote config unavailable (<code>); using cached config."
                    none -> log error "... no usable cache (<code>) ...", config untouched, stop
                    either way, right after that line, at most one fixed warn hint (ADR-0020):
                    network-unreachable | network-blocked | timeout -> VPN / allow-list hint;
                    http-401 | http-403 | auth-unavailable -> az login / PAT hint; else none
              (fetch codes, ADR-0020: fetch call fails before deadline -> network-unreachable;
               407, 470 (Azure Firewall deny, T-035) or 403 without JSON Content-Type -> network-blocked;
               JSON 403 -> http-403;
               body never read on non-2xx; still exactly one request, no probe)
           -> resolvePlaceholders {env:}/{file:} (ADR-0004) every run; log unresolved NAMES only
           -> applyShared: mergeConfig rules (ADR-0005) with a write journal; on any throw
              (e.g. frozen config) roll back -> config unchanged, log error
           -> log info "Applied shared config from <remote|cache> in <mode> mode."
           logging: client.app.log.call(app, {body:{service:"azdo-remote-config", level,
           message}}), fixed messages only, no extra, fire and forget (never awaited)
  -> Kilo runs; model calls go to Bifrost (C4) with the engineer's own key
```

Every step of C2 is wrapped so no failure can stop Kilo (FR-10).

## Data flow (bootstrap install, C5; ADR-0012, `contracts/installer-cli.md`)

```
bash installer/install.sh --org O --project P --repo R [--path --branch --mode] [--no-smoke]   (KILO_BIFROST_KEY env)
  install.sh (bash builtins + node + az only, writes nothing):
    parse flags > KILO_AZDO_* env > defaults; missing org/project/repo -> exit 2
    prereqs: node >= 22.18; AZDO_PAT|AZURE_DEVOPS_EXT_PAT|KILO_AZDO_PAT set, else az account show -> exit 1
    script dir: CDPATH= cd -- "${BASH_SOURCE[0]%/*}" && pwd; no regular install-helper.ts there -> exit 3 (T-019)
    printf "%s\0" org=.. project=.. repo=.. path=.. branch=.. mode=.. apiKey=.. smoke=on|off | node installer/install-helper.ts
  install-helper.ts (Node, imports plugin __internals.parseJsonc / resolveSettings):
    read-only phase: validate records + values, configDir = $XDG_CONFIG_HOME/kilo | homedir/.config/kilo,
      lstat targets, read plugin + template + existing kilo.jsonc (<= 1 MiB, parseJsonc, root object),
      plan: fresh = template token replacement | update = personal-config-edit rules; deep-equal -> no-op
    write phase: mkdir 0700, re-lstat configDir/azdo/plugin/kilo.jsonc (fs-guard.ts; symlink -> exit 3),
      chmod only via O_NOFOLLOW fd + fchmod (T-019),
      copy plugin -> configDir/azdo/azdo-remote-config.ts (only if bytes differ),
      backup kilo.jsonc.bak-<UTC ts> (wx, 0600, byte-identical), write kilo.jsonc (tmp wx 0600 + rename)
    never writes configDir/plugin(s)/ (AC-12); never prints key / PAT / file content
    smoke phase (smoke=on, after a successful write; installer/smoke.ts; ADR-0013, ADR-0019):
      probe:   GET https://dev.azure.com/ (no headers, redirect manual, timeoutMs); 403/407/470 -> azdo-blocked,
               error -> azdo-unreachable, deadline -> azdo-timeout => azdo skipped network-blocked (no PAT, no az)
      azdo:    __internals.resolveSettings(values, {env: PAT vars + KILO_AZDO_TIMEOUT_MS only})
               -> __internals.fetchRemoteConfig (fixed host, PAT|az token, deadline, 1 MiB) -> parseJsonc
      bifrost: shared provider.bifrost.options.baseURL, https only, key present ->
               probe GET <origin>/ (same rule; bifrost-blocked|unreachable|timeout => skipped network-blocked,
               key never sent) -> GET <baseURL>/models,
               Bearer <effective apiKey>, redirect manual, timeoutMs, 1 MiB, JSON object body
      prints "smoke network: pass|fail <codes>" first, then "smoke azdo|bifrost: pass|fail <code>|skipped <code>",
      then the no-key hint, then at most one VPN/allow-list hint (network fail, or azdo fail
      network-unreachable|network-blocked|timeout, or bifrost fail network|timeout|407|470;
      installer-cli 9.4, ADR-0019 A1); any fail -> exit 4 (install kept)
```

## Data flow (Windows bootstrap install, C5; ADR-0014, `contracts/installer-cli.md` section 10)

```
powershell -NoProfile -ExecutionPolicy Bypass -File installer\install.ps1 -Org O -Project P -Repo R [-Path -Branch -Mode] [-NoSmoke]   (KILO_BIFROST_KEY env)
  install.ps1 (PowerShell 5.1 / 7+, no modules, writes nothing; manual $args parsing, no param() block):
    help scan; parse (case-insensitive exact names) > KILO_AZDO_* env > defaults; usage errors -> exit 2 (never echo)
    prereqs: Get-Command node / az (Windows: .exe/.cmd/.bat/.com only); node >= 22.18;
             PAT var set, else az(.cmd) account show -> exit 1
    helper = $PSScriptRoot\install-helper.ts (missing -> exit 3); Windows + XDG_CONFIG_HOME set -> ACL warning
    bytes = UTF-8 (no BOM) of org=..\0 project=..\0 ... apiKey=..\0 smoke=on|off\0 frontend=install.ps1\0
    System.Diagnostics.Process(node "<helper>", stdin redirected, stdout/stderr inherited) <- bytes; exit = helper exit code
  install-helper.ts: exactly as above (same files, same smoke test); messages use the install.ps1 prefix
  Windows: no chmod, no ACL calls; files inherit the profile ACL (user, SYSTEM, Administrators)
```

## End-to-end simulated startup (TEST ONLY, F-014; ADR-0016, `contracts/e2e-harness.md`)

```
test/e2e/startup.test.ts (node:test, skipped with a reason when bash is missing)
  -> temp sandbox: home/, bin/{node stub, az stub that fails}, work/
  -> install.sh in child bash (runInstall: allow-listed env, deny-all fetch preload, --no-smoke
     unless the smoke scenario opts in; fake Bifrost/AzDO "auth" answers check the key / PAT)
  -> per Kilo start: child node --import=fake-network.ts kilo-start-simulator.ts --out <file>
       env built from scratch (HOME/USERPROFILE = sandbox home, PATH = stub bin, AZDO_PAT, scenario)
       reads INSTALLED ~/.config/kilo/kilo.jsonc, resolves plugin entries against the config dir
       (+ auto-load plugin/ and plugins/), imports the INSTALLED azdo/azdo-remote-config.ts,
       server(input{client.app.log}, options) -> await hooks.config(parsed personal config)
       -> result file {entries, serverCalls, hookCalls, initialConfig, config, logs}
  -> successive starts share HOME, so ~/.cache/kilo-azdo/remote-config.json carries over
  -> assertions: merged config, log records, request log, cache file, config dir snapshot,
     no secret in any stdout/stderr/log record
```

Real Kilo, the VS Code extension, real AzDO and real Bifrost are not used. That part of vision AC-1 is a manual
Phase 0 check (F-016 docs).

## Data flow (PR gate, shared config repo C1; ADR-0010, `contracts/validator-cli.md`)

```
PR to main in kilo-config
  -> blocking build-validation policy (set-branch-policies.sh) queues azure-pipelines.yml (ADR-0015)
     ubuntu-latest, UseNode@1 22.x (+ guard >= 22.18), no npm; bash step:
  -> node validator/validate-kilo-config.ts --allowed-hosts "$KILO_ALLOWED_HOSTS" -- kilo.jsonc [teams/*/kilo.jsonc that exist]
       per file: stat (I/O error -> exit 2) -> size <= 1 MiB -> UTF-8 -> __internals.parseJsonc
       -> root plain object -> depth < 64 -> tree rules (apiKey, sk-bf- in keys/values,
          prototype keys, prototype member names, {file:} probe via __internals.resolvePlaceholders
          with fakes, top-level plugin, baseURL host allowlist) -> vendored schema subset
       -> raw-text sk-bf- line scan (catches comments)
       output: "<file>: <severity> <rule> at <path|line N>: <fixed message>", never values
  -> exit 0 valid (warnings ok) | 1 errors | 2 usage / I/O / internal  -> non-zero fails the PR
  merge also needs: >= 1 approver (creator vote does not count) + platform-team required reviewer
```

## Producing and protecting C1 (platform team; ADR-0015, `contracts/shared-config-repo.md`)

```
node backend/tools/assemble-shared-repo.ts <empty dir>
  -> fixed 9-file manifest, byte-identical copies (COPYFILE_EXCL), refuses non-empty dir:
     .gitattributes azure-pipelines.yml kilo.jsonc package.json set-branch-policies.sh
     validator/{validate-kilo-config.ts,kilo-config-rules.ts,kilo-schema-subset.json}
     plugin/azdo-remote-config.ts                      (same relative layout as backend/)
  -> platform team pushes the tree to the kilo-config repo, creates the pipeline from azure-pipelines.yml
bash set-branch-policies.sh --org O --project P --repository-id <guid> --reviewer-group G --build-definition-id N [--dry-run]
  (bash builtins + az only; az login or AZURE_DEVOPS_EXT_PAT; no token flag)
  -> az repos policy approver-count create ... --branch main --blocking true --minimum-approver-count 1
  -> az repos policy required-reviewer create ... --required-reviewer-ids G --blocking true
  -> az repos policy build create ... --build-definition-id N --blocking true (expires when main updates)
  each value one argv element; az output discarded; stop at first failure (exit 1); usage exit 2
```

The validator imports the plugin file by relative path and does not modify it. The plugin's
export surface is unchanged.

## Internal structure of C2 (single file, sections in this order)

Since T-037 (ADR-0021) the file opens with a table of contents and has exactly these 15 numbered
section banners (`// ==== N. Title ====`); every hot-path function carries a JSDoc block with an
`Invariants:` line and `@see` pointers. Checked by `backend/test/plugin/source-layout.test.ts`.

1. Imports, public types and plugin identity: `node:` imports only (`node:child_process`,
   `node:fs`, `node:os`, `node:path`), structural Kilo types (contract section 1), `PLUGIN_ID`,
   `SUPPORTED_KILO_RANGE`
2. Shared guards and helpers (`noop`, `attempt`, `readOwn`, `isRecordLike`, `isPlainObject`)
3. JSONC parser (`parseJsonc`, ADR-0003)
4. Placeholder resolver (`resolvePlaceholders`, ADR-0004: sync; env / homedir / readFile
   injectable, defaults process.env / os.homedir / a guarded reader: `fs.statSync` then
   `fs.readFileSync`, regular files of at most 1 MiB only; UNC-style `{file:}` paths are rejected
   before any read)
5. Config merge (`mergeConfig`, ADR-0005: two phases, sanitize then merge; `applyShared`, the
   journaled transactional merge of ADR-0008 section 6)
6. Settings resolution (`resolveSettings`, ADR-0006: options > `KILO_AZDO_*` env > defaults; env
   injectable, default `process.env` at call time)
7. Fetch foundations: types, target, Items API URL, injectable fetch / clock, the single deadline
8. Authentication: PAT (Basic) then `az` bearer token; default runner `execFile` without a shell,
   on Windows `cmd.exe /d /s /c` with a constant command line
9. Response handling and failure classification (ADR-0007 section 10, ADR-0020)
10. Fetch pipeline: `performRequest`, `runFetch`, `fetchRemoteConfig` (F-005, ADR-0007)
11. Shared config validation (`validateShared`, ADR-0008 section 3, ADR-0009)
12. Config cache bound to settings (`readCache` / `writeCache`, ADR-0008 section 4, ADR-0018)
13. Logging, fixed messages and hints (`makeLogger`, `LOG_*`, `hintFor`, ADR-0008, ADR-0020)
14. Config hook (`executeHook`, `runConfigHook`, F-006, ADR-0008)
15. Exports: `__internals` (6 keys, last `runConfigHook`), `AzdoRemoteConfig` server function
    (no I/O) whose `config` hook calls `runConfigHook`, `default { id, server }` (last statement)

## Directory layout

```
backend/                     # the only package (ADR-0001 section 7)
  plugin/azdo-remote-config.ts
  shared-config/              # C1 repo template, every file copied to the C1 root (ADR-0015)
    kilo.jsonc                #   example C1 /kilo.jsonc (F-007)
    azure-pipelines.yml       #   F-008: PR gate pipeline
    set-branch-policies.sh    #   F-008: branch policies on main via az repos policy (bash)
    package.json              #   F-008: {"type":"module"}, no dependencies (validator needs ESM)
    .gitattributes            #   F-008: "* text eol=lf"
  personal-config/kilo.jsonc  # C3 template, copied to ~/.config/kilo/kilo.jsonc (F-009, ADR-0011)
  validator/                  # F-007: validate-kilo-config.ts (CLI), kilo-config-rules.ts (lib),
                              #        kilo-schema-subset.json (vendored, pinned to SUPPORTED_KILO_RANGE)
  tools/check-fr11.mjs        # FR-11 guard + import guards (rules 5, 6) + no test switches in installer/ (rule 7)
                              #   + tools/*.ts node:-only imports (rule 8, F-008)
  tools/assemble-shared-repo.ts  # F-008: writes the complete C1 tree into an empty dir (ADR-0015)
  test/shared-config/*.test.ts   # F-008: assemble (byte identity), pipeline (text + run in bash), policy script (stub az)
  test/plugin/*.test.ts       # jsonc, placeholders, merge, settings, fetch, hook, smoke
  test/validator/*.test.ts    # rules (lib), cli (child process), schema subset, example config
  test/personal-config/*.test.ts  # template checks via plugin __internals + validator library (F-009)
  test/tools/check-fr11.test.ts
  tools/check-docs.mjs        # F-016: docs gate (pages, links/anchors, required text, Kilo range, sk-bf- scan,
                              #   forbidden scope) - ADR-0017, contracts/docs-check.md; run by scripts/ci.sh
  test/tools/check-docs.test.ts  # F-016: hermetic temp-dir fixtures, negative controls
  tools/compare-plugin-shape.mjs # T-037: dev-only, manual move-only proof for the plugin file (ADR-0021)
  test/tools/compare-plugin-shape.test.ts  # T-037: synthetic base/head fixtures only
  test/plugin/source-layout.test.ts        # T-037: TOC/banners, hot-path JSDoc, comment safety, fresh import
  installer/                  # F-010: install.sh (bash front end), install-helper.ts (Node I/O CLI),
                              # F-011: install.ps1 (PowerShell front end, ASCII, LF) - ADR-0014
                              #        personal-config-edit.ts (pure edit rules) - ADR-0012
                              # F-019: smoke.ts (azdo + bifrost checks, injectable deps) - ADR-0013
                              # F-020: + network pre-flight probes before each credential - ADR-0019
                              # T-019: fs-guard.ts (post-mkdir target re-check, injectable lstat) - ADR-0012
  test/installer/*.test.ts    # edit rules (unit) + install.sh in child bash with temp HOME, stub az (F-010)
                              # + smoke unit tests and install.sh smoke tests (F-019)
                              # + install.ps1 tests via pwsh / powershell.exe, skipped without PowerShell (F-011)
  test/installer/fixtures/fake-network.ts  # TEST ONLY: --import preload replacing globalThis.fetch
                              # (loaded via NODE_OPTIONS by tests; never imported by product code)
                              # F-014: + "auth" answer (401 unless Authorization matches)
                              # F-020: + optional azdoProbe / bifrostProbe answers for origin "/" requests
  test/installer/fixtures/race-after-mkdir.ts  # TEST ONLY (T-019): preload that swaps a target for a
                              # symlink right after the helper's mkdirSync (POSIX race tests)
  test/e2e/startup.test.ts    # F-014: install.sh -> simulated Kilo starts, end to end (ADR-0016)
  test/e2e/helpers.ts         #   sandbox, runStart, probeFetch, assertNoLeaks
  test/e2e/fixtures/kilo-start-simulator.ts  # TEST ONLY: child Node stand-in for Kilo start
  provisioning/               # created by a later item
docs/architecture/           # this folder: overview, ADRs, contracts
docs/engineer-setup.md        # F-016: engineer task guide (links to user-guide reference)
docs/platform-runbook.md      # F-016: platform team procedures, Phase 0 checklist
docs/troubleshooting.md       # F-016: symptom -> fix
docs/user-guide.md, docs/development.md, docs/api.md  # reference, contributor notes, internals
factory/                     # backlog, state, run reports
scripts/ci.sh                # quality gate (CI and local)
.github/workflows/ci.yml     # runs scripts/ci.sh on push / PR to main
```

## Quality gate

`bash scripts/ci.sh` -> in `backend/`: `npm ci`, `npm run lint` (FR-11 guard),
`npm run typecheck` (`tsc --noEmit`, includes `validator/**/*.ts` since F-007 and `installer/**/*.ts` since F-010), `npm test`
(`node --test`, includes `test/validator/` and, since F-014, `test/e2e/`), plus factory JSON checks,
`scripts/check-lf.sh` and, since F-016, `node backend/tools/check-docs.mjs` run against the real
repository from the root (ADR-0017). `npm test` covers the docs check only with fixtures.
