---
name: factory-cycle
description: Run ONE full autonomous AI Factory SDLC cycle (PO -> Architect -> BE||FE -> Security -> Code Review -> PR -> Docs -> CI/Release) using the project subagents, with automatic rework loops and no human in the loop. Use when asked to run the factory, run a cycle, or via scripts/factory-loop.*.
---

# AI Factory — one cycle

You are the **orchestrator**. You never write product code yourself. You dispatch subagents with
the **Agent tool** (`subagent_type` = the agent name), read their `FACTORY_RESULT` blocks, commit
between phases, route failures back for rework, and keep `factory/state.json` accurate.

**Nobody is watching. Never ask the user anything. Never stop to confirm.** If something is
ambiguous, decide conservatively, note it in `summary.md`, and continue.

Shell: use the Bash tool (POSIX syntax) for git/gh commands.

## Parsing results
Every subagent reply ends with:
```
FACTORY_RESULT
status: PASS | FAIL | BLOCKED | DONE
report: <path>
summary: <text>
```
If the block is missing, treat the result as `FAIL` and re-dispatch the same agent once with
"Your previous reply had no FACTORY_RESULT block; finish the task and end with it."

## Every subagent prompt must contain
- `cycle: NNNN`, `run folder: factory/runs/cycle-NNNN`, `branch: <branch>`
- the selected item JSON (after the PO phase)
- the exact report file name to write
- for rework: the verbatim findings rows assigned to that agent and the rework iteration number

## Procedure: "record on main"
Used when the cycle ends without a normal release (DONE, BLOCKED, abandoned) so bookkeeping
still reaches `main`:
- **Local mode** (no `origin` remote or `gh auth status` fails): commit `factory/` changes
  directly on `main` with `chore(factory): cycle NNNN records`.
- **Remote mode**: `git checkout -b factory/records-cycle-NNNN`, commit `factory/` only, push,
  `gh pr create --base main --title "chore(factory): cycle NNNN records" --body "Factory bookkeeping" --label ai-factory`,
  then `gh pr merge --squash --delete-branch --auto` (fall back to an immediate
  `gh pr merge --squash --delete-branch` if auto-merge is not enabled), and return to `main`.

---

## Phase 0 — Preflight
1. Run `bash scripts/bootstrap.sh` (idempotent: git init, initial commit, labels).
2. Read `factory/state.json`. Stop immediately (print why) if:
   - `status` is not `running`, or
   - `factory/STOP` exists, or
   - `cycle >= max_cycles` → set `status: "halted"`, record on main, stop.
