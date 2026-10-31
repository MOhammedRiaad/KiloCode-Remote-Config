# Cycle 0011 — F-010 Bootstrap installer for macOS/Linux (install.sh)

| Phase | Agent | Status | Summary |
|---|---|---|---|
| Plan | product-owner | PASS | selected F-010 (priority raised to 2); smoke test split to F-019 |
| Design | architect | PASS | ADR-0012, installer-cli contract 1.0.0, lint rule 6 |
| Implement | senior-backend | PASS | install.sh, Node helper, pure edit lib, tests |
| Security | security-engineer | PASS | 2 low, 3 info |
| Review | code-reviewer | PASS | 2 low, 2 info |
| PR | pr-manager | DONE | local mode |
| Docs | docs-writer | DONE | README, user guide, development docs |
| Prepare | ci-releaser | PASS | v0.9.0, ci.sh green (376 pass, 4 POSIX-only skips on Windows) |

POSIX permission/symlink tests were skipped on the Windows dev host and should run on Linux CI.
Rework iterations: 0. Follow-ups: T-019.
