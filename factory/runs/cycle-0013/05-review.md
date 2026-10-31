# Code Review report — cycle 0013 — F-019: Bootstrap installer smoke test (install.sh)

## Inputs read
- `git diff main...HEAD` (6 commits, 22 files); working tree clean
- `factory/backlog.json` (F-019, AC-1..AC-8), `factory/runs/cycle-0013/01-product-owner.md`, `02-architect.md`
- `docs/architecture/ADR-0013-installer-smoke-test.md`, `docs/architecture/contracts/installer-cli.md` 1.1.0 (sections 1-4, 7, 9)
- `03-backend.md`, `03-backend-rework1.md`, `04-security.md`, `04-security-rerun1.md`
- Product: `backend/installer/smoke.ts`, `install-helper.ts`, `install.sh`, `backend/tools/check-fr11.mjs`
- Tests: `backend/test/installer/smoke.test.ts`, `install-smoke.test.ts`, `helpers.ts`, `fixtures/fake-network.ts`, `backend/test/tools/check-fr11.test.ts`

## Work done
- Ran the full quality gate myself.
- Mapped each acceptance criterion to its code and to a test that would fail if the code broke (table below).
- Checked contract conformance:
  - The exported names and signatures of `smoke.ts` match 02-architect BE-2 exactly: `SMOKE_ENV_NAMES`, `SmokeOutcome`, `SmokeReport`, `SmokeDeps`, `pickSmokeEnv`, `modelsUrl`, `classifyKey`, `runSmoke`, `formatSmoke`, `smokeFailed`.
  - Bifrost rows 1-9 are evaluated in contract order: azdo-failed, then the baseURL checks (no / invalid / insecure), then the key checks (no-key / key-reference / invalid-key), then the request.
  - Request shape: headers are exactly `Accept` and `Authorization: Bearer`, with `redirect: "manual"`, one AbortController, one timer cleared in `finally`, a 1 MiB cap on both `content-length` and the streamed total, and a bare status for non-2xx.
  - Output lines, the `Done.` line on exit 0 and 4, and the exit-4 stderr line match the contract.
  - Helper record `smoke=`: optional, at most once, `on`|`off`, absent means off, anything else exits 3.
  - `install.sh`: `--no-smoke` takes no value, `--no-smoke=x` is an unknown option, and `"smoke=$smoke"` is appended to the NUL record list. Usage text is updated.
  - Lint rule 7 scans the raw text of files directly in `installer/`.
- Checked the helper smoke phase:
  - It runs only after `applyPlan`, so exit 1/2/3 paths never reach it.
  - A throw is guarded and mapped to exit 4. It never falls through to the exit-3 top-level catch.
  - `effectiveApiKey` is set on both the fresh path and the update path.
- Looked for external-model artefacts (dead code, over-engineering, anything outside the design). Findings: very defensive `readOwn`/`attempt` wrappers around deps and responses, and an extra `MAX_EMPTY_CHUNKS` guard that is not in the design. Neither is wrong; both are noted as low-priority follow-ups.
- Lane and scope check:
  - The engineer commits (fffd926, cfa63c7) touch only `backend/` plus their own run reports and `state.json`.
  - `git diff main...HEAD --stat` for `backend/plugin`, `backend/personal-config`, `backend/validator`, `backend/package.json`, `frontend`, `scripts` and `.github` is empty.
  - No `KILO_TEST_` or `NODE_OPTIONS` text appears in `backend/installer/`.

