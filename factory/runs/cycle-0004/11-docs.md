# Docs report — cycle 0004 — F-002: Plugin: {env:} and {file:} placeholder resolution

## Inputs read
- ADR-0004, `backend/plugin/azdo-remote-config.ts` (lines 170-281), existing README and docs pages.

## Work done
- Documented `__internals.resolvePlaceholders`: syntax, `~/` expansion, absolute-only paths, UNC rejection, 1 MiB regular-file limit, trimming, drop vs. empty-string rules, names-only `unresolved`, depth error, security note.
- Kept status accurate: helper exists, not wired into the config hook.

## Files changed
- `README.md` — status and features list.
- `docs/user-guide.md` — placeholder rules section (marked not active yet).
- `docs/api.md` — `resolvePlaceholders` reference with example; `__internals` shape.
- `docs/development.md` — placeholder test file, new `node:` imports.

## Verification
- Every documented behaviour was checked against the code in `azdo-remote-config.ts`. Test file `backend/test/plugin/placeholders.test.ts` exists. Tests were not re-run.
- The api.md example output was derived by reading the code, not by running it.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- The `{file:}` example uses a fake reader, so it does not depend on the filesystem.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0004/11-docs.md
summary: Documented resolvePlaceholders (internal, not wired) in README, user guide, API and development docs
