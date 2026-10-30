# AI Factory

An autonomous SDLC pipeline built on Claude Code subagents. You write one file,
[`factory/VISION.md`](factory/VISION.md). The factory then plans, designs, builds, secures,
reviews, documents and releases the product, one backlog item per cycle, with no human in the loop.

```
 ┌────────── next cycle ───────────────────────────────────────────────────────────┐
 ▼                                                                                 │
 PO ─► Architect ─► Senior BE ┐                                                    │
                    Senior FE ┴─► Security ─► Code Review ─► PR ─► Docs ─► CI/Release
                        ▲            │ FAIL       │ FAIL
                        └────────────┴────────────┘  rework (max 3), then abandon → PO re-plans
```

| Agent | File | Gate? | Writes |
|-------|------|-------|--------|
| Product Owner | `.claude/agents/product-owner.md` | decides DONE | `factory/backlog.json` |
| Architect | `.claude/agents/architect.md` | | `docs/architecture/**` (ADRs, API contracts) |
| Senior Backend | `.claude/agents/senior-backend.md` | | `backend/**` |
| Senior Frontend | `.claude/agents/senior-frontend.md` | | `frontend/**` |
| Security Engineer | `.claude/agents/security-engineer.md` | ✅ PASS/FAIL | report only |
| Code Reviewer | `.claude/agents/code-reviewer.md` | ✅ PASS/FAIL | report only |
| PR Manager | `.claude/agents/pr-manager.md` | | branch push, PR |
| Docs Writer | `.claude/agents/docs-writer.md` | | `README.md`, `docs/**` |
| CI / Releaser | `.claude/agents/ci-releaser.md` | ✅ CI green | `scripts/ci.sh`, workflows, `VERSION`, `CHANGELOG.md`, tags |

The **orchestrator** is the `/factory-cycle` skill (`.claude/skills/factory-cycle/SKILL.md`).
It runs in the main Claude Code session because subagents cannot spawn other subagents. It
dispatches each agent, parses its `FACTORY_RESULT` block, commits between phases, routes
findings back to the owning engineer, and updates `factory/state.json`.
Every agent writes an audit report to `factory/runs/cycle-NNNN/`.

## The product: Kilo azdo-remote-config

Kilo (CLI and VS Code extension) has no built-in way to load configuration from a remote source.
This product is a Kilo plugin, `azdo-remote-config`, that loads one shared, PR-reviewed
`kilo.jsonc` from Azure DevOps at startup and merges it into Kilo's config, so every engineer runs
the same models, agents and settings while authenticating to the model gateway with their own key.
The full vision is in [`factory/VISION.md`](factory/VISION.md); the stack is recorded in
[`docs/architecture/ADR-0001-tech-stack.md`](docs/architecture/ADR-0001-tech-stack.md).

### Status
The project skeleton (T-001), an internal JSONC parser (F-001) and an internal placeholder resolver
(F-002) are shipped. The plugin is still a no-op at runtime: it loads, exposes a `config` hook that
changes nothing, and does no I/O. The parser and resolver exist (as `__internals.parseJsonc` and
`__internals.resolvePlaceholders`) but are not yet used by the hook. Fetching, auth, merging,
caching, the validator, installers and key provisioning are planned and not yet built.

### Features shipped so far
- `backend/plugin/azdo-remote-config.ts`: stub plugin (Kilo v1 module shape, supported Kilo range `>=7.2.0 <8.0.0`).
- `parseJsonc`: zero-dependency JSONC parser (comments, trailing commas) with input-free error messages. Internal only, reachable via `__internals`; not yet wired into the `config` hook.
- `resolvePlaceholders`: resolves `{env:NAME}` and `{file:path}` placeholders in a parsed config. Internal only, reachable via `__internals`; not yet wired into the `config` hook. See [API](docs/api.md).
- Lint that enforces the FR-11 constraints (single file, zero npm runtime dependencies).
- Strict TypeScript type-check and a `node:test` test suite.
- One quality gate, `scripts/ci.sh`, used locally and in GitHub Actions.

