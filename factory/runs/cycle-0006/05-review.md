# Code Review report — cycle 0006 — F-004: Plugin: settings resolution (options, env, defaults)

## Inputs read
- `git diff main...HEAD` (excluding `factory/`): `backend/plugin/azdo-remote-config.ts`,
  `backend/test/plugin/settings.test.ts` (new), `backend/test/plugin/azdo-remote-config.smoke.test.ts`,
  `docs/architecture/ADR-0006-settings-resolution.md`, `docs/architecture/contracts/plugin-interface.md` (v0.5.0),
  `docs/architecture/overview.md`. No uncommitted changes in the working tree.
- `factory/backlog.json` (F-004 AC1-AC8), `factory/runs/cycle-0006/03-backend.md` (orchestrator transcription),
  `factory/runs/cycle-0006/04-security.md`.

## Work done
- Ran the full quality gate myself.
- Mapped every AC to code and tests.
- Checked the code line by line against contract section 2d / ADR-0006: W0-W4 texts byte-for-byte, warning
  order (W0 first, then setting order org..timeoutMs, option before env), at most one warning per setting
  and source, option -> env -> default fall-through, per-setting validators, `pat` descriptor, `deps`/`deps.env`
  handling, timeoutMs range 1..2147483647, settings key order, and no `throw` in the new section.
- Mutation-tested the new code in a scratch copy (the repo was not touched): I made 23 targeted mutations to
  guards and validators and ran `settings.test.ts` against each one. Every mutation was **killed**. They covered
  the control-char bound, the 0x7F check, the `%` reject, the `.` name check, `//` and the trailing `/` in branch,
  the space in branch, the `.` path segment, the lower and upper timeout bounds, `Number.isInteger`, the digit-only
  string check, the writable and configurable flags on `pat`, the own-data-only read, the `deps.env` null vs
  undefined split, the malformed env falling to `{}` instead of `process.env`, `Array.isArray`, trimming, the
  empty-string skip, W0 emission, fall-through after a warning, `missing` for repo, and case-insensitive mode.

## Files changed
- `factory/runs/cycle-0006/05-review.md`: this report (only file edited).

## Verification
- `bash scripts/ci.sh` exited 0. 130 tests: 129 pass, 0 fail, 1 skipped (the existing `/dev/zero` test, which is
  skipped on win32). check-fr11 PASS, check-lf PASS, typecheck PASS.
- The claims in 03-backend.md hold, with one small correction: `settings.test.ts` has **36** `test(...)` calls,
  not 37. This does not matter.
- `grep throw` finds no `throw` in lines 373-575 (the settings section). All `throw` hits are in earlier helpers.
- Lanes: code changes are only in `backend/`. `docs/architecture/` was changed by the Architect commit. No
  `frontend/` changes, which is correct for a backend-only item.

### AC coverage
| AC | Code | Tests (settings.test.ts unless noted) |
|---|---|---|
| AC1 option > env > default, all 8 | `pickSetting` :530 | "precedence: option beats env for all 8", "env beats default for all 8", pat precedence |
| AC2 defaults + missing | `resolveSettings` :552-573 | "defaults with nothing configured", "missing is empty when..." |
| AC3 mode | `checkMode` | "mode enforce from option and env", "invalid mode falls back...", fall-through test |
| AC4 timeoutMs | `checkTimeout`, `inTimeoutRange` | invalid option and env lists (0, negatives, NaN, Infinity, 2.5, "1e3", 2^31), valid forms incl. bounds 1 and 2147483647 |
| AC5 malformed options/values, trim, path normalisation | `isRecordLike`, `checkString`, `acceptPath` | W0 test, W1 test, empty/whitespace, path/org/branch rule tests |
| AC6 PAT secrecy | `defineProperty` :567, fixed warning texts | sentinel test over 9 input shapes, descriptor test |
| AC7 no mutation, own-only, pollution | `readOwn`, `selectEnv` | no-mutation and frozen inputs, inherited env/options, accessor, `__proto__` JSON, proxies, malformed `deps.env` |
| AC8 CI, no deps, only the new `__internals` key | n/a | smoke test asserts exact `__internals` key order, check-fr11, green CI |

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | low (non-blocking) | backend (F-005) | `backend/plugin/azdo-remote-config.ts:458` (`checkString`) | Lone UTF-16 surrogates are accepted in org/project/repo/path/branch (for example `org: "\uD800"`). The ADR and contract only require no control chars and none of `/ \ ? # %`, so this matches the contract. The risk is that F-005's required `encodeURIComponent` would throw a `URIError` on such a value. | No fix needed in F-004. F-005 must handle it: either add an `isWellFormed()` check (W2) to the string validators through a contract and ADR amendment, or treat a `URIError` during URL building as a fail-soft "invalid setting". F-006 already catches everything, so there is no crash path today. |
| 2 | info | orchestrator | `factory/runs/cycle-0006/03-backend.md` | The transcribed report says there are 37 new tests. There are 36. | None. |

### Lone-surrogate decision
This does not block. The ADR is the contract for this item, and the implementation follows it exactly. Adding a
check now would be a validation rule the Architect never specified, so it would be scope creep. Nothing calls
`resolveSettings` yet (F-006 does the wiring), and F-005 is the item that adds URL encoding. That is where the
guard belongs, and it needs a contract amendment (v0.5.1) when it is added.

### Maintainability
- The code is clean and table-driven (`SETTING_SPECS`). `pickSetting` uses one loop for both sources, so
  "one warning per setting and source" holds by construction. The constants are named and the types stay
  module-local, as the contract requires.
- Minor nit: the string validators run `trim()` before calling `hasControlChar`. `String.prototype.trim` also
  strips characters such as `\t` and `\n` at the edges, so a value like `"org\n"` is accepted as `"org"`. The
  contract says to trim first, so this is correct. It is noted here only for docs.

## Assumptions made (no human available)
- Accessor `deps.env` falls back to `process.env`. This follows the ADR line that says accessors are treated as
  absent, and absent `deps.env` means `process.env`. It is consistent with the contract.
- I judged that the lone-surrogate issue belongs to F-005 rather than F-004 (see above).

## Follow-ups for the backlog
- F-005: decide how to handle lone surrogates (an `isWellFormed` check in the validators plus a contract change,
  or catching `URIError` while building the URL). Add a test with `org: "\uD800"`.
- Docs: in the user-facing settings docs (docs writer), say that values are trimmed and that `KILO_AZDO_PAT` is
  the only env PAT source until F-005.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0006/05-review.md
summary: F-004 resolveSettings matches contract 2d/ADR-0006 exactly, all AC1-8 covered by tests that kill 23/23 guard mutations, CI green; lone-surrogate deferred to F-005
