# Code Review report — cycle 0008 — F-006: Plugin: cache, fallback, logging and never-crash wiring (Re-review 1)

## Inputs read
- `factory/runs/cycle-0008/05-review.md` (first review, FAIL on finding 1)
- `factory/runs/cycle-0008/03-backend-rework1.md`, `04-security-rerun1.md` (PASS)
- `git show f32588d` (rework commit), `git diff cf501d4 HEAD --stat`, `git diff main...HEAD --stat -- backend`
- `backend/plugin/azdo-remote-config.ts` (env and homedir reads: lines 246-247, 576-583, 603, 826, 1036-1049, 1266-1285)
- `backend/test/plugin/hook.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`

## Work done
- Checked the scope of the rework. Commit `f32588d` touches only `backend/test/plugin/hook.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts` and the engineer's report. `backend/plugin/azdo-remote-config.ts` has not changed since `cf501d4`, so the product code has no changes and the first review's contract and AC mapping still holds.
- Finding 1, the hostile-deps test (`hook.test.ts:542-567`): it now runs `runConfigHook` with the deps `[null, 'x', 5, [], undefined]` in a child process. The child gets `HOME` and `USERPROFILE` set to a fresh `mkdtemp` dir. All `KILO_AZDO_*`, `AZDO_PAT` and `AZURE_DEVOPS_EXT_PAT` are removed from its env. The test asserts that all 5 `cfg` values are `{}` and that no `.cache` was created in the temp home, and it removes the temp home in `finally`. The plugin reads env only through `deps.env ?? process.env` (`KILO_AZDO_*` and the two PAT vars) and `ComSpec` (only on the az path). It reads the home dir only through `os.homedir`, which honours `HOME`/`USERPROFILE`. The cleaned env therefore covers every input the plugin reads.
- Tried to break hermeticity (see Verification). The fixed test survives the scenarios from the first review.
- Checked that the test is not vacuous. With the same call made against a fake home that holds a cache, `cfg` becomes `{"model":"from-real-home"}`. If the child ever saw the parent home, the `[{},{},{},{},{}]` assertion would fail.
- Info items from the first review: item 3 is fixed (the failing-collaborators loop now asserts `cfg` deep-equals `localConfig()`). Item 4 is fixed (the deep-nesting case is pinned to `invalid-shape`, and it passes). Item 5 is fixed (the smoke child records `logsAfterServer` and asserts it is 0, which covers "server MUST NOT log"). None of these weakens an existing assertion.
- Lanes: only `backend/` and the engineer's own report.

## Files changed
- `factory/runs/cycle-0008/05-review-rerun1.md`: this report.

## Verification
- `bash scripts/ci.sh`: exit 0, `ci: PASS`. 267 tests: 266 pass, 0 fail, 1 skipped (POSIX mode check on win32). Lint, typecheck and check-lf passed.
- Hostile reproduction 1 (the first review's scenarios A and B together): fake home with `.cache/kilo-azdo/remote-config.json = {"model":"from-real-home"}`. Ran `HOME=<fake> USERPROFILE=<fake> KILO_AZDO_ORG=o KILO_AZDO_PROJECT=p KILO_AZDO_REPO=r KILO_AZDO_PAT=... AZDO_PAT=... node --test --test-name-pattern="hostile deps" test/plugin/hook.test.ts`. Result: PASS. The fake cache file was unchanged afterwards and no other file was written.
- Non-vacuity check: the same `runConfigHook({}, {org:"o"}, cfg, null)` call, run directly with `HOME`/`USERPROFILE` set to the fake home, gave `{"model":"from-real-home"}`.
- The fake home was removed and `git status` is clean.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | resolved | backend/test/plugin/hook.test.ts:542-567 | First-review finding 1 (test not hermetic) is fixed and verified, as described above. | None. |
| 2 | info | backend/test/plugin/hook.test.ts:547 | Windows-only gap. The env filter is case-sensitive (`key.startsWith("KILO_AZDO_")`), but Windows env lookups are not. I confirmed that a var exported as `kilo_azdo_project` keeps its lowercase key in `process.env` and is still returned for `process.env.KILO_AZDO_PROJECT`. If a Windows shell had lowercase `kilo_azdo_project` and `kilo_azdo_repo`, the child would resolve every setting and could try a real fetch or `az` call. Writes still go only to the temp home, so the real home stays safe. Mixed-case vars like these are very unusual, so this does not gate. | Backend, backlog: compare keys case-insensitively (`key.toUpperCase().startsWith("KILO_AZDO_")`, same for the PAT names). |
| 3 | info | backend/test/plugin/hook.test.ts:19; backend/test/plugin/azdo-remote-config.smoke.test.ts:55 | Formatting nits: `const OPTIONS ={` (missing space) and a mis-indented `const logsAfterServer` line in the script array. | Backend, backlog: tidy up. |

## Assumptions made (no human available)
- Finding 2 is not gating. It needs env var names in non-standard case on Windows, the real home is still protected, and the test result would only change if a real network fetch succeeded. The first review's finding was gating because its scenario was common (any developer who had used the plugin).

## Follow-ups for the backlog
- Findings 2 and 3 above.
- Still open from the first review: finding 2 (cache-read TOCTOU), plus the security follow-ups in `04-security.md`.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0008/05-review-rerun1.md
summary: Re-review 1 PASS: hostile-deps test now hermetic (child process, temp home, cleaned env; verified against a fake home with a cache and KILO_AZDO_* set); no product code changed; info items 3-5 fixed; ci PASS (266/0/1)
