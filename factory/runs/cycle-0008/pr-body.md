## Summary
Wires the shipped helpers (resolveSettings, fetchRemoteConfig, parseJsonc, resolvePlaceholders, mergeConfig) into the plugin `config` hook in `backend/plugin/azdo-remote-config.ts`. Adds an atomic 0600 cache of the unresolved shared config, cache fallback on fetch failure, secret-free logging via an injectable logger seam, and never-crash behaviour. Adds ADR-0008 (wiring/cache/logging) and ADR-0009 (settings and content trust boundary).

## Backlog item
- **ID / title:** F-006 - Plugin: cache, fallback, logging and never-crash wiring
- **Type:** feature
- **Factory cycle:** `factory/runs/cycle-0008/`

## Acceptance criteria
- [x] AC1 defaults/enforce merge in place (AC-6, AC-7) - tests in `backend/test/plugin/hook.test.ts`
- [x] AC2 cache written atomically, 0600 on POSIX, placeholders unresolved, info log - `hook.test.ts`
- [x] AC3 fetch failure uses cache, warn log with fixed code (AC-3) - `hook.test.ts`
- [x] AC4 no cache / corrupt cache leaves config unchanged, error log (AC-4) - `hook.test.ts`
- [x] AC5 missing settings skip fetch and az; invalid/non-object content never merged or cached - `hook.test.ts`
- [x] AC6 placeholder handling, no values logged (AC-8) - `hook.test.ts`
- [x] AC7 no secrets in any logger argument (AC-9, FR-9) - `hook.test.ts`, `azdo-remote-config.smoke.test.ts`
- [x] AC8 never-crash across internal failures (FR-10); ci.sh, FR-11 lint, ADR present - `hook.test.ts` (incl. hostile deps), `scripts/ci.sh`

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (first pass and re-check, info findings only) | `04-security.md`, `04-security-rerun1.md` |
| Code review | FAIL then PASS after 1 rework (test hermeticity fix) | `05-review.md`, `05-review-rerun1.md` |
| Local CI (`scripts/ci.sh`) | PASS (267 tests, 266 pass, 1 skipped POSIX-only on win32) | see `05-review-rerun1.md` |

## Risk & rollback
Backend plugin only; no frontend. Open info items: cache-read TOCTOU, case-insensitive env filter in a test on Windows, formatting nits. Rollback: revert the squash-merge commit.

## How to verify
`bash scripts/ci.sh`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
