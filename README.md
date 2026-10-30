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

## The product: Zühlke Car Finder

The factory builds the product under `backend/` (Node 22, Express, TypeScript) and `frontend/`
(React, Vite, TypeScript). See [`docs/architecture/ADR-0001-tech-stack.md`](docs/architecture/ADR-0001-tech-stack.md).

### Features shipped so far
- `GET /api/health` liveness endpoint and a uniform JSON error envelope ([API reference](docs/api.md)).
- Sign-up and login with email and password: register, log in, log out, with a server-side session in an HttpOnly cookie ([user guide](docs/user-guide.md), [API](docs/api.md)).
- Security hardening: rate limiting on login/register (per IP and per email, `429` + `Retry-After`), security headers on API and UI, CORS closed by default with an exact-origin allow-list, backend port bound to localhost only (configuration in [development](docs/development.md)).
- Web shell showing the product name and whether the API is online or offline.
- Single-command local run with Docker Compose, configuration through environment variables.
- One quality gate, `scripts/ci.sh`, used locally and in GitHub Actions.

### Quick start
Prerequisites: Node.js 22.13+ and Docker.

```bash
docker compose up --build     # UI http://localhost:8080, API http://localhost:3000/api/health
bash scripts/ci.sh            # lint, typecheck, test and build both packages
```

If port 8080 or 3000 is busy, set `FRONTEND_PORT` / `BACKEND_PORT`, for example
`FRONTEND_PORT=18080 BACKEND_PORT=13000 docker compose up --build`.

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
