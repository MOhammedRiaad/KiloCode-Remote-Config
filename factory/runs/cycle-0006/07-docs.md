# Docs Writer report — cycle 0006 — F-004: Plugin: settings resolution (options, env, defaults)

## Inputs read
- `backend/plugin/azdo-remote-config.ts` (resolveSettings and helpers), `backend/test/plugin/settings.test.ts` (exists)
- `docs/architecture/contracts/plugin-interface.md` v0.5.0 section 2d, ADR-0006
- Existing README.md and docs/*.md

## Work done
- Documented `__internals.resolveSettings` as internal and not yet wired into the config hook.
- Documented the 8 settings, KILO_AZDO_* env names, precedence, defaults, required org/project/repo in `missing`, trimming, per-setting rules, W0-W4 warning texts, fall-through, KILO_AZDO_PAT as sole PAT source (F-005 adds others), hidden `pat`, never throws.

## Files changed
- `README.md` — status, feature list
- `docs/user-guide.md` — status and "Plugin settings (not active yet)" section
- `docs/api.md` — `resolveSettings` section, `__internals` key list, contract version
- `docs/development.md` — settings test note

## Verification
- Claims checked against the code; example traced by hand. `npm test` in backend: 129 pass, 0 fail, 1 skipped.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Local mode: no push.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0006/07-docs.md
summary: Documented internal resolveSettings (F-004) in README, user guide, API and development docs.
