# Docs Writer report — cycle 0007 — F-005: Plugin: Azure DevOps fetch and authentication

## Inputs read
- Diff vs main, ADR-0007, `docs/architecture/contracts/plugin-interface.md` section 2e, existing README and docs.

## Work done
- Documented `__internals.fetchRemoteConfig`: auth order (option/`KILO_AZDO_PAT`, `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`, az token), timeout, 1 MiB cap, error codes, request shape, never-throws behaviour.
- Marked everything as internal and not wired into the hook (not shipped as user-visible).

## Files changed
- `README.md` — status and features list.
- `docs/user-guide.md` — new "Fetching the shared config (not active yet)" section; pat note updated.
- `docs/api.md` — new `fetchRemoteConfig` section; `__internals` list.
- `docs/development.md` — fetch tests, `node:child_process` import.

## Verification
- Checked file names (`backend/test/plugin/fetch.test.ts`), `__internals` export and the az arguments against the source and contract. No new commands or env vars beyond those documented.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Local mode (no remote), so no push.
- `api.md` closing "Authoritative contract" line still says v0.5.0; left unchanged because the version of the architect-owned contract was not verified.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0007/07-docs.md
summary: Documented fetchRemoteConfig (auth sources, timeout, 1 MiB cap, error codes) in README and docs.
