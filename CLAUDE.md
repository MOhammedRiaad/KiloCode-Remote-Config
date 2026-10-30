# AI Factory — Operating Manual

This repository is an **autonomous SDLC factory**. Claude Code runs a fixed pipeline of
specialist subagents in a loop with no human in the loop, and each cycle ships one backlog item:

```
PO -> Architect -> (Senior BE || Senior FE) -> Security -> Code Review -> PR -> Docs -> CI/Release
          ^                    ^                   |            |                         |
          |                    +---- rework (FAIL, max 3) -----+                          |
          +---------------------------- next cycle -------------------------------------+
```

Entry point: the `/factory-cycle` skill (`.claude/skills/factory-cycle/SKILL.md`) runs ONE cycle.
`scripts/factory-loop.sh` / `scripts/factory-loop.ps1` / `.github/workflows/ai-factory.yml` run it repeatedly.

## Ground rules (all agents)

1. **Never ask a human.** There is nobody watching. If information is missing, make the most
   reasonable, conservative decision, record it as an assumption in your report, and move on.
   If you truly cannot continue, finish with `status: BLOCKED` and explain why.
2. **Stay in your lane.** Each agent only edits the paths listed in its definition.
3. **Write a report.** Every agent writes its report to the run folder it is given
   (`factory/runs/cycle-NNNN/NN-<role>.md`) using `factory/templates/report.md`.
4. **End with a result block.** The very last thing in every agent's final reply must be:
   ```
   FACTORY_RESULT
   status: PASS | FAIL | BLOCKED | DONE
   report: <path to report>
   summary: <one line>
   ```
5. **Engineers do not commit.** The orchestrator commits after each phase. Only the PR manager,
   docs writer and CI releaser touch git history / remotes, as described in their definitions.
6. **Never** force-push, rewrite `main`, disable tests to make them pass, commit secrets, or
   weaken security controls to get a PASS.
7. Small, shippable increments. One backlog item per cycle.

## Key files

| Path | Owner | Purpose |
|------|-------|---------|
| `factory/VISION.md` | Human (once) | Product vision. The only human input. |
| `factory/backlog.json` | Product Owner | Prioritized backlog with acceptance criteria. |
| `factory/state.json` | Orchestrator | Cycle counter, phase, current item, status. |
| `factory/runs/cycle-NNNN/` | All agents | Per-cycle reports (the audit trail). |
| `docs/architecture/` | Architect | Architecture overview, ADRs, API contracts. |
| `backend/` | Senior BE | Backend source + tests. |
| `frontend/` | Senior FE | Frontend source + tests. |
| `docs/` (except architecture) | Docs writer | User / developer docs. |
| `scripts/ci.sh`, `.github/workflows/` | CI releaser | Build, test, release automation. |
| `CHANGELOG.md`, `VERSION` | CI releaser | Release history, semver. |

## Conventions

- Branches: `factory/<item-id>-<slug>` off `main`.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`).
- Versioning: SemVer in `VERSION`. While `0.x`: feature → minor, everything else → patch.
- Quality gate: `bash scripts/ci.sh` must pass locally before a PR is merged.
- Tech stack: chosen by the Architect in the first cycle and recorded in
  `docs/architecture/ADR-0001-tech-stack.md`. Every agent must follow it afterwards.
