# Code Review report — cycle 0005 — F-003: Plugin: in-place merge with defaults/enforce modes

## Inputs read
- `git diff main...HEAD`, excluding factory/ bookkeeping: `backend/plugin/azdo-remote-config.ts` (+98), `backend/test/plugin/merge.test.ts` (new, 315 lines), `backend/test/plugin/azdo-remote-config.smoke.test.ts`, `docs/architecture/ADR-0005-config-merge.md`, `docs/architecture/contracts/plugin-interface.md` (v0.4.0, section 2c), `docs/architecture/overview.md`.
- `factory/backlog.json` F-003 AC1-8, `factory/runs/cycle-0005/01-product-owner.md`, `02-architect.md`, `03-backend.md`, `04-security.md`.
- `git status`: the working tree is clean, with no uncommitted changes.

## Work done
- Ran the full quality gate.
- Read `sanitizeNode`, `containsApiKey`, `mergeInto` and `mergeConfig` (azdo-remote-config.ts:280-372) line by line against ADR-0005 and contract 2c:
  - Mode: `mode === "enforce"` is strict (line 369). Every other value means defaults. Tested with `undefined`, `null`, `""`, `"ENFORCE"`, `"Enforce"`, `"enforce "`, `1`, `true`, `{}` and `["enforce"]`.
  - apiKey: `key.toLowerCase() === "apikey"` is dropped at any depth, including inside arrays (sanitize). The enforce guard keeps a local array or plain object that holds an apiKey at any depth. The scan returns true at depth >= 64, so a deep or cyclic local value is kept and the scan never throws.
  - `__proto__` / `constructor` / `prototype` are skipped at any depth. Every write uses `defineProperty`. Target reads are guarded by `hasOwnProperty.call`.
  - `$schema` / `plugin` are dropped only when `topLevel` is true, which happens only at the root call.
  - Two phases: `sanitizeShared` finishes before `mergeInto` starts, and only phase 1 throws. The depth cap is correct: the root is level 0, a container at level >= 64 throws, so 64 nested containers pass and 65 throw. The message `Config merge: config nested too deeply` is fixed and contains no input data.
  - Key order: existing keys keep their position (`defineProperty` on an existing configurable key does not reorder). New keys are appended in shared order.
  - A local `undefined` value counts as absent (line 354-356).
  - Existing nested plain objects are recursed into and never replaced, so references stay identical.
  - Phase 2 recursion follows the finite sanitized tree, so a cyclic local target cannot cause unbounded recursion.
- Checked that each AC has a test that would fail if the behavior broke. I mentally mutated each guard and checked which test would catch the change:
  - Removing the `isApiKeyName` check in sanitize breaks the AC-3 tests.
  - Removing the `containsApiKey` guard breaks "enforce keeps a local object or array that contains an apiKey".
  - Removing the guard's depth cap breaks the "deep/cyclic local value under enforce" tests, because nested(70) has no apiKey and would be replaced.
  - Removing `isPrototypeKey` breaks the AC-8 `Object.keys` / `hasOwn` assertions.
  - Removing `topLevel` from the `$schema`/`plugin` check breaks the "nested keys named plugin or $schema" test.
  - Changing `>=` to `>` in the depth checks breaks the 64/65 tests for objects and for arrays.
  - Merging in a single pass breaks "target is unchanged when the depth check throws after earlier keys".
  - Removing the `local === undefined` check breaks "a local undefined value counts as absent".
  - Using a case-insensitive mode check breaks "unrecognised modes behave as defaults".
  - Aliasing shared values breaks "mutating shared after the merge does not change target".
  - Concatenating arrays breaks the AC-7 array test.
  - `assert.throws` with a RegExp matches `String(err)`, so the tests check both the error name and the exact message.
- Considered whether Security finding 1 (`containsApiKey` exponential on local DAGs) should block. It should not:
  - The shared side is always a tree after sanitize.
  - Kilo's resolved config comes from JSON and is a tree.
  - Conflicts in one merge are at distinct keys, so each local subtree is scanned at most once per conflict, which is linear for trees.
  - Only aliasing introduced by third-party in-process code could trigger it, and that code is already trusted. It goes to the backlog.
- Lane check:
  - The engineer commit 79b9ec6 touched only `backend/`, plus its own report and `state.json`.
  - The architect commit touched only `docs/architecture/`.
  - Security touched only its report.

## Files changed
- `factory/runs/cycle-0005/05-review.md`: this report. No source was modified.

## Verification
- `bash scripts/ci.sh` exits 0 with `ci: PASS`. It runs 94 tests: 93 pass, 0 fail and 1 is skipped (the pre-existing Windows-only `/dev/zero` test from F-002). `check-lf` passes, and the FR-11 lint passes.
- AC-8 export surface:
  - The smoke test asserts that `Object.keys(__internals)` equals `["parseJsonc", "resolvePlaceholders", "mergeConfig"]`.
  - The runtime named export test is unchanged and still passes.
  - `package.json` is unchanged, with no runtime `dependencies`.

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | low (non-blocking) | backend | backend/plugin/azdo-remote-config.ts:340 | This is Security finding 1. `containsApiKey` keeps no visited set, so a local subtree with shared references (a DAG) is rescanned once per path, which is exponential. It cannot be reached from the shared file or from JSON-sourced local config. | Backlog: add a `WeakSet` of visited objects in `containsApiKey`. |
| 2 | info (test gap) | backend | backend/test/plugin/merge.test.ts | No test covers a shared key that matches an `Object.prototype` member name, such as `toString` or `hasOwnProperty`. If the `hasOwn` read guard at azdo-remote-config.ts:354 were removed, `target["toString"]` would read the inherited function. Defaults mode would then treat it as a conflict and silently skip adding the shared key, and no test would fail. The current code is correct. | Backlog: add a test that a shared `{ toString: "x" }` is added to `{}` in defaults mode. |
| 3 | info | backend | backend/plugin/azdo-remote-config.ts:318 | This is Security finding 2. `node.map` keeps holes in sparse arrays instead of turning them into `null`, as ADR-0005 §5 describes. `JSON.parse` never produces sparse arrays. | Optional: clone arrays with an index loop. |

There are no blocking findings: no CI failure, no missing AC coverage, no contract mismatch, no correctness bug and no weakened tests. The only change to an existing test (the smoke test) makes it stricter by adding `mergeConfig` to the asserted key list.

## Assumptions made (no human available)
- Kilo's resolved config is a JSON-derived tree of plain objects, as ADR-0005 §9 assumes. This is why finding 1 is rated low and non-blocking.
- The skipped test is the documented pre-existing platform skip and is not part of this diff.

## Follow-ups for the backlog
- `containsApiKey`: add a visited `WeakSet` (finding 1).
- Add a regression test for shared keys named like `Object.prototype` members (finding 2).
- Clone arrays with an index loop to match the ADR wording for sparse arrays (finding 3).
- F-006 must log a fixed message on merge errors, never `err.message` (Security finding 3).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0005/05-review.md
summary: mergeConfig matches ADR-0005 and contract 2c exactly, and AC1-8 each have tests that would catch a regression; CI passes; 1 low and 2 info findings go to the backlog.
