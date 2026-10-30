# Docs report — cycle 0005 — F-003: Plugin: in-place merge with defaults/enforce modes

## Inputs read
- backend/plugin/azdo-remote-config.ts (merge section), backend/test/plugin/merge.test.ts
- docs/architecture/contracts/plugin-interface.md section 2c, ADR-0005

## Work done
- Documented internal `__internals.mergeConfig` (modes, apiKey rules, ignored keys, arrays, in-place, depth cap, security note).
- Kept status accurate: helper exists, not wired into the config hook.

## Files changed
- `README.md` — status and features list
- `docs/user-guide.md` — status, new "How the shared config will be merged (not active yet)" section
- `docs/api.md` — new `mergeConfig` section with example
- `docs/development.md` — merge test file mention

## Verification
- Behaviour statements checked against code (lines ~282-373) and contract 2c; example traced by hand. No new commands introduced.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Docs describe wiring as future behaviour only.

## Follow-ups for the backlog
- Update docs when F-006 wires the helper into the hook.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0005/07-docs.md
summary: Documented mergeConfig in README, user guide, API, development docs
