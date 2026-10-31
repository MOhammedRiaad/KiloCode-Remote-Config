## Summary
After a successful install, `install.sh` now runs a smoke test with two checks: `azdo` (fetch and parse the shared config using the plugin's own `fetchRemoteConfig` and `parseJsonc`) and `bifrost` (GET `<baseURL>/models` with the virtual key, https only). Output is one line per check. Exit code 4 means installed but a check failed; the installation is never modified or undone. `--no-smoke` skips the test. The implementation was delegated to an external model (Gemini via Antigravity CLI) at the user's request, then reviewed and landed by the orchestrator.

## Backlog item
- **ID / title:** F-019 / Bootstrap installer smoke test (install.sh)
- **Type:** feature
- **Factory cycle:** `factory/runs/cycle-0013/`

## Acceptance criteria
- [x] AC-1 happy path, exit 0, both pass, exact AzDO URL, one Bifrost request with Bearer key — `install-smoke.test.ts` (success case), `smoke.test.ts`
- [x] AC-2 failed check gives exit 4, installation unchanged — `install-smoke.test.ts` (fail 401, http-404 + skipped azdo-failed, snapshot identical)
- [x] AC-3 timeout, invalid-jsonc, missing/insecure/invalid baseURL, no non-AzDO request — `install-smoke.test.ts`, `smoke.test.ts`
- [x] AC-4 placeholder key gives `skipped` and no request — `install-smoke.test.ts`
- [x] AC-5 PAT/az-token rules reuse the plugin's logic — `install-smoke.test.ts` (az stub), `smoke.test.ts`
- [x] AC-6 no secret or body leakage (fixed codes only) — `install-smoke.test.ts` (8 paths), `smoke.test.ts` assertNoLeak
- [x] AC-7 `--no-smoke` makes no request; exit 1/2/3 never smoke — `install-smoke.test.ts`
- [x] AC-8 FR-11 lint rule 7 and contract 1.1.0 — `check-fr11.test.ts`

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | FAIL on first pass (1 medium: a test could spawn the real `az`), PASS after rework 1 (spy-verified) | `04-security.md`, `04-security-rerun1.md` |
| Code review | PASS (2 low + 2 info follow-ups) | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (405 tests, 401 pass, 0 fail, 4 skipped POSIX-only) | |

## Risk & rollback
The plugin file, validator, and personal config template are unchanged. Residual accepted risk: the key is sent to the shared config's https baseURL host. Existing installer tests use `--no-smoke`. Rollback is a single revert commit of the squash merge.

## How to verify
`bash scripts/ci.sh`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
