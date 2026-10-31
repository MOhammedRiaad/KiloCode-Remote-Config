# Backend report - cycle 0011 - F-010 bootstrap installer (install.sh)

## Work done
- BE-1: `backend/tools/check-fr11.mjs` rule 5 generalised into `checkHelperDir(root, folder)`, used for `validator` and `installer` (rule 6). `backend/tsconfig.json` includes `installer/**/*.ts`. Tests added to `test/tools/check-fr11.test.ts`.
- BE-2: `backend/installer/personal-config-edit.ts` (pure): `validateInputs`, `refersToAzdoPlugin`, `renderFresh`, `planUpdate`, `renderUpdated`, `storedApiKey`.
- BE-3: `backend/installer/install-helper.ts` (all I/O, stdin NUL records, read-only phase then write phase, fixed error messages, exit 2/3).
- BE-4: `backend/installer/install.sh` (bash 3.2 compatible, builtins + node + az only, LF).
- BE-5: `backend/test/installer/helpers.ts`, `install-sh.test.ts`, `personal-config-edit.test.ts`.
- Untouched: plugin, personal-config/kilo.jsonc, validator, package.json.

## Acceptance criteria -> tests (backend/test/installer/install-sh.test.ts unless noted)
| AC | Tests |
|----|-------|
| AC-1 fresh install | "AC-1 fresh install ...", "flags beat environment", "XDG_CONFIG_HOME selects the target directory", "--help ..."; unit: personal-config-edit.test.ts fresh render tests |
| AC-2 no secrets printed | "neither the key nor the PAT is ever printed", "without a key the placeholder...", "a key flag does not exist...", "a key with control characters..." |
| AC-3 update + backup | "update keeps other settings ... backs up byte-identically", "update without a key keeps the existing key"; unit: update/apiKey/dropped tests |
| AC-4 no plugin/ copy | "nothing is written to plugin/ or plugins/ ... once", "existing copy in plugin/ triggers a warning" |
| AC-5 prerequisites | "no az and no PAT", "az present but not logged in", "logged-in az satisfies", "a PAT variable skips az", "Node too old", "every failing prerequisite is reported", "Node 22.18 and newer pass" |
| AC-6 idempotent | "running twice changes nothing (fresh / update start)", "changed plugin copy is refreshed"; unit: "update is idempotent" |
| AC-7 errors | missing org/project/repo, unknown flags, invalid values, problem configs (invalid JSONC, array root, plugin object, provider array), oversized config, relative XDG, symlinked kilo.jsonc (POSIX only) |
| AC-8 lint | "install.sh is LF only and passes bash -n", "avoids eval, set -x and external commands"; check-fr11 installer tests |

## Verification
- `cd backend && npm run lint` -> `check-fr11: PASS`
- `cd backend && npm run typecheck` -> no errors
- `cd backend && npm test` -> pass (see ci run)
- `bash scripts/ci.sh` -> 376 pass, 0 fail, 4 skipped (POSIX mode/symlink checks skipped on Windows git-bash); `check-lf: PASS`; `ci: PASS`

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions
- Empty-string flag values count as absent (fall back to env, then default), same as env.
- Names of dropped old plugin options are printed only when they match `/^[A-Za-z0-9_.-]{1,40}$/`; otherwise "(unprintable name)".
- Warnings (auto-loaded copies, other config files, odd key prefix) are printed to stderr after the write phase.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0011/03-backend.md
summary: install.sh + install-helper.ts + personal-config-edit.ts + lint rule 6 + tests; scripts/ci.sh passes
