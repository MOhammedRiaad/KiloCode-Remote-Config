## Summary
Adds the shared-config deliverables for C1: an example shared `kilo.jsonc` (VISION Appendix A, Bifrost provider, no secrets) and a zero-runtime-dependency validator CLI under `backend/validator/`. It reuses the plugin's JSONC parser and leaves the plugin export surface unchanged. Exit codes: 0 valid, 1 validation errors, 2 usage or I/O error.

## Backlog item
- **ID / title:** F-007 - Shared config repo: example kilo.jsonc and validation script
- **Type:** feature
- **Factory cycle:** `factory/runs/cycle-0009/`

## Acceptance criteria
- [x] AC1 example valid, content - test: `example-config.test.ts` AC1
- [x] AC2 apiKey at any depth - test: `cli.test.ts` AC2
- [x] AC3 sk-bf- secrets in values and comments, never echoed - test: `cli.test.ts` AC3, `rules.test.ts`
- [x] AC4 parse/shape errors exit 1; usage/I-O exit 2 - test: `cli.test.ts` AC4
- [x] AC5 schema subset enforced and pinned to SUPPORTED_KILO_RANGE - test: `schema-subset.test.ts`
- [x] AC6 unresolvable `{file:}` warnings - test: `cli.test.ts` AC6
- [x] AC7 prototype keys, member-name warnings, `--allowed-hosts` - test: `cli.test.ts` AC7, `rules.test.ts`
- [x] AC8 multi-file, ci.sh, no runtime deps, export surface - test: `cli.test.ts` AC8, `example-config.test.ts` AC8, `check-fr11.test.ts`

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS | `04-security.md` |
| Code review | PASS | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (run by reviewer) | `05-review.md` |

## Risk & rollback
Additive change (new `backend/validator/`, `backend/shared-config/`, tests, FR-11 lint rule 5, architecture docs). No plugin source changes. Revert with a single revert commit after squash merge.

## How to verify
```
bash scripts/ci.sh
node backend/validator/validate-kilo-config.ts backend/shared-config/kilo.jsonc
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
