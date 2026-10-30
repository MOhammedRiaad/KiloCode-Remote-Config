# Architecture overview - Kilo Shared Config

Last updated: cycle-0005 (F-003). Stack: ADR-0001. Plugin module shape: ADR-0002.
JSONC parser: ADR-0003. Placeholder resolution: ADR-0004. Config merge: ADR-0005.
Contract: `contracts/plugin-interface.md`.

## Components

| ID | Component | Source in this repo | Deployed to | Status |
|---|---|---|---|---|
| C1 | Shared config repo validation (PR gate) | `backend/validator/` | Azure DevOps `kilo-config` pipeline | planned |
| C2 | Remote config plugin (single file, FR-11) | `backend/plugin/azdo-remote-config.ts` | `~/.config/kilo/azdo/azdo-remote-config.ts` | **stub (T-001) + JSONC parser (F-001) + placeholder resolver (F-002) + merge (F-003); helpers not yet wired (F-006)** |
| C3 | Personal config template | `backend/templates/` | `~/.config/kilo/kilo.jsonc` | planned |
| C4 | Bifrost gateway | external, not in repo | - | external |
| C5 | Bootstrap installer | `backend/installer/` (`install.ps1`, `install.sh`) | C1 repo | planned |
| C6 | Key provisioning | `backend/provisioning/` | platform-team tooling | planned |

There is no frontend and no server process. `frontend/` is intentionally absent.

## Data flow (runtime, engineer machine)

```
Kilo start
  -> reads ~/.config/kilo/kilo.jsonc (C3), finds plugin tuple ["./azdo/azdo-remote-config.ts", {opts}]
  -> loads C2 (default export {id, server}) and calls server(input, opts) -> hooks
  -> calls hooks.config(resolvedConfig)
       C2: settings (opts > KILO_AZDO_* env > defaults)
           -> fetch kilo.jsonc via AzDO Git Items API (PAT Basic | az Entra Bearer, timeout)
           -> parse JSONC -> resolve {env:}/{file:} (ADR-0004; ~/ or absolute paths only)
           -> log unresolved names (never values) -> write cache
              (on failure: read cache; no cache: local only)
           -> merge into resolvedConfig in place (defaults | enforce; ADR-0005: sanitize shared
              first, drop apiKey at any depth and __proto__/constructor/prototype, ignore
              top-level $schema/plugin, arrays replaced wholesale, local apiKey never replaced)
           -> log via client.app.log (service azdo-remote-config, no secrets)
  -> Kilo runs; model calls go to Bifrost (C4) with the engineer's own key
```

Every step of C2 is wrapped so no failure can stop Kilo (FR-10).

## Internal structure of C2 (single file, sections in this order)

0. `node:` imports only (since F-002: `node:fs`, `node:os`, `node:path`)
1. Types (structural Kilo types, contract section 1)
2. Constants (`PLUGIN_ID`, `SUPPORTED_KILO_RANGE`, defaults)
3. Pure helpers: settings, JSONC parser, placeholder resolver (sync; env / homedir / readFile
   injectable, defaults process.env / os.homedir / a guarded reader: `fs.statSync` then
   `fs.readFileSync`, regular files of at most 1 MiB only; UNC-style `{file:}` paths are
   rejected before any read), merge (`mergeConfig`, ADR-0005: two phases, sanitize then merge,
   pure apart from mutating its `target` argument)
4. I/O helpers with injectable seams: fetch, `az` runner, cache fs, clock
5. `AzdoRemoteConfig` server function and `config` hook
6. Exports: `__internals`, constants, `default { id, server }`

## Directory layout

```
backend/                     # the only package (ADR-0001 section 7)
  plugin/azdo-remote-config.ts
  tools/check-fr11.mjs
  test/plugin/*.test.ts       # jsonc, placeholders, merge, smoke
  validator/ templates/ installer/ provisioning/   # created by later items
docs/architecture/           # this folder: overview, ADRs, contracts
factory/                     # backlog, state, run reports
scripts/ci.sh                # quality gate (CI and local)
.github/workflows/ci.yml     # runs scripts/ci.sh on push / PR to main
```

## Quality gate

`bash scripts/ci.sh` -> in `backend/`: `npm ci`, `npm run lint` (FR-11 guard),
`npm run typecheck` (`tsc --noEmit`), `npm test` (`node --test`), plus factory JSON checks.
