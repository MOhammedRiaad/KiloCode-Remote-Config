## Summary
Adds `backend/installer/install.ps1`, a thin Windows front end (PowerShell 5.1 and 7+) mirroring `install.sh`. It parses -Org/-Project/-Repo/-Path/-Branch/-Mode/-NoSmoke/-Help with KILO_AZDO_* env fallbacks, checks prerequisites (node >= 22.18, PAT or `az login`), then pipes NUL-terminated stdin records to the shared `install-helper.ts` and returns its exit code (0-4). The virtual key comes only from `KILO_BIFROST_KEY` and travels on stdin only.

## Backlog item
- **ID / title:** F-011 - Bootstrap installer for Windows (install.ps1)
- **Type:** feature
- **Factory cycle:** `factory/runs/cycle-0014/`

## Acceptance criteria
- [x] AC-1 fresh install, byte-identical to install.sh output - `backend/test/installer/install-ps1.test.ts`
- [x] AC-2 env vs parameter precedence, usage errors exit 2 without echo - `install-ps1.test.ts`
- [x] AC-3 existing config preserved, backup made - `install-ps1.test.ts`
- [x] AC-4 no plugin dirs, idempotent re-run - `install-ps1.test.ts`
- [x] AC-5 prerequisite failures exit 1 with fix hints - `install-ps1.test.ts`
- [x] AC-6 smoke pass / fail 401 exit 4 / -NoSmoke - `install-ps1-smoke.test.ts`
- [x] AC-7 key and PAT never in output or argv, no key parameter - `install-ps1.test.ts`, `install-ps1-static.test.ts`
- [x] AC-8 CI green, protected files unchanged, contract documented - `scripts/ci.sh`; `docs/architecture/contracts/installer-cli.md` 1.2.0

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS | `04-security.md` |
| Code review | PASS | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (484 tests, 480 pass, 0 fail, 4 skipped) | `05-review.md` |

## Notable changes
- `.gitattributes`: `*.ps1 text eol=lf` rule added so PowerShell scripts stay LF.
- Shared helper `install-helper.ts` gains a `frontend` stdin record (and `formatSmoke(report, frontEnd)` in `smoke.ts`) so messages read `install.ps1:`. Without the record, install.sh output is byte-identical to before.
- Accepted deviation: the colon form (`-Org:value`) is handled differently under `-File`; reviewed and accepted by Code Review (tested on pwsh 7 and PS 5.1).

## Risk & rollback
Low. New script plus a backward-compatible helper record; install.sh, plugin, personal-config template, validator and package manifests are unchanged. Security note L-1: `%VAR%` in a checkout path is expanded by cmd.exe when node resolves to a `.cmd` shim (low severity, see `04-security.md`). Rollback: revert the squash commit.

## How to verify
```
bash scripts/ci.sh
pwsh -NoProfile -File backend/installer/install.ps1 -Help
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
