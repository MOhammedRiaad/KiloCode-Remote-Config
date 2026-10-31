# Code Review report — cycle 0010 — F-009: Personal config template

## Inputs read
- `git diff main...HEAD` (13 files; working tree clean)
- `factory/backlog.json` (F-009, AC1-AC7), `01-product-owner.md`, `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/contracts/personal-config-template.md` (C3 v1.0.0), ADR-0011
- `backend/test/validator/helpers.ts`, `backend/validator/kilo-config-rules.ts` (SECRET_PATTERN), `backend/plugin/azdo-remote-config.ts` (mergeConfig signature)

## Work done
- Ran the full quality gate.
- Extracted the jsonc block from contract section 1 and byte-compared it with `backend/personal-config/kilo.jsonc`: identical. No BOM, ASCII only, `git ls-files --eol` reports `i/lf w/lf attr/text eol=lf`.
- Mapped each AC to code and to a test that would fail if broken (table below).
- Confirmed `backend/plugin/**`, `backend/validator/**`, `backend/package.json`, `scripts/`, `tools/` are untouched in the diff (`git diff main...HEAD --name-only` on those paths is empty).
- Checked the `.gitattributes` change.

### AC coverage
| AC | Implementation | Test (`backend/test/personal-config/template.test.ts`) |
|----|----------------|------|
| AC1 | template root keys, `$schema`, header comments | "AC1: template parses..." (L25), "AC1: comments name the global path..." (L33; comment-anchored regexes, `/m` so they do not cross lines) |
| AC2 | plugin tuple, six options | L38 (length 1, tuple length 2, exact sorted keys, no `pat`, non-empty strings, `/` prefix, mode enum) |
| AC3 | complete options | L56 (`resolveSettings(opts, { env: {} })`, missing/warnings empty, each setting equals the option) |
| AC4 | provider holds only apiKey placeholder | L66 (exact key lists at three levels, `sk-bf-` prefix, `SECRET_PATTERN.test` false; pattern has no `g` flag, so no lastIndex statefulness) |
| AC5 | placeholder not secret-shaped | L77 (no secret-pattern; errors exactly `[api-key]`, warnings exactly `[plugin-ignored]`, stricter than the AC and matches I6) and L86 positive control (`assert.notEqual(replaced, raw)` guards a no-op replace; no rule/location/message contains SECRET_TAIL) |
| AC6 | merge preserves local | L101-115, both modes; `mergeConfig` mutates the target in place (returns void, L412 of the plugin), so the assertions on `local` are meaningful; plugin/$schema compared with structuredClone snapshots |
| AC7 | no plugin/validator/package change | ci.sh exit 0; existing "AC8: plugin export surface is unchanged" and "AC1: example config validates clean" (validator CLI on the shared example) still pass; package.json has only devDependencies |

### .gitattributes (`*.jsonc text eol=lf`)
Sound. The repo has two `.jsonc` files (shared example and the new template), both already LF in the index, so no renormalisation is needed. The rule forces LF in the working tree even with `core.autocrlf=true`, which fixes the pre-existing test that asserts no `\r` in the shared example on Windows checkouts. It matches the existing `*.sh text eol=lf` rule. The contract's CRLF note still holds: the new tests use `raw.replace` and comment regexes that work with both line endings.

## Files changed
- `factory/runs/cycle-0010/05-review.md` — this report (only file edited by the reviewer).

## Verification
- `bash scripts/ci.sh` → exit 0: 324 tests, 323 pass, 0 fail, 1 skipped (pre-existing); typecheck, FR-11 lint and check-lf PASS.
- Contract section 1 vs template: `cmp` identical.
- `git ls-files --eol '*.jsonc'` → both files `i/lf w/lf attr/text eol=lf`.

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | info | backend | backend/test/personal-config/template.test.ts:7 | Imports shared helpers from `../validator/helpers.ts` (cross-suite coupling). Acceptable reuse; not a defect. | None (follow-up at most). |
| 2 | info | backend | backend/test/personal-config/template.test.ts:13-23 | `Record<string, any>` casts are used to navigate the parsed tree. Fine for tests; typecheck passes. | None. |

No blocking findings. No correctness bugs, no contract mismatch, no weakened tests, and the engineers stayed in their lanes. The `.gitattributes` edit is outside the engineer lanes but was made by the orchestrator, and it is correct.

## Assumptions made (no human available)
- `03-backend.md` was transcribed by the orchestrator; I verified its claims (test count, untouched paths, CI result) myself instead of relying on it.

## Follow-ups for the backlog
- Consider moving `backendRoot`, `examplePath`, `FAKE_SECRET` and `SECRET_TAIL` from `test/validator/helpers.ts` into a shared `test/helpers.ts` if more suites start using them.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0010/05-review.md
summary: F-009 template byte-identical to contract C3 section 1; AC1-AC7 implemented and covered by tests; ci.sh exit 0 (324 tests, 0 fail); plugin/validator untouched; .gitattributes LF rule correct.
