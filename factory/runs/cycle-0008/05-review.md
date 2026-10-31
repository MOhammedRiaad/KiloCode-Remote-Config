# Code Review report — cycle 0008 — F-006: Plugin: cache, fallback, logging and never-crash wiring

## Inputs read
- `git diff main...HEAD` (13 files), `git status` (clean), `git log main..HEAD --name-only`
- `factory/runs/cycle-0008/01-product-owner.md` (8 ACs), `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/contracts/plugin-interface.md` 0.7.0 (sections 2f, 2f-L, 3, 5), `ADR-0008`, `ADR-0009`
- `backend/plugin/azdo-remote-config.ts` (new hook section, journaled merge), `backend/test/plugin/hook.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`

## Work done
- Ran the full quality gate.
- Mapped every AC to code and to a test that would fail if it broke.
- Checked the code against contract 2f / 2f-L: order of steps, reasons, cache path, content, write and read rules, logger call shape, exact message texts. They match line for line. The `__internals` key order matches. The server does no I/O.
- Checked the journaled merge and rollback, the atomic write, the cache read, the fire-and-forget logger and the never-reject wrapper.
- Checked the replaced T-001 smoke tests. "config hook leaves the config deep-equal" and "stub never logs" asserted the T-001 no-op, which contract section 3 now marks as superseded. Asserting them now would be wrong. What they still meant to protect is covered: same reference (AC1 tests plus the in-place design), unchanged config on failure (AC4/AC8 tests), and fixed logs only (AC7 and the child-process wiring test). They were legitimately superseded, not weakened.
- Checked the lanes. The engineer commit `cf501d4` touches only `backend/`, its own report and `state.json`. The design docs are in the architect commit.
- Reproduced finding 1 (below) with a fake home.

AC coverage:
| AC | Code | Test | OK |
|---|---|---|---|
| 1 defaults / enforce merge | `executeHook`, `applyShared` | "AC1 defaults mode ...", "AC1 enforce mode ..." | yes |
| 2 cache write | `writeCache` (wx 0600, rename, dir 0700, sanitised unresolved) | "AC2 success writes ..." (POSIX mode check skipped on win32) | yes |
| 3 fetch failure, valid cache | `readCache` fallback, L-CACHE | "AC3 network/http-500/timeout ..." (bytes + mtime unchanged) | yes |
| 4 no / corrupt cache | L-NONE, early return | 7 corrupt variants, absent, oversized | yes |
| 5 missing settings / invalid fetched content | L-MISSING, `validateShared` | "AC5 ..." (fetch and az spies, 6 invalid variants, keeps cache) | yes |
| 6 placeholders | `resolvePlaceholders` + `listNames` | "AC6 ..." x2 | yes |
| 7 no secrets in logs | fixed messages, no `extra` | "AC7 ..." (JSON + inspect showHidden, exact arg shape) | yes |
| 8 never-crash, ci, ADR | outer try/catch, rollback, ADR-0009 | "AC8 ..." suite, smoke child-process test, ci.sh | yes, but see finding 1 |

## Files changed
- `factory/runs/cycle-0008/05-review.md`: this report.

## Verification
- `bash scripts/ci.sh` exited 0 (`ci: PASS`): 267 tests, 266 pass, 0 fail, 1 skipped; lint (FR-11), typecheck and check-lf passed.
- Reproduction of finding 1: I created a fake home holding `.cache/kilo-azdo/remote-config.json = {"model":"from-real-home"}` and ran `HOME=<fake> USERPROFILE=<fake> node --test --test-name-pattern="hostile deps" test/plugin/hook.test.ts`. Result: FAIL at `hook.test.ts:542`, `actual { model: 'from-real-home' }, expected {}`. The fake home was removed afterwards.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | medium | backend/test/plugin/hook.test.ts:538-544 | **Not hermetic: the test reads the real home cache and real env, and can reach the network.** "AC8 hostile deps never reject" calls `runConfigHook({}, {org:"o"}, cfg, deps)` with `deps` in `[null, "x", 5, [], undefined]`. That gives `readHookDeps` an empty result, so the hook falls back to the real `os.homedir`, the real `node:fs` and `process.env`. Scenario A (reproduced): a developer who has used the plugin has `~/.cache/kilo-azdo/remote-config.json`. The cache fallback merges it into `cfg`, and `assert.deepEqual(cfg, {})` fails, so CI passes or fails depending on the machine. Scenario B: a CI runner or shell has `KILO_AZDO_PROJECT` and `KILO_AZDO_REPO` set. `missing` is then empty, so the test runs a real `fetch` to dev.azure.com (or the real `az` CLI) and may write the real `~/.cache/kilo-azdo/remote-config.json`. This breaks the item's rule "tests never touch the real home directory or network". | **Backend.** Run the default-deps cases in a child process with `HOME` and `USERPROFILE` set to a temp dir and `KILO_AZDO_*`, `AZDO_PAT` and `AZURE_DEVOPS_EXT_PAT` removed (the same pattern as the smoke test at `azdo-remote-config.smoke.test.ts:41`). Alternatively keep it in-process but give options that make all of org/project/repo missing, and redirect `HOME`/`USERPROFILE` for the duration. The in-process `os.homedir` is not reliably redirectable, so the child process is preferred. Keep the assertion that `cfg` is unchanged. |
| 2 | info | backend/plugin/azdo-remote-config.ts:1180-1182 | `statSync` size check, then `readFileSync`, is a TOCTOU: the file can grow past 2 MiB between the two calls. The impact is bounded: it is the user's own cache dir, and the parse is linear. | Backlog: read through an fd (`openSync`/`fstatSync`/`readSync` with the cap), or check `text.length` after reading. |
| 3 | info | backend/test/plugin/hook.test.ts:370-419 | The "failing collaborators" loop checks `noLeak` and that no cache was written, but not that `cfg` ends unchanged or fully merged (AC8 wording). Other AC8 tests cover this for the merge-failure cases. | Backlog: also assert `cfg` deep-equals `localConfig()` or the expected merged value in each case. |
| 4 | info | backend/test/plugin/hook.test.ts:266 | For the deep-nesting case the regex `invalid-(jsonc\|shape)` accepts either code, so it does not pin which layer rejects the input. | Backlog: assert the exact code. |
| 5 | info | backend/test/plugin/azdo-remote-config.smoke.test.ts:12-18 | No test asserts the contract 3 rule "server MUST NOT log" now that the logging stub test is gone. | Backlog: record logger calls in `makeInput` and assert `server()` makes none. |

## Assumptions made (no human available)
- Finding 1 is gating. It is a correctness bug in the test suite: the gate result depends on the state of the machine's home directory and env, and it breaks an explicit item requirement. It is not a style nit.
- Security findings 1-5 in `04-security.md` are already routed to the backlog and are not repeated here.

## Follow-ups for the backlog
- Findings 2-5 above.
- Security follow-ups from `04-security.md` (cache fingerprint, bidi/U+2028 in `cleanName`, stale tmp sweep, temp-home cleanup in tests).

FACTORY_RESULT
status: FAIL
report: factory/runs/cycle-0008/05-review.md
summary: F-006 code matches contract 2f and all 8 ACs; ci PASS; FAIL on 1 medium backend test-hermeticity bug (hostile-deps test reads real ~/.cache and process.env, may hit network; reproduced)
