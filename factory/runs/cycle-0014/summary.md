# Cycle 0014 — F-011 Bootstrap installer for Windows (install.ps1)

| Phase | Agent | Status | Summary |
|---|---|---|---|
| Plan | product-owner | PASS | selected F-011 (priority raised to 2) |
| Design | architect | PASS | ADR-0014, installer-cli contract 1.2.0 |
| Implement | senior-backend | PASS | install.ps1, helper `frontend` record, 72+ tests on pwsh 7 and PS 5.1 |
| Security | security-engineer | PASS | 1 low, 3 info |
| Review | code-reviewer | PASS | 2 low (architect docs), 1 low + 3 info (backend) |
| PR | pr-manager | DONE | local mode |
| Docs | docs-writer | DONE | README, user guide, development docs |
| Prepare | ci-releaser | PASS | v0.11.0, ci.sh green (480 pass, 4 skipped) |

Orchestrator note: added `*.ps1 text eol=lf` to .gitattributes (root file, B3).
Rework iterations: 0. Follow-ups: T-021, T-022; note added to F-016.
