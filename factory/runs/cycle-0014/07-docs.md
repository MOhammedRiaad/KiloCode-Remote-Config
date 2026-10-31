# Docs report — cycle 0014 — F-011: Bootstrap installer for Windows (install.ps1)

## Inputs read
- Diff on branch, `backend/installer/install.ps1`, `docs/architecture/contracts/installer-cli.md` 1.2.0 section 10, existing README and docs.

## Work done
- README: status and features updated (Windows installer shipped; key provisioning out of scope).
- User guide: new "Installing on Windows (engineers)" section (usage, parameters, files written, ACL note, XDG warning, ExecutionPolicy / Unblock-File, troubleshooting, .cmd-shim caveat); cross-references fixed.
- Development guide: Windows installer tests (ps-helpers.ts, install-ps1*.test.ts, install-helper-frontend.test.ts; pwsh and powershell.exe, skipped with a message when absent); layout updated.
- `docs/api.md` unchanged: no HTTP API change.

## Files changed
- `README.md`, `docs/user-guide.md`, `docs/development.md`

## Verification
- Confirmed install.ps1 and the listed test files exist in the repo; commands documented match install.ps1 usage text. No new scripts or env vars beyond those in the contract.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Test-run command for the PS tests is `npm test` only (no extra filter command documented) — avoids documenting an unverified glob.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0014/07-docs.md
summary: Windows installer documented in README, user guide and development guide
