# Docs report — cycle 0022 — F-020: Installer smoke test network pre-flight

## Inputs read
- Task brief, existing docs pages, `backend/tools/check-docs.mjs`.

## Work done
- Documented the `smoke network:` first line, codes, `skipped network-blocked`, hint line, exit 4, 4x timeout, and known limits.

## Files changed
- `docs/user-guide.md` — smoke test section, code table, known limits
- `docs/troubleshooting.md` — new "Network blocked" section with curl self-check; exit 4 pointers
- `docs/engineer-setup.md` — VPN/allow-list prerequisite; sample output
- `docs/platform-runbook.md` — allow-listing section
- `docs/development.md` — F-020 test notes
- `README.md` — smoke test line

## Verification
- `node backend/tools/check-docs.mjs` -> PASS (35 files)

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- development.md names `smoke.test.ts` and `install-smoke.test.ts` as covering the new behaviour, based on the brief; test files were not re-inspected.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0022/07-docs.md
summary: F-020 docs updated across six pages; docs check passes
