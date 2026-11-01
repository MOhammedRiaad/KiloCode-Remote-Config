# Technical Writer report — cycle 0024 — T-035: Firewall hint on the authenticated smoke lines and Azure Firewall HTTP 470 classified as blocked

## Inputs read
- Task brief, existing docs pages, `factory/templates/report.md`.

## Work done
- Documented the three hint rules (N1, N2, N3) and the no-hint codes.
- Documented HTTP 470 as blocked (installer probe and plugin), marked community-reported and unofficial, with the `--no-smoke` / `-NoSmoke` workaround.
- Fixed the wrong development.md sentence about "exits 4 with no network hint".
- Removed 470 from the "not classified" limits.

## Files changed
- `docs/troubleshooting.md` — 470 in network-blocked rows, limits line, hint rules, curl self-check.
- `docs/user-guide.md` — smoke hint rules, code-table rows, plugin `network-blocked` includes 470.
- `docs/platform-runbook.md` — 470 row, known limits, hint rules.
- `docs/api.md` — plugin-interface 0.9.1, 470 classified.
- `docs/development.md` — T-035 tests paragraph, corrected sentence.

## Verification
- `node backend/tools/check-docs.mjs` run before commit (see result in final reply).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Test file names for T-035 in development.md follow existing test files (`smoke.test.ts`, `install-smoke.test.ts`, `fetch.test.ts`) — no new file names were given.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0024/07-docs.md
summary: Docs updated for T-035 hint rules and HTTP 470 classification
