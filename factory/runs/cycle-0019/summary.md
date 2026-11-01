# Cycle 0019 — T-013 Bind cache to the settings that produced it

| Phase | Agent | Status | Summary |
|---|---|---|---|
| Plan | product-owner | PASS | selected T-013 (priority raised to 2); split T-029 |
| Design | architect | PASS | ADR-0018, plugin contract 0.8.0 (2f-C), e2e-harness 1.0.1 |
| Implement | senior-backend | PASS | cache envelope + binding, 3 new codes, missing-settings skip, tests, e2e T3b |
| Security | security-engineer | PASS | fuzzed 22 envelope shapes, 5 credential sources: 3 info |
| Review | code-reviewer | PASS | 10/10 mutants killed; 3 info |
| PR | pr-manager | DONE | local mode |
| Docs | docs-writer | DONE | user guide, troubleshooting, api, runbook, README; docs check passes |
| Prepare | ci-releaser | PASS | v0.14.1, ci.sh green (602 pass, 5 skipped) |

Behaviour change: missing org/project/repo no longer falls back to the cache. Upgrade note: existing caches unusable once (cache-outdated).
Rework iterations: 0. Follow-ups: T-030 (and T-029 from the PO).
