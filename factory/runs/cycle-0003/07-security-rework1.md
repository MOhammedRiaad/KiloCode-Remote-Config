# Security report (Re-check 1) — cycle 0003 — F-001: Plugin: JSONC parser

## Inputs read
- `git show HEAD` (057f95b, "fix(F-001): address review findings (rework 1)") and `git diff main...HEAD --stat`
- `factory/runs/cycle-0003/04-security.md` (prior verdict PASS), `05-review.md` (finding 1 + BOM nit), `06-backend-rework1.md`
- `backend/plugin/azdo-remote-config.ts` (lines 30-160)

## Work done
- Reviewed the rework diff: only the two error message strings (`azdo-remote-config.ts:131`, `:136`) and three exact-message test assertions (`jsonc.test.ts:71`, `:77`, `:144`) changed.
- No input echo: both messages still interpolate only `locate(text, i)`, which returns `line N, column N` built from integer counters. The only other throws are fixed strings (`:120` TypeError, `:150` "malformed JSON" from a bare `catch` with no `cause`). Canary tests (AC-5) still assert that the message is exact and that `cause === undefined`.
- FR-11 (no runtime deps, `node:` imports only, single file in `plugin/`): no imports were added. `check-fr11` tests pass in CI.
- Secrets scan of the rework diff: none.
- BOM check: `azdo-remote-config.ts:38` still contains the raw U+FEFF bytes (`EF BB BF`), not the `"﻿"` escape. `06-backend-rework1.md` says this was changed, but the commit does not touch line 38. This is not a security regression because the behaviour is unchanged and the "leading BOM is ignored" test passes. It is a false claim in the rework report, so it is recorded below for Code Review.

## Files changed
- `factory/runs/cycle-0003/07-security-rework1.md` — this report (no source changes)

## Verification
- `bash scripts/ci.sh` → exit 0 (30 tests, 30 pass, 0 fail; check-lf PASS; ci PASS)
- No new dependencies, so the dependency audit is unchanged from 04-security.md.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | `backend/plugin/azdo-remote-config.ts:38` | `const BOM` still holds a raw invisible U+FEFF character. `06-backend-rework1.md` claims it was replaced with an escape, but the rework commit does not change that line. No security impact (tests would catch a stripped BOM). | Replace it with `const BOM = "﻿";` and correct the rework report. This is the Code Review nit and does not block. |

Previous findings (04-security.md): the memory amplification / missing size cap is still deferred to F-005/F-006 as agreed, and nothing regressed.

## Assumptions made (no human available)
- The BOM discrepancy is treated as info because the behaviour is identical and it does not touch a security control.

## Follow-ups for the backlog
- Unchanged from 04-security.md: an input size cap and lower per-character memory use in the parser (F-005/F-006).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0003/07-security-rework1.md
summary: Rework only adds "starting" to two fixed error strings; errors still have no input echo, FR-11 holds, CI green; BOM escape claimed in the rework report but not actually applied (info)
