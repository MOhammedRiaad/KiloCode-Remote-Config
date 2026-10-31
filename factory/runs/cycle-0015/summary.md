# Cycle 0015 — F-008 Shared config repo: Azure Pipelines PR gate and branch policy setup

| Phase | Agent | Status | Summary |
|---|---|---|---|
| Plan | product-owner | PASS | selected F-008 (priority raised to 2); F-012/F-013 still skipped |
| Design | architect | PASS | ADR-0015, shared-config-repo contract; fixed overview.md NUL bytes |
| Implement | senior-backend | PASS | shared-config template, assemble tool, policy script, lint rule 8, tests |
| Security | security-engineer | PASS | 2 low, 3 info |
| Review | code-reviewer | PASS | 2 low, 1 info |
| PR | pr-manager | DONE | local mode |
| Docs | docs-writer | DONE | README, user guide, development docs |
| Prepare | ci-releaser | PASS | v0.12.0, ci.sh green (543 pass, 5 skipped) |

The real Azure DevOps repo, pipeline and policies must still be created by an operator.
Rework iterations: 0. Follow-ups: T-024, T-025; notes on F-016 (T-023 already existed).
