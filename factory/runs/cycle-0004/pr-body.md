## Summary
Adds `{env:NAME}` and `{file:path}` placeholder resolution (FR-5 / AC-8) as the pure helper
`__internals.resolvePlaceholders` in `backend/plugin/azdo-remote-config.ts`. It returns
`{ value, unresolved }`, where `unresolved` lists placeholder names only, never values. Env, home dir and
file reader are injectable. It is not yet wired into the config hook (F-006). Zero runtime dependencies.
Security FAIL on the first pass was fixed in one rework: the default reader now stat-guards to regular
files of 1 MiB or less, UNC and device paths are rejected first, and de-duplication is Set-based.

## Backlog item
- **ID / title:** F-002 / Plugin: {env:} and {file:} placeholder resolution
- **Type:** feature (backend only)
- **Factory cycle:** `factory/runs/cycle-0004/`

## Acceptance criteria
- [x] AC1 env resolves, test: `AC-1: {env:NAME} resolves`, `default env is process.env`
- [x] AC2 missing var drops the key, test: `AC-2: a missing env var drops the key`
- [x] AC3 partial unresolved becomes empty string, test: `AC-3: partially unresolved`, `two adjacent unresolved`
- [x] AC4 `~/` file, trimmed, correct target path, test: `AC-4: {file:~/path}`
- [x] AC5 unreadable file dropped with no leak, test: missing / directory / oversize / throwing reader (CANARY) / throwing homedir / UNC / relative
- [x] AC6 nested objects and arrays, test: `AC-6: nested arrays and objects...`, `other types...`
- [x] AC7 no mutation, no pollution, multiple placeholders, test: `AC-7: input is not mutated`, `__proto__...`, `several placeholders`
- [x] AC8 CI green, no runtime deps, export surface, test: `azdo-remote-config.smoke.test.ts` (exact `__internals` keys, FR-11 lint)

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | FAIL (04) then PASS (08) after 1 rework | `04-security.md`, `08-security-rework1.md` |
| Code review | PASS (no blocking findings, 2 info) | `09-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (64 tests: 63 pass, 1 skipped on win32) | |

## Risk & rollback
- **Accepted risk (FR-5, by design):** the shared config can read any environment variable or any
  user-readable file into the Kilo config. The config is PR-gated. Architect-accepted in ADR-0004; an
  allowlist is a possible follow-up.
- The `/dev/zero` guard test only runs on Linux CI. It is skipped on Windows. The oversize temp-file test covers the guard on every platform.
- Minor: stat-then-read TOCTOU (availability only) and `/proc` pseudo-files bypass the size cap. Both are accepted.
- Rollback: squash merge gives a single revert commit. The helper is not wired in, so runtime impact is nil until F-006.

## How to verify
```
bash scripts/ci.sh
git diff main...HEAD --stat
```

Info-level follow-ups: inherited-string env test, exact 1 MiB boundary test.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
