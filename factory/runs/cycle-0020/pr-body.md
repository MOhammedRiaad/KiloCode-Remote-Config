## WARNING - read first
The 5 POSIX symlink/race tests (AC-3) were SKIPPED on the Windows dev host and have NEVER RUN anywhere. They were verified by reading/tracing only (by Backend, Security and Review). They MUST be confirmed as PASSED (not skipped) on a Linux/ubuntu CI run (`ubuntu-latest`, `bash scripts/ci.sh`) before this change is relied upon. The descriptor-level O_NOFOLLOW/fchmod refusal path is untested on every platform (follow-up).

## Summary
Installer hardening for `backend/installer`: install.sh is now CDPATH-safe and checks that `install-helper.ts` is a regular file (fixed one-line stderr, exit 3 otherwise); install-helper.ts re-lstats configDir, azdoDir and kilo.jsonc after mkdir and before any chmod/write, refusing symlinks, with fd-based O_NOFOLLOW mode changes (new `fs-guard.ts`); the Node version test now really executes the version check (22.17.1 refused, 22.18 / 23 pass); the key-leak test also covers an sk-bf- key. Installer contract bumped to 1.2.1, ADR-0012 amended.

## Backlog item
- **ID / title:** T-019 - Installer hardening: CDPATH-safe helper lookup, symlink re-check, Node version test fix
- **Type:** tech-debt / security (backend only, patch bump)
- **Factory cycle:** `factory/runs/cycle-0020/`

## Acceptance criteria
- [x] AC-1 CDPATH relative invocation runs the real helper, no stray cd output - install-sh.test.ts (T-019 AC-1 tests)
- [x] AC-2 missing helper: exit 3, exact one-line stderr, node not invoked, no stack - install-sh.test.ts (T-019 AC-2)
- [ ] AC-3 post-mkdir symlink re-check refusal, target untouched - 5 POSIX tests in install-sh.test.ts (RACES) plus injected-lstat unit tests in fs-guard.test.ts. Unit tests pass; the 5 POSIX tests are UNRUN (skipped on Windows). Pending Linux CI confirmation.
- [x] AC-4 Node version: 22.17.1 exits 1; 22.18.0 and 23.0.1 pass - "T-019 AC-4 Node 22.17.1 is refused..." and "T-019 AC-4 Node 22.18 and newer pass ... and install"
- [x] AC-5 sk-bf- KILO_BIFROST_KEY absent from stdout/stderr - install-sh.test.ts key-leak test (extended)
- [x] AC-6 `bash scripts/ci.sh` exit 0; contract documents exit-3 message and re-check; existing installer tests still pass

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (2 low follow-ups, 1 info) | `04-security.md` |
| Code review | PASS (1 low, 4 info) | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS on Windows: 624 tests, 614 pass, 0 fail, 10 skipped (includes the 5 unrun POSIX tests); Linux CI pending | `03-backend.md` |

## Risk & rollback
- Main risk is the unverified POSIX race tests and the race fixture's reliance on `syncBuiltinESMExports()` live bindings; a failure on Linux CI would show up as test failures, not product breakage.
- Descriptor-level O_NOFOLLOW refusal (ELOOP/ENOTDIR/wrong-type) and rename-over-link behaviour are untested (follow-up: trigger swap on first O_NOFOLLOW open).
- install.ps1 unchanged. Rollback: revert the squash commit.

## How to verify
- `bash scripts/ci.sh` on Linux (ubuntu); confirm the 5 T-019 AC-3 tests are reported as passed, not skipped.
- `cd backend && node --test test/installer/install-sh.test.ts test/installer/fs-guard.test.ts`
