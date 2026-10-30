# Code Review report — cycle 0002 — T-001: Project skeleton & CI

## Inputs read
- `git diff main...HEAD` (excluding `factory/`), `git status` (clean), `git ls-files backend`
- `factory/backlog.json` (T-001 acceptance criteria), `01-product-owner.md`, `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/ADR-0001-tech-stack.md`, `ADR-0002-plugin-module-shape.md`, `contracts/plugin-interface.md`
- `scripts/ci.sh`

## Work done
- Ran the quality gate and the backend steps.
- Traced every acceptance criterion to code and to a test.
- Compared the plugin stub with contract sections 1-3 and ADR-0002, line by line.
- Read the FR-11 lint script and its tests for logic bugs, and checked lane discipline.

## Files changed
- `factory/runs/cycle-0002/05-review.md` — this report.

## Verification
- `bash scripts/ci.sh` -> **exit 2**. The backend path ran and passed: `npm ci`, `lint` (`check-fr11: PASS`), `typecheck` and `test` (15/15 pass). The script then failed at `scripts/ci.sh:45` (`bash scripts/check-compose.sh`) with `awk: cannot open file docker-compose.yml`. This failure is outside this cycle's diff and was predicted in `02-architect.md` finding 1. The ci-releaser rewires `ci.sh` in the prepare phase, and the orchestrator told me not to fail the review for AC1/AC5. Because of that, I am not counting it as an automatic FAIL here. **It must be green before merge.**
- AC2: ADR-0001 has the headings `### 1. Language / runtime`, `### 2. Test runner`, `### 5. Supported Kilo version range` and `### 6. Zero-runtime-dependency single-file plugin constraint (FR-11)`.
- Lane check: changed files are only under `backend/` and `docs/architecture/` (the architect's lane). `node_modules/` is not tracked. The plugin file uses LF line endings.

## Acceptance criteria -> code -> test
| AC | Code | Test that would fail if broken |
|----|------|--------------------------------|
| AC1 ci.sh green, backend steps shown | backend `package.json` scripts | Pending the ci-releaser; backend steps already run and pass inside `ci.sh` |
| AC2 ADR-0001 sections | `docs/architecture/ADR-0001-tech-stack.md` | Heading check is planned as a `ci.sh` guard (architect note 7, ci-releaser) |
| AC3 smoke test, plugin -> `config` hook | `backend/plugin/azdo-remote-config.ts:41-45` | `azdo-remote-config.smoke.test.ts` "plugin has id and server function", "server returns a config hook" |
| AC4 no `dependencies` | `backend/package.json`, `backend/tools/check-fr11.mjs:36-38` | `check-fr11.test.ts` "real tree passes", "non-empty dependencies fail" |
| AC5 ci.yml invokes ci.sh | — | Pending the ci-releaser |
| AC6 `config` is a no-op | `azdo-remote-config.ts:42` | Smoke test "config hook leaves the config deep-equal and the same reference" |

## Contract conformance
- Exported types, `PLUGIN_ID`, `SUPPORTED_KILO_RANGE`, `__internals = {}`, the module-local `AzdoRemoteConfig` and `export default { id, server }` match `contracts/plugin-interface.md` §1-2 exactly.
- There are no extra named exports and no exported functions (enforced by a test).
- §3 behaviour holds: `server` resolves for `{}`, `undefined` and `null`, does no I/O and no logging, and `config` is a no-op. No HTTP API and no frontend exist, so there is no BE/FE mismatch to check.

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | info | ci-releaser | scripts/ci.sh:45 | The gate currently exits 2 because the leftover `check-compose.sh` call needs `docker-compose.yml`. The backend steps before it pass. | Prepare phase: apply architect notes 1-7 and confirm `bash scripts/ci.sh` exits 0 before the PR is merged (AC1, AC5). |
| 2 | low | backend | backend/tools/check-fr11.mjs:17-27 | The regex lint can be bypassed (template-literal or variable `import()`, `createRequire`, string literals containing `/*`). This is already logged by Security #1. It is not a correctness bug for the T-001 ACs. | Backlog (see follow-ups). |
| 3 | low | backend | backend/test/tools/check-fr11.test.ts | Some lint branches have no tests: `export ... from "pkg"`, bare `import "pkg"`, missing `package.json`, invalid JSON in `package.json`, missing `plugin/` dir, and `--root` without a value. The code handles all of them (I checked by reading it). | Backlog: add fixtures together with the hardening item. |

There are no correctness bugs, no contract mismatches and no weakened tests in this diff.

## Assumptions made (no human available)
- I did not count the `ci.sh` exit 2 as a FAIL for this review gate. The failing step is in the ci-releaser's lane, the diff does not touch it, and the orchestrator explicitly deferred AC1/AC5 to the prepare phase. The merge gate still requires a green `ci.sh`.

## Follow-ups for the backlog
- Harden `backend/tools/check-fr11.mjs`: use an AST or `ts.preProcessFile` to list imports, reject non-literal `import()` and `createRequire`, and add fixtures for Security probes 1-4 plus the untested branches in finding 3.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0002/05-review.md
summary: Backend skeleton matches the contract/ADR-0002 and AC3/AC4/AC6 are covered by tests (15/15 pass). ci.sh still fails at the leftover check-compose step, which the ci-releaser must fix before merge. Two low findings go to the backlog.
