# Technical Writer report — cycle 0020 — T-019: Installer hardening

## Inputs read
- Task brief, docs/user-guide.md, docs/troubleshooting.md, docs/development.md, docs/engineer-setup.md, contract installer-cli.md 1.2.1.

## Work done
- Documented CDPATH-safe script dir, missing-helper exit 3, symlink refusal exit 3 and accepted residual risk.

## Files changed
- `docs/user-guide.md` — prerequisites note (checkout needed) and exit 3 troubleshooting.
- `docs/troubleshooting.md` — both exit-3 messages with fixes.
- `docs/development.md` — fs-guard.test.ts, race-after-mkdir.ts fixture, 5 POSIX-only tests skip on Windows, confirm on Linux CI.
- `docs/engineer-setup.md` — unchanged (already says run from repository root).

## Verification
- `node backend/tools/check-docs.mjs` -> PASS (34 files).
- Test file names verified present in backend/test/installer.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Message texts copied from the brief and contract 1.2.1.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0020/07-docs.md
summary: Docs updated for T-019 installer hardening; check-docs passes