3. `git checkout main`. If the tree is dirty: if only `factory/` files changed, they are
   records from an interrupted cycle — keep them (they will ride along on this cycle's branch);
   otherwise `git stash push -u -m "factory: interrupted cycle"` and note it in the summary.
4. Remote mode: `git fetch origin && git pull --ff-only origin main`.
5. **Recovery** (remote mode): `gh pr list --label ai-factory --state open --json number,headRefName,title`.
   For each open PR whose branch is not `factory/records-*`, dispatch `ci-releaser` with
   `mode: recover <number>`. On FAIL: comment the failure on the PR, close it
   (`gh pr close <n> --delete-branch`), and set that item back to `todo` with a note in
   `factory/backlog.json` (it will be committed with this cycle). Return to `main` afterwards.

## Phase 1 — Product Owner
1. `N = state.cycle + 1`, zero-padded to 4 digits. Create `factory/runs/cycle-NNNN/`.
   Update state: `cycle: N`, `phase: "po"`, `rework_iteration: 0`.
2. Dispatch **product-owner**.
   - `DONE` → set `status: "done"`, `phase: "idle"`, record on main, print the final summary, stop.
   - `BLOCKED` → set `status: "halted"`, record on main, stop.
   - `PASS` → read the selected item from `factory/backlog.json` (status `in_progress`).
3. Branch: `git checkout -b factory/<item-id>-<slug>` (slug: lowercase title, hyphens, ≤ 40 chars).
   Update state: `current_item`, `branch`, `phase: "architect"`.
   Commit: `git add -A && git commit -m "chore(factory): cycle NNNN plan <item-id>"`.

## Phase 2 — Architect
Dispatch **architect**. `FAIL`/`BLOCKED` → go to **Abandon**.
Commit: `docs(architecture): design for <item-id>`. State `phase: "implement"`.

## Phase 3 — Implement (parallel)
Dispatch **senior-backend** (if `scope.backend`) and **senior-frontend** (if `scope.frontend`)
**in the same message** so they run concurrently. Give each only its own task list from
`02-architect.md`.
- An engineer returns `FAIL` → re-dispatch that engineer once with its own failure output
  (counts as a rework iteration). Still failing → **Abandon**.
Commit: `feat(<item-id>): <item title>` (use `fix`/`chore` for those item types).
State `phase: "security"`.

## Phase 4 — Gates with rework loop
```
loop:
  dispatch security-engineer          -> 04-security.md
  if FAIL: rework(security findings); continue loop
  dispatch code-reviewer               -> 05-review.md
  if FAIL: rework(review findings);   continue loop   # security re-checks the new diff too
  break
```
**rework(findings)**:
1. `rework_iteration += 1`. If it exceeds `max_rework` → **Abandon**.
2. Split findings by owner (`backend/…` paths → senior-backend, `frontend/…` → senior-frontend;
   reviewer findings carry an owner column). Dispatch the owning engineers in parallel with
   their findings rows and "Rework iteration K".
3. Commit `fix(<item-id>): address <security|review> findings (rework K)`.

State `phase: "pr"` once both gates PASS.

## Phase 5 — Pull request
Dispatch **pr-manager**. Capture `pr:` (URL, number or `local`) and the mode.
`FAIL` → retry once; still failing → **Abandon**. State `phase: "docs"`.

## Phase 6 — Docs
Dispatch **docs-writer**. `FAIL` → retry once; still failing → continue anyway and add a
backlog follow-up "Docs for <item-id>" (docs must not block a working release).
State `phase: "release"`.

## Phase 7 — Release
1. Dispatch **ci-releaser** with `mode: prepare`.
   - `FAIL` in product code → rework(CI failure output) (Phase 4 rules: re-run security +
     review after the fix), then prepare again.
2. **Bookkeeping on the branch** (so it reaches `main` through the PR):
   - `factory/backlog.json`: item `status: "done"`, `cycle_done: N`; add every
     "Follow-ups for the backlog" bullet from all reports as new `todo` items
     (`source` = the reporting role, sensible priority, no duplicates).
   - `factory/state.json`: `phase: "idle"`, `current_item: null`, `branch: null`,
     `rework_iteration: 0`, `consecutive_blocked: 0`, `last_release: "vX.Y.Z"`, and append to
     `history`: `{ "cycle": N, "item": "<id>", "result": "released", "version": "vX.Y.Z", "rework": K }`.
   - Write `factory/runs/cycle-NNNN/summary.md` (one table: phase, agent, status, summary).
   - Commit `chore(factory): cycle NNNN records`.
3. Dispatch **ci-releaser** with `mode: ship` (pass PR reference and mode).
   - `FAIL` because of red remote checks → rework(failure logs), push, ship again (counts
     toward `max_rework`). Rework limit hit → leave the PR open (Phase 0 recovery retries it
     next cycle), return to `main`, stop the cycle.
4. Confirm you are on a clean `main`. Print the cycle summary table.

## Abandon
1. Write `factory/runs/cycle-NNNN/summary.md` explaining where and why it failed.
2. `git checkout main` and delete the cycle branch locally (`git branch -D`); if it was pushed,
   close its PR with a comment and delete the remote branch.
3. In `factory/backlog.json` set the item to `blocked` with a `notes` entry pointing at the
   run folder (the PO will split it next cycle). In `factory/state.json`: `phase: "idle"`,
   `current_item: null`, `branch: null`, `consecutive_blocked += 1`, append
   `{ "cycle": N, "item": "<id>", "result": "abandoned", "phase": "<phase>" }` to history.
   If `consecutive_blocked >= max_consecutive_blocked` set `status: "halted"`.
4. Record on main. Stop the cycle.

## Output
Finish with a short table of phases → status, the version shipped (or why not), and the
next state (`running` / `done` / `halted`).
