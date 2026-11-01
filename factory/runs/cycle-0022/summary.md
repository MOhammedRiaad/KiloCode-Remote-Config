# Cycle 0022 — F-020 Installer smoke test: network pre-flight (user request: Kilo/Bifrost behind an Azure IP firewall)

| Phase | Agent | Status | Summary |
|---|---|---|---|
| Plan | product-owner | PASS | factory reopened by user request; split into F-020/F-021/F-022; F-020 selected |
| Design | architect | PASS | ADR-0019, installer-cli 1.3.0 (9.0), e2e-harness 1.1.0 |
| Implement | senior-backend | PASS | smoke.ts network probes, fake-network probe answers, reworked/new tests |
| Security | security-engineer | PASS | spy run: 0 real sockets/DNS/az; 3 info |
| Review | code-reviewer | PASS | 10/11 mutations killed; 1 low + 3 info |
| PR | pr-manager | DONE | local mode |
| Docs | docs-writer | DONE | troubleshooting, user guide, engineer setup, runbook, development, README |
| Prepare | ci-releaser | PASS | v0.15.0, ci.sh green (629 pass, 10 skipped) |

Rework iterations: 0. Follow-ups: T-032. F-021 (plugin-side classification) and F-022 (reduced to plugin-side docs) remain queued.
