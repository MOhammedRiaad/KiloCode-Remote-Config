# Backend report — cycle 0004 — F-002: Plugin: {env:} and {file:} placeholder resolution

## Inputs read
- ADR-0004, `02-architect.md` (BE-1..BE-4), plugin, smoke test, `check-fr11.mjs`, `backend/package.json`.

## Work done
- BE-1: added `resolvePlaceholders` to the plugin as in ADR-0004 (sync, injectable env/homedir/readFile, own-property env lookup, relative/bare `~`/`~user` paths unresolved without reading, errors discarded in unbound `catch`, single pass via replace callback, DROP sentinel, `defineProperty` output, depth cap 64 with fixed message). Added `node:` imports (fs, os, path). `__internals = { parseJsonc, resolvePlaceholders }`. Header comment updated. New code uses `//` comments only.
- BOM fix: `const BOM` now uses the `﻿` escape. Verified with a byte count: 0 occurrences of EF BB BF and 0 non-ASCII bytes in the plugin file.
- LF: the plugin file actually had CRLF line endings in the working tree (161 CR bytes); it is now LF-only (0 CR). Test files also 0 CR.
- BE-2: `backend/test/plugin/placeholders.test.ts` (30 tests).
- BE-3: smoke test updated (`__internals` keys, exact sorted named exports).

## Files changed
- `backend/plugin/azdo-remote-config.ts`
- `backend/test/plugin/placeholders.test.ts` (new)
- `backend/test/plugin/azdo-remote-config.smoke.test.ts`

## Verification
- `bash scripts/ci.sh` -> exit 0 (check-fr11 PASS, typecheck, 61 tests pass / 0 fail, check-lf PASS).
- Python byte counts: plugin file and both test files have 0 CR; plugin and placeholders test have 0 raw BOM bytes (the test used a raw BOM at first, replaced with the escape).
- Plugin file contains 11 existing `/**` openers and 11 `*/` closers, all in pre-existing JSDoc comments; the new code has none. `package.json` unchanged (no dependencies).

Acceptance criteria to tests (all in `placeholders.test.ts` unless noted):
- AC-1: "AC-1: {env:NAME} resolves...", "default env is process.env".
- AC-2: "missing env var drops the key", "empty and inherited env names are unresolved".
- AC-3: "partially unresolved string...", "two adjacent unresolved...".
- AC-4: "~/path", "~\\path", "absolute path ... default reader", "home directory only requested for ~/".
- AC-5: missing file, directory, throwing reader (canary), throwing homedir (canary), non-string/whitespace results, relative paths never read.
- AC-6: nested drop, unchanged types, literal non-placeholders, root string undefined, verbatim names.
- AC-7: non-mutation, `__proto__`/`constructor`/`prototype`, multiple placeholders, no re-expansion (env and file content, `$&`), de-dup and order, names as written; depth cap 64/65 and cyclic.
- AC-8: smoke test "no named export is a function..." (keys `["parseJsonc","resolvePlaceholders"]`) and "runtime named exports are exactly the documented set".

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/plugin/azdo-remote-config.ts | Working tree file was CRLF despite earlier claims; converted to LF | none |

## Assumptions made (no human available)
- The default-reader tests use the real filesystem in a temp dir (removed afterwards).
- Tests use only the fake canary `SECRET-CANARY-42`; no realistic keys.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0004/03-backend.md
summary: resolvePlaceholders implemented per ADR-0004 with 30 new tests; ci.sh exit 0; BOM escape and LF verified
