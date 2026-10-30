## Summary
Adds `__internals.mergeConfig(target, shared, mode)` to the single plugin file `backend/plugin/azdo-remote-config.ts`. It deep-merges the parsed shared config into Kilo's config in place. `defaults` mode lets local values win; `enforce` mode lets shared values win. Shared `apiKey` keys (any depth, any case) are never applied, prototype keys are skipped, and nesting is capped at 64. It is not wired into the config hook yet (F-006). No new runtime dependencies (FR-11).

## Backlog item
- **ID / title:** F-003 - Plugin: in-place merge with defaults/enforce modes
- **Type:** feature (backend only)
- **Factory cycle:** `factory/runs/cycle-0005/`
- **Mode:** local (no origin remote). `pr: local`. Not merged by the PR manager.

## Acceptance criteria
Tests are in `backend/test/plugin/merge.test.ts` unless stated otherwise.
- [x] AC-1 defaults local wins / enforce shared wins - "defaults mode: local wins...", "enforce mode: shared wins..."
- [x] AC-2 nested conflicts per mode - "nested conflict resolves per mode"
- [x] AC-3 shared apiKey never applied - "shared apiKey never replaces...", "shared apiKey is not added..."
- [x] AC-4 local-only keys unchanged - "local keys absent from shared are unchanged in both modes"
- [x] AC-5 top-level `$schema`/`plugin` ignored - "top-level $schema and plugin are ignored...", "nested keys named plugin..."
- [x] AC-6 no aliasing of shared - "target reference and nested references are kept...", "mutating shared after the merge..."
- [x] AC-7 arrays are leaves, type conflicts by mode, unknown mode is defaults - "arrays are replaced wholesale", "type conflicts resolve by mode", "unrecognised modes behave as defaults"
- [x] AC-8 prototype safety and depth/cycle limits - "prototype keys from JSON.parse are skipped...", depth 64/65 and cyclic tests; export surface in `azdo-remote-config.smoke.test.ts`

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (46/46 adversarial assertions; npm audit 0 vulns) | `04-security.md` |
| Code review | PASS | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (94 tests: 93 pass, 1 skip) | `03-backend.md`, `05-review.md` |

## Risk & rollback
Accepted residual risks:
- A shared file can add a `baseURL` next to a local `apiKey`. The shared repo is PR-gated and trusted.
- `containsApiKey` is exponential only on local graphs with shared references. This needs a pathological local config, not shared input.
- The `/dev/zero` test is skipped on Windows (pre-existing from F-002).

The helper is unused until F-006, so runtime impact is nil. Rollback is a single revert of the squash commit.

## How to verify
```
bash scripts/ci.sh
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
