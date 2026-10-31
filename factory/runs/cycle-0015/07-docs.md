# Docs writer report — cycle 0015 — F-008: Shared config repo: Azure Pipelines PR gate and branch policy setup

## Inputs read
- `docs/architecture/contracts/shared-config-repo.md`, existing README, user guide, development guide
- `backend/` listing (shared-config, tools, test/shared-config) and `backend/tools/check-fr11.mjs` (rule 8)

## Work done
- README: features list entry for the shared config repo template, assemble tool, pipeline gate and policy script; removed "comes with F-008".
- User guide: new section "Setting up the shared config repo (platform engineers)" (assemble, push, pipeline, `KILO_ALLOWED_HOSTS`, `set-branch-policies.sh` flags and exit codes, duplicates until T-023, self-modifying gate caveat, what the gate checks). Updated the validator section intro.
- Development: new "Shared config repo tests and lint rule 8" section and layout entries.
- `docs/api.md` not changed: no plugin API change (CLI contracts are covered in the user guide).

## Files changed
- `README.md`, `docs/user-guide.md`, `docs/development.md`

## Verification
- Confirmed that the documented files exist: `backend/tools/assemble-shared-repo.ts`, `backend/shared-config/*`, `backend/test/shared-config/*.test.ts`; rule 8 is in `check-fr11.mjs`. Commands and flags were taken from the contract. Did not run the tools.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- The `git init` / push steps and the `definitionId=` URL hint in the guide are generic Azure DevOps usage, not contract text.
- Docs state that the Azure DevOps repo, pipeline and policies are not created by this repo.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0015/07-docs.md
summary: Updated README, user guide and development docs for F-008
