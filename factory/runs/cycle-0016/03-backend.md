# Backend report - cycle 0016 - F-014 (test-only)

## Work done
- B1: `backend/test/installer/fixtures/fake-network.ts` now exports `FakeStaticAnswer`, has the `auth` variant and a shared `renderStatic`. A mismatch or missing header returns 401 `{"error":"unauthorized"}`. `fakeFetch` keeps its name. `backend/test/installer/helpers.ts` re-exports `FakeStaticAnswer`.
  Both files were CRLF in the working copy and are now LF.
- B2: `backend/test/e2e/fixtures/kilo-start-simulator.ts` (per contract section 1).
- B3: `backend/test/e2e/helpers.ts` (per contract section 4).
- B4: `backend/test/e2e/startup.test.ts` has T1-T7 plus a harness guard test (the simulator exits 2 without the preload).
- Product code is untouched. `git diff --stat main -- backend/plugin backend/validator backend/installer backend/personal-config backend/shared-config backend/tools` is empty.

## Acceptance criteria to tests
- AC-1 and AC-12: T1 (also T2 for the fresh-install start).
- AC-2: T2.
- AC-3: T3.
- AC-4: T4.
- AC-6 and AC-7: T5.
- AC-9: T7. `assertNoLeaks` also runs in every test.
- AC-10: T6, covering the match, mismatch, wrong-key and probe cases.
- AC-8: `bash scripts/ci.sh`.

## Verification
- `cd backend && npm run typecheck`: clean after the B1 fix.
- `node --test test/e2e/startup.test.ts`: 8 of 8 pass.
- `bash scripts/ci.sh`: exit 0, 556 tests, 551 pass, 0 fail, 5 skipped (not from the e2e suite). `check-lf: PASS`, `ci: PASS`.

## Findings
- No product defect found.
- `.claude/settings.json` shows as modified in `git status`. I did not touch it, so the orchestrator should check where the change came from.

## Assumptions
- None beyond the architect's.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0016/03-backend.md
summary: e2e startup harness (simulator, helpers, 8 tests) and the fake-network auth variant added, test-only; ci.sh passes
