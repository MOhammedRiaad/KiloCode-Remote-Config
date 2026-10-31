## Summary
Adds `backend/installer/install.sh` (bash 3.2 compatible) plus a typed Node helper (`install-helper.ts`, `personal-config-edit.ts`). It copies the plugin to the Kilo config dir, creates or updates the personal `kilo.jsonc` (other keys preserved, byte-identical backup), checks prerequisites (Node, az login or PAT), and never prints the key or PAT. The FR-11 lint gains rule 6 for the `installer/` folder. The smoke test (FR-22) is split out to F-019.

## Backlog item
- **ID / title:** F-010 - Bootstrap installer for macOS/Linux (install.sh)
- **Type:** feature
- **Factory cycle:** `factory/runs/cycle-0011/`

## Acceptance criteria
- [x] AC-1 fresh install - tests: "AC-1 fresh install ...", "flags beat environment", "XDG_CONFIG_HOME selects the target directory"
- [x] AC-2 no secrets printed - tests: "neither the key nor the PAT is ever printed", "a key flag does not exist..."
- [x] AC-3 update + backup - tests: "update keeps other settings ... backs up byte-identically", "update without a key keeps the existing key"
- [x] AC-4 no plugin/ copy - tests: "nothing is written to plugin/ or plugins/ ... once"
- [x] AC-5 prerequisites - tests: "no az and no PAT", "az present but not logged in", "a PAT variable skips az", "Node too old"
- [x] AC-6 idempotent - tests: "running twice changes nothing (fresh / update start)"
- [x] AC-7 errors - tests: missing org/project/repo, unknown flags, invalid configs, oversized config
- [x] AC-8 lint - tests: "install.sh is LF only and passes bash -n", check-fr11 installer tests

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (2 low, 3 info follow-ups) | `04-security.md` |
| Code review | PASS (2 low, 2 info follow-ups) | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS: 376 pass, 0 fail, 4 skipped | |

## Risk & rollback
- Low risk: new files under `backend/installer/` and `backend/test/installer/`; plugin, personal-config template, validator and package.json are unchanged.
- Test gap: POSIX file-permission and symlink tests (4) were skipped on the Windows dev host. They must run on Linux CI.
- Review low finding: the "Node 22.18 and newer" test uses `--help` and is vacuous; follow-up to tighten it.
- Rollback: revert the squash commit.

## How to verify
```
bash scripts/ci.sh
cd backend && npm run lint && npm run typecheck && npm test
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
