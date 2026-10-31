# Security report — cycle 0010 — F-009: Personal config template

## Inputs read
- `git diff main...HEAD` (branch `factory/F-009-personal-config-template`), `git status` (clean)
- `factory/runs/cycle-0010/02-architect.md`, `03-backend.md`, ADR-0011, `docs/architecture/contracts/personal-config-template.md`
- `backend/validator/kilo-config-rules.ts` (SECRET_PATTERN), `backend/test/validator/helpers.ts`

## Work done
- **Secrets**: grepped the full diff for secret-shaped strings (`sk-xx-<8+ alnum>`, private keys, `ghp_`, `AKIA`, passwords) and tracked `.env` files. The only `sk-bf-` occurrences are the placeholder `sk-bf-<your-virtual-key>` and the documented fake test key `sk-bf-AbCdEf1234567890` in backlog text; in test code the fake key is assembled by concatenation in the pre-existing `helpers.ts` (not a real credential). No `.env` files tracked.
- **Placeholder vs SECRET_PATTERN** (`/sk-bf-[a-z0-9]/i`): the character after `sk-bf-` is `<`, so the placeholder cannot match; asserted in the AC4 test and AC5 validator test. AC5 positive control proves the check is not vacuous and that findings do not echo the secret tail.
- **No `pat` option**: plugin options are exactly org/project/repo/path/branch/mode (asserted by test); comment directs users to `AZDO_PAT` env var or `az login` (FR-3).
- **FR-17 warning**: header comment states the file belongs in `~/.config/kilo/kilo.jsonc`, must never be placed in a project directory or committed; asserted by AC1 regex test.
- **Plugin/validator unchanged**: `git diff main...HEAD -- backend/plugin backend/validator backend/package.json` is empty.
- **Test hermeticity**: tests read only repo files, inject `env: {}` into `resolveSettings`, perform merges in memory, no network, no writes, no reliance on host `AZDO_PAT`/home dir.
- **`.gitattributes`** `*.jsonc text eol=lf`: low-risk normalisation; `git check-attr` confirms `eol: lf` on the template; file is pure ASCII.
- **Injection / AuthZ / XSS / CORS / headers**: not applicable (static data file + tests; no new code paths or endpoints).

## Files changed
- `factory/runs/cycle-0010/04-security.md` — this report

## Verification
- `bash scripts/ci.sh` -> `ci: PASS` (324 tests, 323 pass, 0 fail, 1 skipped pre-existing; FR-11 lint and check-lf PASS)
- `npm audit --omit=dev --audit-level=high` (backend) -> found 0 vulnerabilities; no runtime dependencies

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/personal-config/kilo.jsonc:27 | Placeholder `sk-bf-<your-virtual-key>` will be sent as a bearer value if the user forgets to replace it. Harmless (not a credential, fails auth), noted for installer UX. | None required. |

No critical, high or medium findings.

## Assumptions made (no human available)
- The fake key in `helpers.ts` and backlog text is an intentional, non-functional test fixture (pre-existing from F-007) — acceptable.

## Follow-ups for the backlog
- F-010/F-011 installers: when copying the template, preserve the file with user-only permissions (e.g. 0600 on POSIX / user ACL on Windows) since the user will place a real virtual key in it, and never overwrite an existing personal config without backup.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0010/04-security.md
summary: No secrets, placeholder cannot match SECRET_PATTERN, no pat option, FR-17 warning present, plugin/validator untouched, tests hermetic, CI green, 0 vulns.
