## Summary
Adds the C1 shared config repo template under `backend/shared-config/`: an Azure Pipelines PR validation pipeline that runs the F-007 validator over `kilo.jsonc` and `teams/*/kilo.jsonc`, a zero-dependency bash branch-policy script (`set-branch-policies.sh`) applying FR-14 to `main` via `az repos policy`, and `backend/tools/assemble-shared-repo.ts`, which writes the complete C1 tree (byte-identical copies, refuses a non-empty outdir). FR-11 lint gains rule 8. Plugin, validator, installers and personal config are unchanged.

## Backlog item
- **ID / title:** F-008 - Shared config repo: Azure Pipelines PR gate and branch policy setup
- **Type:** feature
- **Factory cycle:** `factory/runs/cycle-0015/`

## Acceptance criteria
- [x] AC1 - pipeline triggers, Node >= 22.18, no npm, validator step - `pipeline.test.ts` "AC1: ..." (backend/test/shared-config/)
- [x] AC2 - root and teams validated; no or empty teams dir exits 0 - `pipeline.test.ts` "AC2: ..."
- [x] AC3 - apiKey / sk-bf secret / off-list host fail, no leak - `pipeline.test.ts` "AC3: ..." mutation tests plus empty-hosts fail-closed
- [x] AC4 - assembled tree byte-identical, package.json module, no deps - `assemble.test.ts`
- [x] AC5 - dry run prints exactly 3 az commands, az never invoked - `branch-policies.test.ts` "AC5: ..."
- [x] AC6 - real run exact argv, hostile values literal, stops on failure - `branch-policies.test.ts` "AC6: ..."
- [x] AC7 - usage errors exit 2, no echo, PAT never printed, no token flag - `branch-policies.test.ts` "AC7: ..."
- [x] AC8 - `bash scripts/ci.sh` passes, protected paths unchanged, docs updated - `check-fr11.test.ts` (rule 8), ADR-0015, `contracts/shared-config-repo.md`

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS | `04-security.md` |
| Code review | PASS | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (run by review) | `05-review.md` |

## Risk & rollback
- The PR gate relies on policy (blocking required reviewer, creator's vote not counting, votes reset on push) because a PR can alter its own gate (the pipeline file is in the PR).
- Open follow: the semantics of `--valid-duration 0` are unverified against real Azure DevOps.
- Open follow (low): a leading `@` in a value could trigger az file expansion.
- The real Azure DevOps repo, pipeline and branch policies must still be created by an operator. The script does not detect existing policies; re-running creates duplicates (stated in usage).
- Rollback: squash merge, so a single revert commit.

## How to verify
- `bash scripts/ci.sh`
- `node backend/tools/assemble-shared-repo.ts <emptydir>`
- `bash backend/shared-config/set-branch-policies.sh --help`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