### Acceptance coverage
| AC | Code | Test that fails if broken |
|----|------|---------------------------|
| AC-1 | smoke.ts checkAzdo/checkBifrost, helper run() | install-smoke.test.ts:58-89 (exit 0, both pass, exact Items URL incl. api-version=7.1, path/branch, exactly 1 Bifrost req to `.../v1/models`, `Bearer <key>`, preload loaded marker); smoke.test.ts:184-224 |
| AC-2 | smoke.ts:348-351, 314-316; helper exit 4 | install-smoke.test.ts:91-136 (`fail 401`, `fail http-404` + `skipped azdo-failed`, only AzDO request, exit 4, snapshot byte-identical to success run) |
| AC-3 | modelsUrl, startDeadline, checkAzdo invalid-jsonc | install-smoke.test.ts:138-194 (timeout both checks < 10 s, invalid-jsonc / no-base-url / insecure / invalid, no non-AzDO request, exit 4); smoke.test.ts:90-127, 286-358 |
| AC-4 | classifyKey, Plan.effectiveApiKey, formatSmoke hint | install-smoke.test.ts:196-221 (skipped no-key + hint, exit 0, no Bifrost req; `Bearer sk-bf-existing`) |
| AC-5 | FORWARDED_DEP_KEYS -> fetchRemoteConfig; Bifrost header only key | install-smoke.test.ts:223-238 (az.cmd stub runs on Windows); smoke.test.ts:226-250 |
| AC-6 | fixed codes only, no error/body text | install-smoke.test.ts:240-294 (8 paths: success, az, 401, 404, hang, throw x2, HTML body; key, PAT, Basic, token, canaries, stack); smoke.test.ts assertNoLeak |
| AC-7 | install.sh `--no-smoke`; helper `records["smoke"] === "on"` | install-smoke.test.ts:296-363 (no request, no get-access-token, no smoke line; exit 1/2/3 never smoke), 365-409 (record absent = off, invalid/dup = exit 3) |
| AC-8 | check-fr11 rule 7; contract 1.1.0 | check-fr11.test.ts:152-162 + "real tree passes"; CI run below; protected files unchanged |

## Files changed
- `factory/runs/cycle-0013/05-review.md` — this report (no source changes).

## Verification
- `bash scripts/ci.sh` exited 0.
  - lint `check-fr11: PASS`, typecheck OK.
  - 405 tests: 401 pass, 0 fail, 4 skipped. The skips are the pre-existing POSIX permission/symlink tests on Windows.
  - `check-lf: PASS`, `ci: PASS`.
  - All 9 install-smoke tests and 14 smoke unit tests ran and passed.
- `git diff main...HEAD --stat -- backend/plugin backend/personal-config backend/validator backend/package.json frontend scripts .github` was empty.
- `grep -rn "KILO_TEST_\|NODE_OPTIONS" backend/installer` returned no matches.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low (follow-up) | backend/test/installer/install-smoke.test.ts:282-293 | The AC-6 loop asserts only that nothing leaked. It does not assert the exit status or the loaded marker per scenario. If a scenario took an unexpected path, it would still pass. The no-leak property is still verified. | Backlog: add `assertLoaded(sb)` and the expected exit code / smoke line per scenario. Owner: backend. |
| 2 | low (follow-up) | backend/installer/smoke.ts:34, 269-272 | `MAX_EMPTY_CHUNKS` is not in the design. It is redundant with the deadline, which already bounds a stream of empty chunks. It is harmless but adds an untested branch. | Backlog: remove it, or add a test. Owner: backend. |
| 3 | info (follow-up) | backend/installer/install.sh:57-60 | Contract section 1 promises `--org --no-smoke` takes `--no-smoke` as the value, and that `--no-smoke` is repeatable. No child test covers either. The behaviour is correct by inspection. | Backlog: add two child-process cases. Owner: backend. |
| 4 | info (carried from security) | backend/tools/check-fr11.mjs:50-64 | Rules 5-7 scan only top-level `installer/` files. | Backlog (already raised by security). Owner: backend. |

No blocking findings.

## Assumptions made (no human available)
- I accept the defensive `readOwn`/`attempt` style in `smoke.ts` as consistent with the plugin's hardened style (ADR-0009), not as over-engineering worth blocking.
- Security has already accepted the residual risk that the key goes to the shared https baseURL host. It is out of review scope.

## Follow-ups for the backlog
- Findings 1-3 above (test tightening, remove `MAX_EMPTY_CHUNKS`).
- Recurse FR-11 rules 5-7 into subdirectories (security follow-up).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0013/05-review.md
summary: F-019 review PASS: ci.sh green (405 tests, 0 fail); AC-1..AC-8 each implemented and covered by failing-capable tests; contract 1.1.0 conformant; protected files unchanged; 2 low + 2 info follow-ups only.
