# Architecture overview - Kilo Shared Config

Last updated: cycle-0010 (F-009). Stack: ADR-0001. Plugin module shape: ADR-0002.
JSONC parser: ADR-0003. Placeholder resolution: ADR-0004. Config merge: ADR-0005.
Settings resolution: ADR-0006. Azure DevOps fetch and auth: ADR-0007.
Hook wiring, cache, logging, never-crash: ADR-0008. Trust boundary: ADR-0009.
Shared config validator: ADR-0010. Personal config template: ADR-0011.
Contracts: `contracts/plugin-interface.md`, `contracts/validator-cli.md`,
`contracts/personal-config-template.md`.

## Components

| ID | Component | Source in this repo | Deployed to | Status |
|---|---|---|---|---|
| C1 | Shared config repo: example config + validation (PR gate) | `backend/shared-config/kilo.jsonc`, `backend/validator/` | Azure DevOps `kilo-config` repo and pipeline | **example config + validator CLI (F-007)**; pipeline and branch policy planned (F-008) |
| C2 | Remote config plugin (single file, FR-11) | `backend/plugin/azdo-remote-config.ts` | `~/.config/kilo/azdo/azdo-remote-config.ts` | **stub (T-001) + JSONC parser (F-001) + placeholder resolver (F-002) + merge (F-003) + settings resolution (F-004) + AzDO fetch/auth (F-005) + hook wiring, cache, fallback, logging (F-006)** |
| C3 | Personal config template | `backend/personal-config/kilo.jsonc` | `~/.config/kilo/kilo.jsonc` | **template + tests (F-009)**; copied by installers (F-010/F-011) |
| C4 | Bifrost gateway | external, not in repo | - | external |
| C5 | Bootstrap installer | `backend/installer/` (`install.ps1`, `install.sh`) | C1 repo | planned |
| C6 | Key provisioning | `backend/provisioning/` | platform-team tooling | planned |

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
           -> missing org/project/repo: log names only, skip fetch (no az), go to cache fallback
           -> fetchRemoteConfig (ADR-0007): PAT (Basic) | az token (Bearer); fixed host; one
              deadline; 1 MiB cap; returns {ok,text} or a fixed error code; never throws
           -> validateShared: parseJsonc, root plain object, depth < 64 (untrusted, ADR-0009)
              ok:   log info "Loaded shared config from Azure DevOps."
                    write cache ~/.cache/kilo-azdo/remote-config.json = sanitised, UNRESOLVED
                    shared config (dir 0700, file 0600, temp file "wx" + rename; 2 MiB cap)
              fail: read cache (stat regular file <= 2 MiB, read, validateShared)
                    ok   -> log warn "Remote config unavailable (<code>); using cached config."
                    none -> log error "... no usable cache (<code>) ...", config untouched, stop
           -> resolvePlaceholders {env:}/{file:} (ADR-0004) every run; log unresolved NAMES only
           -> applyShared: mergeConfig rules (ADR-0005) with a write journal; on any throw
              (e.g. frozen config) roll back -> config unchanged, log error
           -> log info "Applied shared config from <remote|cache> in <mode> mode."
           logging: client.app.log.call(app, {body:{service:"azdo-remote-config", level,
           message}}), fixed messages only, no extra, fire and forget (never awaited)
  -> Kilo runs; model calls go to Bifrost (C4) with the engineer's own key
```

Every step of C2 is wrapped so no failure can stop Kilo (FR-10).

## Data flow (PR gate, shared config repo C1; ADR-0010, `contracts/validator-cli.md`)

```
PR to main in kilo-config (F-008 wires this into Azure Pipelines)
  -> node validator/validate-kilo-config.ts [--allowed-hosts <bifrost host>] kilo.jsonc teams/*/kilo.jsonc
       per file: stat (I/O error -> exit 2) -> size <= 1 MiB -> UTF-8 -> __internals.parseJsonc
       -> root plain object -> depth < 64 -> tree rules (apiKey, sk-bf- in keys/values,
          prototype keys, prototype member names, {file:} probe via __internals.resolvePlaceholders
          with fakes, top-level plugin, baseURL host allowlist) -> vendored schema subset
       -> raw-text sk-bf- line scan (catches comments)
       output: "<file>: <severity> <rule> at <path|line N>: <fixed message>", never values
  -> exit 0 valid (warnings ok) | 1 errors | 2 usage / I/O / internal
```

The validator imports the plugin file by relative path and does not modify it. The plugin's
export surface is unchanged.

## Internal structure of C2 (single file, sections in this order)

0. `node:` imports only (since F-002: `node:fs`, `node:os`, `node:path`; since F-005: `node:child_process`; F-006 adds more `node:fs` functions)
1. Types (structural Kilo types, contract section 1)
2. Constants (`PLUGIN_ID`, `SUPPORTED_KILO_RANGE`, defaults)
3. Pure helpers: JSONC parser, placeholder resolver (sync; env / homedir / readFile
   injectable, defaults process.env / os.homedir / a guarded reader: `fs.statSync` then
   `fs.readFileSync`, regular files of at most 1 MiB only; UNC-style `{file:}` paths are
   rejected before any read), merge (`mergeConfig`, ADR-0005: two phases, sanitize then merge,
   pure apart from mutating its `target` argument), settings (`resolveSettings`, ADR-0006:
   options > `KILO_AZDO_*` env > defaults; env injectable, default `process.env` at call time)
4. I/O helpers with injectable seams: `fetchRemoteConfig` (F-005, ADR-0007: fetch, env, `az`
   runner, setTimeout/clearTimeout injectable; default runner `execFile` without a shell, on
   Windows `cmd.exe /d /s /c` with a constant command line)
5. Hook orchestration (F-006, ADR-0008): `validateShared`, cache read/write (`fs` + `homedir`
   injectable), logger adapter, `applyShared` (journaled merge), `runConfigHook`
6. `AzdoRemoteConfig` server function (no I/O) whose `config` hook calls `runConfigHook`
7. Exports: `__internals` (6 keys, last `runConfigHook`), constants, `default { id, server }`

## Directory layout

```
backend/                     # the only package (ADR-0001 section 7)
  plugin/azdo-remote-config.ts
  shared-config/kilo.jsonc    # example C1 /kilo.jsonc (F-007)
  personal-config/kilo.jsonc  # C3 template, copied to ~/.config/kilo/kilo.jsonc (F-009, ADR-0011)
  validator/                  # F-007: validate-kilo-config.ts (CLI), kilo-config-rules.ts (lib),
                              #        kilo-schema-subset.json (vendored, pinned to SUPPORTED_KILO_RANGE)
  tools/check-fr11.mjs        # FR-11 guard + validator import guard (rule 5)
  test/plugin/*.test.ts       # jsonc, placeholders, merge, settings, fetch, hook, smoke
  test/validator/*.test.ts    # rules (lib), cli (child process), schema subset, example config
  test/personal-config/*.test.ts  # template checks via plugin __internals + validator library (F-009)
  test/tools/check-fr11.test.ts
  installer/ provisioning/    # created by later items
docs/architecture/           # this folder: overview, ADRs, contracts
factory/                     # backlog, state, run reports
scripts/ci.sh                # quality gate (CI and local)
.github/workflows/ci.yml     # runs scripts/ci.sh on push / PR to main
```

## Quality gate

`bash scripts/ci.sh` -> in `backend/`: `npm ci`, `npm run lint` (FR-11 guard),
`npm run typecheck` (`tsc --noEmit`, includes `validator/**/*.ts` since F-007), `npm test`
(`node --test`, includes `test/validator/`), plus factory JSON checks.
