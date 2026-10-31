# Code Review report — cycle 0015 — F-008: Shared config repo: Azure Pipelines PR gate and branch policy setup

## Inputs read
- `git diff main...HEAD` (25 files; working tree clean, no uncommitted changes)
- `factory/backlog.json` (F-008, AC1..AC8), `01-product-owner.md`, `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/contracts/shared-config-repo.md`, ADR-0015
- `backend/shared-config/{azure-pipelines.yml,set-branch-policies.sh,package.json,.gitattributes}`
- `backend/tools/assemble-shared-repo.ts`, `backend/tools/check-fr11.mjs`, `backend/tsconfig.json`
- `backend/test/shared-config/{helpers.ts,assemble.test.ts,pipeline.test.ts,branch-policies.test.ts}`, `backend/test/tools/check-fr11.test.ts`

## Work done
- Ran the full quality gate.
- Mapped every AC to its implementation and to a test that would fail if the AC were broken.
- Checked the implementation against contract sections 1-4: YAML text, 9-file manifest and order, step order, az argv, messages, exit codes and quoting rule.
- Checked the two deviations the engineer reported, test hermeticity and the skips, and that unrelated paths were left unchanged.
- Ran manual probes (see Verification).

### Acceptance criteria coverage
| AC | Implementation | Test that would fail if broken |
|---|---|---|
| AC1 pipeline triggers / Node / no npm / validator step | `azure-pipelines.yml` (byte-for-byte equal to the contract section 3 text) | `pipeline.test.ts` "AC1: ..." (6 tests: trigger, pr include main, UseNode@1 22.x + 22.18 guard, no package manager, script needles, env pass-through + default, no CR/tab) |
| AC2 root + teams validated, no/empty teams OK | script step: `nullglob`, array, `--` | `pipeline.test.ts` "AC2: ..." runs the extracted step in bash against an assembled tree. PATH holds only a `node` shim, which also proves the step uses builtins only. |
| AC3 apiKey / sk-bf secret / off-list host fail without leak | validator (unchanged), called with `--allowed-hosts "$KILO_ALLOWED_HOSTS"` | 6 mutation tests (root and team file) plus the empty-hosts fail-closed test. The tests assert the mutation changed the text, so none of them is vacuous. |
| AC4 tree assembled, byte-identical, package.json module, no deps | `assemble-shared-repo.ts` (fixed manifest, `COPYFILE_EXCL`, `lstat`) | `assemble.test.ts` (exact file set, byte equality, pkg shape, output text, empty dir accepted, non-empty dir / file refused, usage errors, help) |
| AC5 dry run: exactly 3 commands, no az call | `print_command` + `cmd_*` arrays | `deepEqual` of the whole stdout against `shQuote(expectedArgv)`, az log empty, org normalisation for 4 forms, dry run with no az on PATH |
| AC6 real run: exact argv, literal hostile values, stop on failure, no az output | `run_policy`, `az "$@" </dev/null >/dev/null 2>&1` | exact argv via a NUL-separated stub log; hostile `;`, `$( )` and backtick values with canary files; a failure test per policy (record count = index+1, exact stderr); missing az; PAT/stdout/stderr markers never leak |
| AC7 usage errors exit 2, no echo, no az, PAT sentinel never printed, no token flag | argument parser + validation | missing flag (each), empty / `-x` / valueless values, duplicate flag, `--pat`, `--token=`, `--org=`, positional, 10 invalid-value cases, help; PAT sentinel in every env; static test (no eval / -c / source / PAT expansion, `bash -n`) |
| AC8 ci passes, protected paths unchanged, docs | lint rule 8 + tsconfig include; contract + ADR-0015 + overview | `bash scripts/ci.sh` exit 0; check-fr11 tests for rule 8; `git diff main...HEAD -- backend/plugin backend/validator backend/installer backend/personal-config backend/shared-config/kilo.jsonc backend/package.json frontend` is empty |

### Deviations the engineer reported
1. **Usage text uses a `while IFS= read -r` loop over a heredoc instead of `cat`.** This is correct and required, because the contract allows only bash builtins plus `az`. `read -r` with an empty IFS keeps the leading spaces and the trailing `\`. The heredoc always ends with a newline, so no line is lost. Accepted.
2. **The Windows hostile-value test quirk (values contain a space).** On Windows, MSYS re-tokenises the command line, so the harness picks values that Node quotes. The script's handling of values is shown by the canary-file checks and by the exact argv comparison. The `;`, `$( )`, backtick and `'` cases are all covered. This affects the test harness only, so I accept it.

### Skips
`ci.log` shows 5 skips. One of them is new: "AC4: set-branch-policies.sh is executable on POSIX" (`skip: isWindows`). That is correct, because chmod has no meaning on Windows and the test runs on Linux CI. The other 4 skips were already on main.

### Other checks
- overview.md had 5 NUL bytes on main and has 0 now.
- No changes outside `backend/` except the architect's docs and factory files.

## Files changed
- `factory/runs/cycle-0015/05-review.md` — this report.

## Verification
- `bash scripts/ci.sh` → exit 0, `ci: PASS`; 548 tests, 543 pass, 0 fail, 5 skipped; the new shared-config and check-fr11 tests are in the run.
- Probe: assemble tool copied into a backend-less directory → `assemble-shared-repo: missing source file shared-config/.gitattributes`, exit 1, and no output directory is created (contract order: sources are checked before anything is written).
- Probe: `--dry-run --dry-run` with a project value of `a&b\c` → exit 2, `--dry-run given more than once`, usage on stderr, value not echoed.
- Protected paths diff: empty.

## Findings / issues
| # | Severity | File:line | Finding | Required fix | Owner |
|---|----------|-----------|---------|--------------|-------|
| 1 | info | backend/shared-config/set-branch-policies.sh:9-10 | The `printf` format in `usage()` contains a literal newline (`'%s<LF>'`) instead of `'%s\n'`. It works, but it is easy to "fix" by mistake and it reads oddly. | Backlog: write it as `printf '%s\n' "$line"`. | backend |
| 2 | low | backend/test/shared-config/assemble.test.ts | Three contract paths have no tests: exit 1 "missing source file" (it works, see the probe above), a symlink outdir being refused, and `cannot write output (<CODE>)`. These paths are not part of the ACs. | Backlog: test the tool with a copy in a temp `backend/` that has no sources; add a symlink test on POSIX. | backend |
| 3 | low | backend/shared-config/set-branch-policies.sh:107-115 | Same as security finding 1: a leading `@` is accepted, and az then loads the value from a file. | Backlog (as filed by security). | backend |

No correctness bugs, contract mismatches, weakened tests or out-of-lane edits were found.

## Assumptions made (no human available)
- Findings 1 and 2 do not block: AC4 does not require the missing-source path, and the behaviour was checked manually.
- I could not test bash 3.2 compatibility because no 3.2 binary is available. A static review found no 4.x-only constructs, which matches the security review.

## Follow-ups for the backlog
- `printf '%s\n'` in `usage()` (finding 1).
- Tests for the assemble tool's missing-source, symlink and I/O-error paths (finding 2).
- Reject a leading `@` in text-rule values (finding 3 / security 1); check the build-policy expiry semantics (security 2).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0015/05-review.md
summary: F-008 passes review. CI is green (543 pass / 0 fail), AC1-AC8 each have code and a test that would catch a regression, the contract is matched exactly, and there are no correctness bugs; 3 non-blocking findings go to the backlog.
