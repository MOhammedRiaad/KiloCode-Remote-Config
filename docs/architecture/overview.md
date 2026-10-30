# Architecture overview - Kilo Shared Config

Last updated: cycle-0002 (T-001). Stack: ADR-0001. Plugin module shape: ADR-0002.
Contract: `contracts/plugin-interface.md`.

## Components

| ID | Component | Source in this repo | Deployed to | Status |
|---|---|---|---|---|
| C1 | Shared config repo validation (PR gate) | `backend/validator/` | Azure DevOps `kilo-config` pipeline | planned |
| C2 | Remote config plugin (single file, FR-11) | `backend/plugin/azdo-remote-config.ts` | `~/.config/kilo/azdo/azdo-remote-config.ts` | **stub (T-001)** |
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
           -> parse JSONC -> resolve {env:}/{file:} -> write cache
              (on failure: read cache; no cache: local only)
           -> merge into resolvedConfig in place (defaults | enforce)
           -> log via client.app.log (service azdo-remote-config, no secrets)
  -> Kilo runs; model calls go to Bifrost (C4) with the engineer's own key
```

Every step of C2 is wrapped so no failure can stop Kilo (FR-10).

## Internal structure of C2 (single file, sections in this order)

1. Types (structural Kilo types, contract section 1)
2. Constants (`PLUGIN_ID`, `SUPPORTED_KILO_RANGE`, defaults)
3. Pure helpers: settings, JSONC parser, placeholder resolver, merge
4. I/O helpers with injectable seams: fetch, `az` runner, cache fs, clock
5. `AzdoRemoteConfig` server function and `config` hook
6. Exports: `__internals`, constants, `default { id, server }`

## Directory layout

```
backend/                     # the only package (ADR-0001 section 7)
  plugin/azdo-remote-config.ts
  tools/check-fr11.mjs
  test/plugin/*.test.ts
  validator/ templates/ installer/ provisioning/   # created by later items
docs/architecture/           # this folder: overview, ADRs, contracts
factory/                     # backlog, state, run reports
scripts/ci.sh                # quality gate (CI and local)
.github/workflows/ci.yml     # runs scripts/ci.sh on push / PR to main
```

## Quality gate

`bash scripts/ci.sh` -> in `backend/`: `npm ci`, `npm run lint` (FR-11 guard),
`npm run typecheck` (`tsc --noEmit`), `npm test` (`node --test`), plus factory JSON checks.
