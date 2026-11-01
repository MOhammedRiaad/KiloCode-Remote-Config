# Cycle 0024 — T-035 Firewall hint on authenticated smoke lines; Azure Firewall HTTP 470 classified as blocked

| Phase | Agent | Status | Summary |
|---|---|---|---|
| Plan | product-owner | PASS | one more small cycle for the user's firewall scenario; T-035 split from T-034 |
| Design | architect | PASS | ADR-0019/0020 amendment A1, installer-cli 1.3.2 (9.4), plugin-interface 0.9.1 |
| Implement | senior-backend | PASS | needsNetworkHint (N1/N2/N3), 470 blocked in probe and plugin, 6 tests re-expected stricter |
| Security | security-engineer | PASS | hostile-value fuzz, 470 withholds credentials (counters), spy run clean; 3 info |
| Review | code-reviewer | PASS | 13/13 mutations killed; 2 info |
| PR | pr-manager | DONE | local mode |
| Docs | docs-writer | DONE | troubleshooting, user guide, runbook, api, development |
| Prepare | ci-releaser | PASS | v0.16.1, ci.sh green (692 pass, 10 skipped) |

Rework iterations: 0. Follow-ups: T-036 (T-034 reduced to the 203 HTML case).
