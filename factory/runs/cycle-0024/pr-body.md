## Summary
Third part of the user's Azure IP firewall requirement (F-020 pre-flight v0.15.0, F-021 plugin classification v0.16.0). An off-VPN engineer now gets the VPN / allow-list hint after every network-type failure in the installer smoke output (pre-flight or authenticated lines, rule N1|N2|N3, printed at most once and last). Azure Firewall's HTTP 470 is treated as blocked in the installer probe (credentials withheld) and in the plugin (`network-blocked` plus the NETWORK hint). Contracts: installer-cli 1.3.2, plugin-interface 0.9.1; ADR-0019/0020 amended.

## Backlog item
- **ID / title:** T-035 - Firewall hint on the authenticated smoke lines and Azure Firewall HTTP 470 classified as blocked
- **Type:** tech-debt (backend only, user-sourced, priority 2)
- **Factory cycle:** `factory/runs/cycle-0024/`

## Acceptance criteria
- [x] AC1 azdo hint - test: `smoke.test.ts` "T-035 AC-1"
- [x] AC2 bifrost hint - test: "T-035 AC-2", "T-035 AC-2: runSmoke ... 407 or 470"
- [x] AC3 once/order/edge cases - test: "T-035 AC-3: the hint is printed at most once...", "non-string codes and statuses are compared exactly"
- [x] AC4 installer 470 blocked, no credentials sent, exit 4 - test: "T-035 AC-4: an anonymous probe answered with HTTP 470", `install-smoke.test.ts` "T-035 AC-4 ... exits 4"
- [x] AC5 plugin 470 network-blocked + NETWORK hint - test: `fetch.test.ts` "T-035 AC-5"; `hook.test.ts` HINT_CASES 470 row
- [x] AC6 no leaks - test: `smoke.test.ts` "T-035 AC-6"; `hook.test.ts` AC6 470 cases
- [x] AC7 FR-11 / no regressions, CI exit 0 - existing FR-11 lint and `__internals` key-set tests

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (spy-verified; 3 info notes) | `04-security.md` |
| Code review | PASS (13/13 mutations killed; 2 info notes) | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (702 tests: 692 pass, 0 fail, 10 platform skips) | |

## Risk & rollback
- 470 is community-reported Azure Firewall behaviour, not Microsoft-documented (unofficial sources). False-positive risk is negligible; workaround is `--no-smoke`.
- Known gap: Azure DevOps org IP conditional-access (JSON 401/403) still shows the credentials hint, which mentions the VPN.
- Existing tests were only made stricter (6 re-expected), none deleted or loosened.
- Rollback: squash merge, so a single revert commit.

## How to verify
```
bash scripts/ci.sh
```
