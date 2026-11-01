# Backend report - cycle 0024 - T-035

## Work done
- B1: `backend/installer/smoke.ts` `classifyProbeStatus`: 470 is `blocked` (docstring updated).
- B2: `hasNetworkCondition` replaced by private `needsNetworkHint(report)` (N1 || N2 || N3) with `AZDO_HINT_CODES`, `BIFROST_HINT_CODES` and a guarded `failedWith`. Hint text unchanged, printed once, last. No export change.
- B3: `backend/plugin/azdo-remote-config.ts` `codeForStatus`: `status === 407 || status === 470` gives `network-blocked`; Content-Type not read for 470, body cancelled unread. No new import, constant or `__internals` key.
- B4/B5: tests below. B6: `bash scripts/ci.sh` exit 0 (692 pass, 0 fail, 10 skipped; check-lf, check-docs PASS).

## Existing tests re-expected (stricter, none loosened or deleted)
1. `smoke.test.ts` "F-021 AC-7a" retitled "... exactly one network hint"; expected array gains `HINT_SH`, plus a hint-count == 1 assertion.
2. `smoke.test.ts` classifyProbeStatus table: added 469 reachable, 470 blocked, 471 reachable.
3. `smoke.test.ts` Bifrost origin blocked loop: `[403, 407, 470]`.
4. `smoke.test.ts` authenticated timeout and throwing-fetch tests: added `formatSmoke` equality (4 lines, hint last).
5. `install-smoke.test.ts` azdo/bifrost `fail timeout` regexes now include the install.sh hint line before `Done.`.
6. `install-smoke.test.ts` F-021 AC-7b retitled; exact stdout tail now includes the hint.

## Acceptance criteria -> tests
- AC-1 (azdo hint): `smoke.test.ts` "T-035 AC-1" (positive codes for install.sh/install.ps1, negative table); item 4/5 above.
- AC-2 (bifrost hint): "T-035 AC-2" (formatSmoke table, skipped codes, no-key) and "T-035 AC-2: runSmoke ... 407 or 470".
- AC-3 (once, order, edge cases): "T-035 AC-3: the hint is printed at most once..." and "non-string codes and statuses are compared exactly".
- AC-4 (installer 470): "T-035 AC-4: an anonymous probe answered with HTTP 470" (unit), Bifrost-origin loop with 470, and child-process "T-035 AC-4 ... exits 4" in `install-smoke.test.ts`.
- AC-5 (plugin 470): `fetch.test.ts` "T-035 AC-5" (5 content types incl. throwing get, spies, real Response, 469 stays http-469); `hook.test.ts` HINT_CASES 470 row, bound-cache survival loop `respond(470)`, new "T-035 AC5 cache bound to other settings ... 470".
- AC-6 (no leaks): `smoke.test.ts` "T-035 AC-6"; `hook.test.ts` AC6 fetches list gains `respond(470, ...)` and hostile 470.
- AC-7 (FR-11 / no regressions): existing FR-11 lint and `__internals` key-set tests unchanged and green.

## Verification
- `bash scripts/ci.sh` -> exit 0 (`ci: PASS`).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | `backend/installer/smoke.ts` `formatLine` | `formatLine` reads `status`/`code` unguarded (pre-existing), so a throwing-getter hand-built report throws in `formatSmoke` before the hint decision. The architect's "throwing code getter" test case was replaced by exact-comparison tests of non-string values; the hint decision itself is guarded. | none (out of scope) |

## Assumptions
- Working-tree CRLF is git autocrlf; the index is LF (check-lf PASS).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0024/03-backend.md
summary: T-035 backend done: probe 470 blocked, plugin 470 network-blocked, N1|N2|N3 smoke hint; ci.sh exit 0
