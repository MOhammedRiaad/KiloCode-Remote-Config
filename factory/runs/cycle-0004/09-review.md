# Code Review report (Re-review 1) — cycle 0004 — F-002: Plugin: {env:} and {file:} placeholder resolution

## Inputs read
- `factory/backlog.json` (F-002, AC1-AC8), `factory/runs/cycle-0004/01..08-*.md`.
- `docs/architecture/ADR-0004-placeholder-resolution.md`, `docs/architecture/contracts/plugin-interface.md` (v0.3.1, section 2b).
- `git diff main...HEAD` (excluding `factory/`): `backend/plugin/azdo-remote-config.ts`,
  `backend/test/plugin/placeholders.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`,
  `docs/architecture/*` (architect lane). No uncommitted changes.

## Work done
- Ran the full quality gate.
- Checked each AC against code and a test that would fail if the behaviour broke.
- Checked conformance with contract 2b line by line:
  - grammar regexes, used verbatim
  - whole-string drop (object key, array element, root -> `undefined`)
  - partial -> `""`
  - own-property, non-empty env lookup
  - single pass with a function replacer (no re-expansion, `$` literal)
  - UNC check first, before `homedir`/`readFile`
  - `~/` and `~\` expansion, relative / `~` / `~user` rejected without a read
  - guarded default reader (`statSync`, `isFile`, `size <= 1 MiB`, before any open)
  - unbound `catch`
  - de-duplicated, first-occurrence `unresolved`
  - `defineProperty` containers
  - depth cap: root is level 0, level 64 throws the fixed message (64 nested arrays pass, 65 throw, cyclic input throws)
- Scratch probe (outside repo):
  - An env whose prototype holds a string (`Object.create({INH:"leak"})`) gives `env:INH` unresolved, as the contract requires.
  - `{env:A}x{env:B}` is treated as partial, not whole.
  - Trailing `\n` after a placeholder is not a whole-string match.
- Checked the BOM claim. `azdo-remote-config.ts:43` is now `const BOM = "﻿";`. A Python scan of every
  non-node_modules file under `backend/` (`plugin/*.ts`, `test/**/*.ts`, `tools/*.mjs`) finds 0 characters
  outside printable ASCII plus `\n`/`\t`. The claim is confirmed.
- Lanes: the source diff touches only `backend/` (engineer) and `docs/architecture/` (architect). OK.

## Files changed
- `factory/runs/cycle-0004/09-review.md` — this report.

## Verification
- `bash scripts/ci.sh` -> exit 0, `ci: PASS`. 64 tests: 63 pass, 1 skipped (`/dev/zero`, win32 only). Typecheck, FR-11 lint and check-lf all PASS.
- `backend/package.json` has no `dependencies` key. The plugin imports only `node:` built-ins.

### AC coverage
| AC | Code | Test that would fail |
|----|------|----------------------|
| AC1 env resolves | `lookupPlaceholder` | `placeholders.test.ts` "AC-1: {env:NAME} resolves", "default env is process.env" |
| AC2 missing -> key absent | `resolveString` DROP + `resolveContainer` | "AC-2: a missing env var drops the key" (`"x" in value` false, exact `unresolved`) |
| AC3 partial -> empty | `replace` callback returns `""` | "AC-3: partially unresolved", "two adjacent unresolved" |
| AC4 `~/` file, trimmed, target path | `readPlaceholderFile` | "AC-4: {file:~/path}" asserts value and `spy.paths == [join(home,"secret.txt")]` |
| AC5 unreadable -> dropped, no leak | try / unbound catch, `readGuardedFile`, `isUncLike` | missing / directory / oversize (real default reader), throwing reader with CANARY, throwing homedir, UNC, relative |
| AC6 nested, array removal, other types | `walk` / `resolveContainer` | "AC-6: nested arrays and objects..." (`["abc","keep"]`), "other types..." |
| AC7 no mutation, no pollution, multi | `defineProperty`, new containers | "AC-7: input is not mutated", "__proto__...", "several placeholders" |
| AC8 CI, no deps, export surface | `__internals = { parseJsonc, resolvePlaceholders }` | smoke tests: exact `__internals` keys and the exact runtime export set; FR-11 lint tests |

## Findings / issues
No blocking findings.

| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | info | backend | `backend/test/plugin/placeholders.test.ts:55-62` | The "inherited env names" test only uses inherited members that are not strings (`constructor`, `toString`, `__proto__`). If someone removed the `hasOwnProperty` guard, these would still be rejected by the `typeof value === "string"` check, so the test would not catch it. The code itself is correct (verified with a probe). | Optional: add a case with `env: Object.create({ INH: "x" })` that expects `env:INH` to be unresolved. Backlog follow-up. |
| 2 | info | backend | `backend/test/plugin/placeholders.test.ts:130-140` | The size cap is tested only at cap + 1. The exactly-1 MiB boundary (allowed by the contract) is not tested. Security confirmed it by a manual probe. | Optional: add an exact-cap file that resolves. Backlog follow-up. |

## Assumptions made (no human available)
- The ADR and contract changes under `docs/architecture/` are the architect's lane, so I checked them only for consistency with the code.
- I treated the win32 skip of the `/dev/zero` test as acceptable. It runs on Linux CI, and the security probe covered Windows device names.

## Follow-ups for the backlog
- Strengthen the own-property env test with an env object that inherits a string property (finding 1).
- Add an exact 1 MiB boundary test for the default reader (finding 2).
- Note for F-006: on Windows, `process.env` lookups are case-insensitive. The contract's "names used verbatim" holds only for injected envs. Consider documenting this.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0004/09-review.md
summary: F-002 re-review 1 PASS; CI green, AC1-8 covered by tests, matches contract v0.3.1, BOM escape confirmed; 2 info-level test follow-ups.
