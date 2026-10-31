## Summary
Adds a test-only end-to-end suite (`backend/test/e2e/`) that simulates the Kilo startup sequence (steps 1-7): it runs the real `install.sh` in a temp HOME, then a test-only "Kilo start simulator" loads the INSTALLED personal config and plugin and runs the config hook, with the network faked by the F-019 preload (extended additively with an `auth` answer). No product code changed; no runtime deps added.

## Backlog item
- **ID / title:** F-014 - End-to-end simulated startup test
- **Type:** feature (test-only, backend)
- **Factory cycle:** `factory/runs/cycle-0016/`

## Acceptance criteria
- [x] AC1 fresh install + start applies shared config, one AzDO request - test: `T1 AC-1/AC-12`
- [x] AC2 one plugin entry, server called once, no plugin/plugins dir - test: `T1 AC-1/AC-12`
- [x] AC3 shared change picked up with no installer re-run - test: `T2 AC-2`
- [x] AC4 AzDO failure falls back to cache (throw and HTTP 500) - test: `T3 AC-3`
- [x] AC5 no cache + AzDO failure keeps local config, exit 0 - test: `T4 AC-4/FR-10`
- [x] AC6 defaults vs enforce, key never replaced - test: `T5 AC-6/AC-7`
- [x] AC7 smoke test vs auth-enforcing fake Bifrost (pass / fail 401 exit 4) - test: `T6 AC-10`
- [x] AC8 no key/PAT/credential in any output, log or cache - test: `T7 AC-9` (and every test)
- [x] CI gate, FR-11, no product changes - `bash scripts/ci.sh` exit 0; also `harness: the simulator refuses to run without the fake-network preload`

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS | `04-security.md` |
| Code review | PASS | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (556 tests, 551 pass, 0 fail, 5 pre-existing skips; e2e 8/8) | `05-review.md` |

Spy run confirmed the tests make no real fetch or `az` calls. Mutation testing killed 4/4 mutations.

## Risk & rollback
- Low: test-only plus an additive change to `backend/test/installer/fixtures/fake-network.ts`; existing behaviour preserved.
- Suite skips with a clear message when bash is unavailable.
- Rollback: squash merge, single revert.
- Not covered here: the real AC-1 check against real Kilo / VS Code / AzDO / Bifrost remains a manual Phase 0 step, to be documented in F-016.

## OUT-OF-SCOPE CHANGE - maintainer attention
This branch also contains commit `3c9ea7b` "remove attribution", which adds an empty `attribution` block (`commit` and `pr` = "") to `.claude/settings.json`. It was not made by the factory engineers and is unrelated to F-014. It matches the user's instruction to stop adding attribution lines to commits and PRs. Keep it, or drop it into its own change, at the maintainer's discretion.

## How to verify
```
bash scripts/ci.sh
node --test backend/test/e2e/
```
