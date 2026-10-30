# 03 — Senior Backend (F-004) — transcribed by orchestrator

Note: the engineer returned its report in the reply and did not write this file (it cited an instruction not to write report files that the orchestrator never gave). The orchestrator transcribed the engineer's reported results below; they are the engineer's claims, not independently verified here.

## Summary
resolveSettings implemented in backend/plugin/azdo-remote-config.ts (section "Settings resolution (ADR-0006)"); __internals = { parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings }. New backend/test/plugin/settings.test.ts (36 tests); smoke test updated. Hook untouched, no new imports/exports/deps.

## Reported verification
- `bash scripts/ci.sh` exit 0; 130 tests, 129 pass, 0 fail, 1 skipped (pre-existing /dev/zero on win32); check-fr11 and check-lf PASS.
- grep: only 11 pre-existing JSDoc block-comment lines; none in code/strings/regex of the new section; no non-ASCII/CR bytes; no `throw` in the new section; no `dependencies` in package.json.

## Acceptance criteria -> tests (settings.test.ts unless noted)
AC-1 precedence tests (option>env>default for all 8, pat option beats env); AC-2 defaults + missing; AC-3 mode; AC-4 timeoutMs; AC-5 malformed options / path / org-project-repo / branch rules; AC-6 PAT sentinel, non-enumerable read-only pat; AC-7 no mutation, inherited/accessor/proxy inputs, __proto__ pollution, malformed deps.env; AC-8 smoke test + green CI.

## Assumptions
- null/non-object `deps`, or undefined `deps.env` -> process.env; non-undefined non-record deps.env -> empty env.
- A space inside `path` is allowed (ADR forbids spaces only for branch).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0006/03-backend.md
summary: resolveSettings implemented, 36 new tests, CI green (transcribed by orchestrator)
