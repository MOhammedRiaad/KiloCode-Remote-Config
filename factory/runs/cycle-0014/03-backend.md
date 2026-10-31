# Backend report - cycle 0014 - F-011 (install.ps1)

## Work done
- B1: `install-helper.ts` optional `frontend` record (`install.sh` | `install.ps1`, invalid/duplicate -> exit 3 bad helper input); prefix, usage hint, `-Org` style labels, warnings and exit-4 text follow it. `smoke.ts`: `FrontEnd` type, `formatSmoke(report, frontEnd = "install.sh")`.
- B2: `backend/installer/install.ps1` (ASCII, LF, no BOM, manual `$args` parsing, Process-based stdin hand-over).
- B4-B7: `ps-helpers.ts`, `install-ps1.test.ts`, `install-ps1-smoke.test.ts`, `install-ps1-static.test.ts`, `install-helper-frontend.test.ts`, one test added to `smoke.test.ts`.
- B3 (.gitattributes) done by the orchestrator; untouched.

## Acceptance criteria -> tests
| AC | Tests |
|----|-------|
| AC-1 fresh install, byte parity with install.sh, XDG | install-ps1.test.ts "AC-1 ..." (4 tests) |
| AC-2 inputs, usage errors, help | "AC-2 ..." (env/params, missing, 9 bad-argument forms, help x5) |
| AC-3 update, backup, parity | "AC-3 ..." (4 tests) |
| AC-4 plugin location, idempotence | "AC-4 ..." (fresh/update/auto-loaded) |
| AC-5 prerequisites | "AC-5 ..." (no creds, not logged in, PAT vars, node missing/old/unknown, all reported, extensionless ignored, helper missing) |
| AC-6 smoke | install-ps1-smoke.test.ts (pass, 401 exit 4, AzDO fail, -NoSmoke, no key hint) |
| AC-7 secrets | install-ps1.test.ts "AC-7 ..." plus noSecrets/assertClean in every smoke test, argv logs |
| AC-8 format, lint, contract | install-ps1-static.test.ts, install-helper-frontend.test.ts, ci.sh lint rule 7 |

## Verification
- `cd backend && node --test test/installer/install-ps1*.test.ts` -> 72 pass, 0 fail (each psTest runs on pwsh 7.6.9 and, for parity-marked tests, also on Windows PowerShell 5.1).
- `bash scripts/ci.sh` -> exit 0 (484 tests, 480 pass, 0 fail, 4 skipped = pre-existing POSIX-only skips), lint, typecheck, check-lf PASS.
- `git diff --stat main -- install.sh plugin personal-config package.json package-lock.json validator` -> empty.

## Findings / deviations
- Under `-File`, both hosts split `-Org:value` into two tokens (`-Org`, `value`), so contract 10.1 "`-Name:value` is a usage error" cannot hold for `-File` runs; it is accepted as `-Org value` and nothing is echoed. Only reachable in-process. Suggest the architect relax that sentence. No colon-form test is included for that reason.
- Mixed CRLF/LF in `install-helper.ts` working copy came from the autocrlf checkout; git normalises.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0014/03-backend.md
summary: install.ps1 + helper frontend record + tests (72 new) pass on pwsh 7 and PS 5.1; ci.sh exits 0
