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
The plugin is wired and active. At startup Kilo calls its `config` hook (`runConfigHook`), which
resolves the settings, fetches the shared `kilo.jsonc` from Azure DevOps, validates it, caches it,
falls back to the cache when the fetch fails, merges it into Kilo's config, and logs fixed
messages. It never throws: on any failure Kilo continues with your local config. The macOS/Linux
installer (`backend/installer/install.sh`, F-010) and the Windows installer
(`backend/installer/install.ps1`, F-011) set up an engineer's machine. Key provisioning is out of
scope for the installers.

### Features shipped so far
- `backend/plugin/azdo-remote-config.ts`: the plugin (Kilo v1 module shape, supported Kilo range `>=7.2.0 <8.0.0`). Its `config` hook loads and merges the shared config; `server` itself does no I/O.
- Settings: the 8 plugin settings (`org`, `project`, `repo`, `path`, `branch`, `mode`, `pat`, `timeoutMs`) come from the global plugin options, then `KILO_AZDO_*` environment variables, then defaults. Project-level configs are not a settings source (trust boundary, ADR-0009).
- Fetch: one HTTPS GET to the Azure DevOps Items API using a PAT (plugin option or `KILO_AZDO_PAT`, `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`) or an `az` Entra token, with a timeout and a 1 MiB response cap.
- Cache and fallback: a validated fetch is written to `~/.cache/kilo-azdo/remote-config.json` (file mode 0600, atomic write). If the fetch fails, the validated cache is used instead.
- Parsing and placeholders: JSONC (comments, trailing commas); `{env:NAME}` and `{file:path}` placeholders are resolved at merge time and never stored in the cache.
- Merge: `defaults` or `enforce` mode, never overwriting a local `apiKey` and never applying a shared one; transactional, so Kilo's config is either unchanged or fully merged.
- Logging: fixed messages with service `azdo-remote-config` via Kilo's logger; never values, URLs or secrets. See the [user guide](docs/user-guide.md#troubleshooting-log-messages).
- Internal helpers (`parseJsonc`, `resolvePlaceholders`, `mergeConfig`, `resolveSettings`, `fetchRemoteConfig`, `runConfigHook`) are reachable via `__internals` for tests. See [API](docs/api.md).
- Shared config validator: `node backend/validator/validate-kilo-config.ts [--allowed-hosts <list>] <file>...` checks a `kilo.jsonc` for secrets, `apiKey`, wrong types, unsafe keys and (optionally) allowed gateway hosts. Exit codes 0 (ok), 1 (errors found), 2 (usage/I/O/internal). See the [user guide](docs/user-guide.md#validating-the-shared-config-platform-engineers).
- Example shared config: `backend/shared-config/kilo.jsonc` (Bifrost provider, no `apiKey`).
- Shared config repo template (F-008): `node backend/tools/assemble-shared-repo.ts <outdir>` builds the repo tree (9 files: pipeline, branch-policy script, validator, plugin, example config). `azure-pipelines.yml` is a PR gate that runs the validator with `KILO_ALLOWED_HOSTS` (set it as a pipeline variable; the gate fails closed without it). `set-branch-policies.sh` creates the approver-count, required-reviewer and build-validation policies on `main` through `az` (`--dry-run` previews). These are templates and tools only: this repo does not create the Azure DevOps repo, pipeline or policies. Setup steps and a caveat that a PR can change its own gate: [user guide](docs/user-guide.md#setting-up-the-shared-config-repo-platform-engineers).
- Personal config template: `backend/personal-config/kilo.jsonc`, the engineer's own config. It has one plugin entry (`org`, `project`, `repo`, `path`, `branch`, `mode`; no `pat`) and a `provider.bifrost.options.apiKey` placeholder (`sk-bf-<your-virtual-key>`). Copy it to `~/.config/kilo/kilo.jsonc` only, never into a project directory. See the [user guide](docs/user-guide.md#personal-config-template-engineers). `install.sh` automates the copy on macOS/Linux (below); `install.ps1` does it on Windows.
- Bootstrap installer for macOS/Linux: `bash backend/installer/install.sh --org <org> --project <project> --repo <repo>` copies the plugin to `~/.config/kilo/azdo/` and creates or updates `~/.config/kilo/kilo.jsonc` (mode 0600). Idempotent; set `KILO_BIFROST_KEY` to write your virtual key. Exit codes 0/1/2/3/4. After installing it runs a smoke test (Azure DevOps shared-config fetch, then Bifrost `GET <baseURL>/models`); exit 4 means installed but the smoke test failed; `--no-smoke` skips it. See the [user guide](docs/user-guide.md#installing-on-macos-and-linux-engineers).
- Bootstrap installer for Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File backend\installer\install.ps1 -Org <org> -Project <project> -Repo <repo>` (Windows PowerShell 5.1 or PowerShell 7+). A thin front end over the same Node helper as `install.sh`: same files (in `%USERPROFILE%\.config\kilo`), same exit codes 0-4, same smoke test (`-NoSmoke` skips it). The key is read only from `KILO_BIFROST_KEY`. Run it from a repository checkout. See the [user guide](docs/user-guide.md#installing-on-windows-engineers).
- Lint that enforces the FR-11 constraints (single file, zero npm runtime dependencies).
- Strict TypeScript type-check and a `node:test` test suite.
- One quality gate, `scripts/ci.sh`, used locally and in GitHub Actions.
- End-to-end startup test (F-014, test only): `cd backend && node --test test/e2e/startup.test.ts` installs into a temp HOME and simulates Kilo's startup against a fake network. It needs bash. It does not test real Kilo, Azure DevOps or Bifrost.

### Still manual (Phase 0)
The simulated startup test does not prove vision AC-1. These checks stay manual: Kilo CLI `/models` and the VS Code model list against real Azure DevOps and Bifrost; Kilo's own loading of the `.ts` plugin and path resolution; a disabled key rejected at request time. See the [platform runbook](docs/platform-runbook.md#phase-0-verification-checklist) and [development](docs/development.md#what-stays-manual-phase-0).


### Quick start
Prerequisite: Node.js 22.18 or newer (native TypeScript support). There is no frontend, no server and no Docker step.

```bash
cd backend
npm ci              # install dev dependencies (typescript, @types/node)
npm run lint        # FR-11 guard rails
npm run typecheck   # tsc --noEmit
npm test            # node --test (includes validator tests)
cd .. && bash scripts/ci.sh   # the full gate, as CI runs it
```

More: [engineer setup](docs/engineer-setup.md), [platform runbook](docs/platform-runbook.md), [troubleshooting](docs/troubleshooting.md), [user guide](docs/user-guide.md), [API](docs/api.md), [development](docs/development.md).

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
