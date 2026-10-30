---
name: factory-status
description: Report the AI Factory's current state - status, cycle, phase, current item, backlog counts, last release and the latest cycle summary. Read-only.
---

Read-only. Do not modify any file.

1. Read `factory/state.json` and `factory/backlog.json`.
2. Find the newest `factory/runs/cycle-*/` folder and read its `summary.md` (or list its reports
   if there is no summary yet — that means a cycle is in progress or was interrupted).
3. Run `git branch --show-current`, `git log --oneline -5`, `git tag --sort=-v:refname | head -3`,
   and if a remote exists `gh pr list --label ai-factory`.
4. Print:
   - Status / cycle / phase / current item / branch / last release
   - Backlog: counts by status, and the next 5 `todo` items by priority
   - Latest cycle: phase-by-phase table
   - Anything abnormal (dirty tree, open factory PRs, STOP file present, halted reason).
