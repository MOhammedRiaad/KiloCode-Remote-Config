# Code Review report - cycle 0016 - F-014: End-to-end simulated startup test

## Inputs read
- `factory/backlog.json` (F-014, AC-1..AC-8), `01-product-owner.md`, `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/contracts/e2e-harness.md`, ADR-0016
- `git diff main...HEAD`: `backend/test/e2e/{startup.test.ts,helpers.ts,fixtures/kilo-start-simulator.ts}`, `backend/test/installer/{fixtures/fake-network.ts,helpers.ts}`

## Work done
- Ran the full quality gate.
- Mapped each AC to the code and the asserting test (table below).
- Checked contract sections 1-4 against the simulator, helpers and fake-network.
- Ran mutation testing on a scratch `git archive` copy of `backend/`. The repo was not modified.
- Checked the skip path with bash missing and checked the Windows env fallback.

### AC -> test mapping
| AC | Test | What is asserted |
|---|---|---|
| AC-1 | T1 | `baseURL` equals the shared value. Model keys deep-equal `["azure/gpt-5","azure/gpt-5-mini"]`. `apiKey === KEY`. `requests.length === 1`, which counts all hosts. The exact URL comes from `expectedItemsUrl` (org/project/repo, `/kilo.jsonc`, `main`, `api-version=7.1`). The Basic header is correct. Log records are exact. The installed plugin is byte-equal to the source. `--no-smoke` is supplied by `runInstall`. |
| AC-2 | T2 | The new model and `small_model` are applied. The rest of the config deep-equals the first start (checked by reverse-applying the delta). `snapshot(configDir)` before and after is equal (personal config and plugin, bytes and modes). The cache deep-equals `expectedCache(v2)`. |
| AC-12 | T1 | Exactly 1 entry, resolved to `<configDir>/azdo/azdo-remote-config.ts`. `serverCalls === 1` and `hookCalls === 1`. No `plugin/` or `plugins/` directory. |
| AC-3 | T3 | Both the throw case and the HTTP 500 case: config deep-equals the first start, the warn and info records are exact, the cache bytes are unchanged, and the exit code is 0 (checked in `start()`). |
| AC-4 | T4 | Config deep-equals `initialConfig` and the parsed installed config. There is exactly one error record. No cache is written. Exit 0. |
| AC-5 (vision AC-6/7) | T5 | defaults gives `local-model`. After re-running install with `--mode enforce`, the result is `azure/gpt-5`. `apiKey === KEY` in both runs while the shared file carries a decoy `apiKey`. The decoy is absent from the config and the cache. |
| AC-6 (vision AC-10) | T6 | Matching key: `smoke bifrost: pass`, exit 0. Mismatched key, in two forms: `fail 401`, exit 4, and the snapshot is byte-identical (to the pre-run state, and to a no-smoke install with the same key). The unauthenticated probe to `/v1/models` gets `401`. |
| AC-7 (vision AC-9) | T7 + every test | `assertNoLeaks` checks the key, key tail, other key, PAT, Basic credential and error canaries over installer and simulator stdout/stderr, logger records and the cache. Record shape is limited to `{body:{service,level,message}}`. |
| AC-8 | CI | `bash scripts/ci.sh` exit 0. The e2e suite runs (8/8, not skipped). FR-11 lint passes. There are no product changes and no runtime deps. |

## Files changed
- `factory/runs/cycle-0016/05-review.md` (this report only)

## Verification
- `bash scripts/ci.sh`: **exit 0**. 556 tests, 551 pass, 0 fail, 5 skipped. The 5 skips are pre-existing; none are e2e. `check-lf: PASS`, `ci: PASS`.
- `git diff main...HEAD -- backend/plugin backend/validator backend/installer backend/personal-config backend/shared-config backend/tools backend/package.json frontend`: empty. No product code changed.
- The fake-network change is additive. The old static branch was moved verbatim into `renderStatic`. `hang` and `throw` are unchanged. `fakeFetch` keeps its name. `FakeAnswer` and `FakeScenario` are still exported, and `FakeStaticAnswer` is now re-exported. The pre-existing installer suites still pass.
- Mutation testing on the scratch copy, e2e suite only. Every mutation was killed:
  - M1 enforce never wins (`mode === "enforce"` changed to `false`): T5 fails.
  - M2 fake `auth` always matches: T6 fails.
  - M3 `sanitizeShared` returns its input unchanged: T1, T2 and T5 fail.
  - M4 cache file never renamed into place: T1, T2, T3, T5 and T7 fail.
- Skip path: with bash missing (`env -i PATH=<node dir>`), all 8 tests report `# SKIP bash not found on PATH (set KILO_TEST_BASH): end-to-end startup suite skipped`, with 0 fail.
- Windows fallback check: running T4 with `SYSTEMROOT` and `ComSpec` absent from the parent env still passes. The escaping typo below therefore has no observable effect today.
- Flakiness: no ports are used. Each child process has a 30 s `spawnSync` timeout. Top-level `node:test` tests run sequentially. Every test runs in its own `mkdtemp` sandbox. Each start gets its own scenario file and net log. The env is built from scratch. az is stubbed to fail, and `azLogExists` is asserted false. Deny-all network.

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | low | backend | `backend/test/e2e/helpers.ts:69-70` | The fallbacks `"C:\Windows"` and `"C:\Windows\System32\cmd.exe"` evaluate to `C:Windows` and `C:WindowsSystem32cmd.exe`. This differs from contract section 4 and from `installer/helpers.ts:198-199`, which escapes them correctly. They are only used when the parent has no `SYSTEMROOT`/`ComSpec`. I ran that case and the suite still passes, so nothing is broken today. Same issue as security #1. | Follow-up: escape as `"C:\\Windows"` and `"C:\\Windows\\System32\\cmd.exe"`. Not blocking. |
| 2 | info | orchestrator | `.claude/settings.json` | The change is **committed** on the branch (commit `3c9ea7b` "remove attribution"), so it is part of `main...HEAD` and will ship in the F-014 PR unless removed. The brief called it uncommitted. The engineers did not make it. Per instructions it is out of scope for this review. | Orchestrator or PR manager: decide whether this commit belongs in the F-014 PR. No engineer action. |

No correctness bugs, contract mismatches, missing AC coverage or weakened tests were found.

## Assumptions made (no human available)
- Finding #1 is not treated as a blocking contract mismatch. It is a test-harness env fallback that never triggers in practice, and I ran the trigger case with the suite still passing. The blocking "contract mismatch" rule targets producer/consumer interface disagreement.

## Follow-ups for the backlog
- Fix the escaping in `backend/test/e2e/helpers.ts:69-70` (finding #1).
- Nit: the harness guard test does not need bash, but it is skipped together with the suite. It could use `skip: false`.
- Nit: `probeFetch` shares the `start-N` counter and so advances start numbering. This is harmless. A separate counter, or a comment explaining the sharing, would make it clearer.
- Nit: only T1 asserts `serverCalls === 1`. `start()` could assert it for every start ("exactly once per simulated start").

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0016/05-review.md
summary: F-014 PASS: ci.sh exit 0, e2e suite 8/8 runs; AC-1..AC-8 each covered by exact assertions; 4/4 mutations killed; skip path verified; no product changes; fake-network change additive; 1 low follow-up (Windows fallback escaping)