### Quick start
Prerequisite: Node.js 22.18 or newer (native TypeScript support). There is no frontend, no server and no Docker step.

```bash
cd backend
npm ci              # install dev dependencies (typescript, @types/node)
npm run lint        # FR-11 guard rails
npm run typecheck   # tsc --noEmit
npm test            # node --test
cd .. && bash scripts/ci.sh   # the full gate, as CI runs it
```

More: [user guide](docs/user-guide.md), [API](docs/api.md), [development](docs/development.md).

## Factory quick start (local)

1. Edit `factory/VISION.md` with your product, and **delete the `VISION_TEMPLATE_UNCHANGED` line**.
2. (Optional, for PRs and releases) create a GitHub repo and connect it:
   `gh repo create <name> --private --source . --push`. Without a remote the factory runs in
   **local mode**: it squash-merges and tags locally.
3. Run the loop:
   ```bash
   bash scripts/factory-loop.sh                  # Git Bash / Linux / macOS
   pwsh scripts/factory-loop.ps1 -MaxCycles 5    # Windows PowerShell
   ```
   Or interactively inside Claude Code: `/factory-cycle` (one cycle) or `/loop /factory-cycle`.
4. Check progress at any time with `/factory-status`.

### Controls

| Want to… | Do |
|----------|----|
| Stop after the current cycle | create an empty `factory/STOP` file |
| Resume after a halt | set `"status": "running"` in `factory/state.json` (and fix the cause) |
| Cap total cycles | `max_cycles` in `factory/state.json` |
| Cap rework rounds | `max_rework` in `factory/state.json` |
| Cycles per loop invocation | `FACTORY_MAX_CYCLES` env / `-MaxCycles` |
| Full tool access (sandbox only) | `FACTORY_PERMISSION_MODE=bypassPermissions` |

Locally the loop uses `acceptEdits` plus the allowlist and denylist in `.claude/settings.json`.
The denylist blocks force pushes, direct pushes to `main`, and reads of `.env` and key files.
Use `bypassPermissions` only in a disposable container, VM or CI runner.

## Fully hosted (GitHub Actions)

`.github/workflows/ai-factory.yml` runs the loop every 6 hours, or on demand from the Actions tab.
1. Add the secrets `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) and `FACTORY_GH_TOKEN`.
   `FACTORY_GH_TOKEN` is a fine-grained PAT with read/write on contents, pull requests, issues
   and workflows. Without the PAT, factory PRs and tags would not trigger CI or Release.
2. In the repo settings, allow squash merging. Optionally protect `main` and require the `CI` checks.

Workflows:
- `ci.yml`: runs `scripts/ci.sh` (install, lint, test, build) plus a gitleaks secret scan on every PR and on `main`.
- `release.yml`: on a `v*.*.*` tag it re-verifies and attaches build outputs to the GitHub Release.
- `ai-factory.yml`: the autonomous loop.

## How a cycle works

1. **Preflight**: bootstrap the repo, check the stop conditions, sync `main`, and retry any
   open factory PRs left over from an interrupted cycle.
2. **PO**: grooms the backlog from the vision and from earlier follow-ups, then picks one item.
   On cycle 1 that item is always "Project skeleton & CI".
3. **Architect**: writes the design, the API contract and ADRs. In cycle 1 it also picks the tech stack (ADR-0001).
4. **BE and FE in parallel**: implement against the contract, with tests.
5. **Security gate**, then the **review gate**. Each FAIL sends findings back to the owning
   engineer, and both gates re-run on the new diff.
6. **PR**: push the branch and open the PR. **Docs** are committed onto the same PR.
7. **Release prepare**: run local CI, bump the version and changelog, and commit the records.
   **Ship**: wait for green checks, squash-merge, tag and create the GitHub Release.
8. If rework fails 3 times, the item is marked `blocked` and the PO splits it next cycle.
   After 3 blocked cycles in a row the factory halts.
