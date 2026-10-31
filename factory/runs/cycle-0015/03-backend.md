# Backend report - cycle 0015 - F-008

## Work done
- BE-1: `backend/shared-config/package.json`, `.gitattributes`, `azure-pipelines.yml` (contract C3 text verbatim).
- BE-2: `backend/shared-config/set-branch-policies.sh` (bash builtins + az only; usage printed with a `read` loop because `cat` is not a builtin).
- BE-3: `backend/tools/assemble-shared-repo.ts` (9-file manifest, COPYFILE_EXCL, lstat outdir check, exit 0/1/2).
- BE-4: `tools/check-fr11.mjs` rule 8 (tools/*.ts: node: imports only, no require), `tsconfig.json` include `tools/**/*.ts`, 4 new cases in `test/tools/check-fr11.test.ts`.
- BE-5: `backend/test/shared-config/{helpers,assemble,pipeline,branch-policies}.test.ts`.
- Untouched: plugin, validator, installer, personal-config, shared-config/kilo.jsonc, package.json.

## Acceptance criteria -> tests
| AC | Proof |
|---|---|
| AC1 pipeline triggers/Node/no npm/validator step | pipeline.test.ts "AC1: ..." (6 tests) |
| AC2 root + teams/*/kilo.jsonc validated | pipeline.test.ts "AC2: ..." (4 tests, runs extracted step against assembled tree) |
| AC3 secrets/apiKey/off-list host/empty hosts fail, no value leak | pipeline.test.ts "AC3: ..." (6 mutation tests + fail-closed) |
| AC4 C1 tree assembled, byte-identical, no deps | assemble.test.ts (10 tests), "every shared-config file LF-only" |
| AC5 dry-run prints exact 3 az commands, org normalisation | branch-policies.test.ts "AC5: ..." (5 tests) |
| AC6 real run argv, hostile values literal, failure stops, no PAT leak, missing az | branch-policies.test.ts "AC6: ..." (7 tests) |
| AC7 usage errors exit 2, no echo, no az call, help | branch-policies.test.ts "AC7: ..." (about 25 tests), static test (no eval/-c/source, bash -n) |
| AC8 no changes to plugin/validator/installer/etc, no runtime deps | `git status` shows none of those paths modified; check-fr11 rule 8 tests; `npm run lint` PASS |

## Verification
- `cd backend && npm run lint` -> check-fr11: PASS
- `npm run typecheck` -> clean
- `npm test` / `bash scripts/ci.sh` -> 548 tests, 543 pass, 0 fail, 5 skipped; `ci: PASS`, exit 0.
- `git status --short`: only backend/shared-config new files, backend/tools/assemble-shared-repo.ts, backend/test/shared-config/, and edits to tools/check-fr11.mjs, tsconfig.json, test/tools/check-fr11.test.ts.

## Findings / issues
| # | Severity | File | Finding | Note |
|---|---|---|---|---|
| 1 | info | test/shared-config/branch-policies.test.ts | On Windows, MSYS bash re-parses the command line, so hostile test values containing `'` or a newline need a space to be quoted by Node (`O'Brien Jr`). Test harness artefact only; the script is unaffected. | none |
| 2 | info | tools/check-fr11.mjs, test/tools/check-fr11.test.ts | Files have pre-existing CRLF/LF mixed endings in the Windows working copy (git normalises). | none |

## Assumptions
- Hostile `--project`/`--reviewer-group` test values contain a space for the reason in finding 1.
- Usage error text for the two text-rule flags is `invalid value for --project` / `invalid value for --reviewer-group` (contract table 4.5 placeholder).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0015/03-backend.md
summary: F-008 backend done: C1 template, assemble tool, branch-policy script, lint rule 8, 58+ new tests; scripts/ci.sh passes
