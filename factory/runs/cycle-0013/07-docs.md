# Technical Writer report — cycle 0013 — F-019: Bootstrap installer smoke test (install.sh)

## Inputs read
- Diff vs main, `docs/architecture/contracts/installer-cli.md` section 9, ADR-0013, `pr-body.md`, `install.sh`, `smoke.ts`, `fake-network.ts`, `check-fr11.mjs`.

## Work done
- README: status and installer feature line (smoke test, exit 4, `--no-smoke`); F-019 removed from "not built yet".
- User guide: `--no-smoke` flag, exit code 4, new "Smoke test" section with output lines and troubleshooting by code.
- Development guide: new test files, fake-network preload, lint rule 7.

## Files changed
- `README.md`, `docs/user-guide.md`, `docs/development.md`

## Verification
- Flag, hint text, codes and file names checked against `install.sh`, `smoke.ts`, contract section 9 and the test folder. No new commands introduced.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- `docs/api.md` not touched: the installer is a CLI, not an HTTP API.
- Documented `KILO_AZDO_TIMEOUT_MS` as the per-check timeout, per contract section 9.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0013/07-docs.md
summary: README, user guide and development guide updated for the F-019 smoke test
