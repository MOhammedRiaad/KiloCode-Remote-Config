# Docs report — cycle 0010 — F-009: Personal config template

## Inputs read
- backend/personal-config/kilo.jsonc, docs/architecture/contracts/personal-config-template.md, existing README and docs.

## Work done
- Documented the template contents, placement (`~/.config/kilo/kilo.jsonc` only), fields to fill in, credentials via AZDO_PAT or az login (no pat option), installers F-010/F-011 as planned, and how to run its tests.
- No API endpoints changed, so docs/api.md is untouched.

## Files changed
- `README.md` — feature entry and status note.
- `docs/user-guide.md` — new "Personal config template (engineers)" section; status line.
- `docs/development.md` — test section, layout entry.

## Verification
- Test file backend/test/personal-config/template.test.ts and command `node --test "test/personal-config/*.test.ts"` confirmed to exist; npm scripts checked in package.json.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- The plugin path `./azdo/azdo-remote-config.ts` is documented as relative to the Kilo config directory; installers are said to set that up (inferred, not specified in the contract).

## Follow-ups for the backlog
- Confirm plugin install location when F-010/F-011 are designed.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0010/07-docs.md
summary: Documented personal config template in README, user guide and development docs
