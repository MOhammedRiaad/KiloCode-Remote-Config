# Docs report — cycle 0011 — F-010: Bootstrap installer for macOS/Linux (install.sh)

## Inputs read
- docs/architecture/contracts/installer-cli.md, ADR-0012, diff stat, existing README and docs.

## Work done
- Documented install.sh usage, prerequisites, flags/env, key handling, files written, backups, exit codes.
- Replaced "installers not built yet" text; noted F-011 and F-019 still to come.
- Documented installer tests (POSIX-only tests skip on Windows) and lint rule 6.

## Files changed
- `README.md` — status, features list, template section.
- `docs/user-guide.md` — new "Installing on macOS and Linux" section; status and template text.
- `docs/development.md` — installer tests, lint rule 6, layout.

## Verification
- Confirmed `backend/installer/install.sh` exists, test glob `test/installer/*.test.ts`, lint covers `installer` dir, skip logic in tests.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- docs/api.md unchanged: the installer is a CLI, documented in the user guide and the architecture contract.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0011/07-docs.md
summary: Docs for install.sh added to README, user guide, development guide
