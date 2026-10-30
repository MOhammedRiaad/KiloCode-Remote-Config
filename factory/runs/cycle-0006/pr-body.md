## Summary
Implements `resolveSettings` in `backend/plugin/azdo-remote-config.ts` (ADR-0006): resolves plugin settings from options, environment and defaults with strict validation, a non-enumerable read-only PAT, and no input mutation. Backend only; the hook is untouched and there are no new dependencies.

## Backlog item
- **ID / title:** F-004 - Plugin: settings resolution (options, env, defaults)
- **Type:** feature
- **Factory cycle:** `factory/runs/cycle-0006/`

## Acceptance criteria
- [x] AC-1 precedence (option > env > default, PAT option beats env) - `backend/test/plugin/settings.test.ts` precedence tests
- [x] AC-2 defaults and missing values - settings.test.ts defaults/missing tests
- [x] AC-3 mode - settings.test.ts mode tests
- [x] AC-4 timeoutMs - settings.test.ts timeoutMs tests
- [x] AC-5 malformed options, path, org/project/repo, branch rules - settings.test.ts validation tests
- [x] AC-6 PAT sentinel, non-enumerable read-only pat - settings.test.ts PAT tests
- [x] AC-7 no mutation, inherited/accessor/proxy inputs, `__proto__` pollution, malformed deps.env - settings.test.ts robustness tests
- [x] AC-8 smoke test and green CI - plugin smoke test, `bash scripts/ci.sh`

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS | `04-security.md` |
| Code review | PASS | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (130 tests, 129 pass, 0 fail, 1 skipped; check-fr11, check-lf PASS), as reported by backend | `03-backend.md` |

## Risk & rollback
- Lone surrogates are accepted by validators. Deferred to F-005, which must handle them before `encodeURIComponent`.
- `repo` no longer defaults to `kilo-config` (contract 0.5.0); callers must supply it.
- The `/dev/zero` test is skipped on Windows (pre-existing).
- Rollback: revert the squash/merge commit.

## How to verify
```
bash scripts/ci.sh
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
