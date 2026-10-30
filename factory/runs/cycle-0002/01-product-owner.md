# Product Owner report — cycle 0002 — T-001: Project skeleton & CI

## Inputs read
- `factory/VISION.md` (Kilo Shared Config, defined; no template marker)
- `factory/backlog.json` (empty, schema only)
- `factory/state.json` (cycle 2, empty history, last_release v0.0.0)
- `CHANGELOG.md` (absent), `factory/runs/` (no previous reports)
- `scripts/ci.sh`, `.github/workflows/`, `docs/architecture/` (no ADR-0001 yet)

## Work done
- First grooming: broke the vision into 17 vertically sliced items (T-001, F-001..F-016) that cover components C1, C2, C3, C5 and C6, FR-1..FR-27 and AC-1..AC-14 (AC-1/2/10/11 covered as simulated tests, since real Bifrost/AzDO/Kilo are out of reach in CI).
- Priorities: P1 = skeleton plus pure plugin core (JSONC parser, placeholders, merge); P2 = settings, fetch/auth, cache/logging wiring, validator, personal template; P3 = pipeline/branch policy, installers, key provisioning, E2E, docs; P4 = per-team files (FR-15, marked optional in the vision).
- Selected **T-001** and set it to `in_progress`.

Selected item:

```json
{
  "id": "T-001",
  "title": "Project skeleton & CI",
  "type": "chore",
  "priority": 1,
  "status": "in_progress",
  "scope": { "backend": true, "frontend": false },
  "depends_on": [],
  "description": "Architect picks the stack (expected: TypeScript, zero runtime deps, built-in or dev-only test runner) and records it in ADR-0001, including the supported Kilo version range and the layout under backend/ (plugin single file, validation tooling, installers, provisioning). Senior BE creates a minimal plugin stub and one smoke test. CI releaser wires scripts/ci.sh and GitHub Actions to a green pipeline.",
  "acceptance_criteria": [
    "Given a clean checkout, When `bash scripts/ci.sh` is run, Then it exits 0 and the output shows the backend package's type-check and test steps were executed (not the 'no packages yet' path).",
    "Given the repository, When docs/architecture/ADR-0001-tech-stack.md is read by an automated check, Then the file exists and contains sections for language/runtime, test runner, supported Kilo version range, and the zero-runtime-dependency single-file plugin constraint (FR-11).",
    "Given the backend package, When the test suite runs, Then a smoke test imports the single plugin source file (e.g. backend/plugin/azdo-remote-config.ts) and asserts it exports a plugin function that, when invoked with a minimal fake Kilo context, returns an object exposing a `config` hook.",
    "Given backend/package.json, When an automated check inspects it, Then the `dependencies` field is absent or empty (only devDependencies are allowed).",
    "Given a push or pull request to main, When the GitHub Actions CI workflow runs, Then it executes `bash scripts/ci.sh` (verifiable by a check that .github/workflows/ci.yml invokes scripts/ci.sh).",
    "Given the plugin stub, When its `config` hook is invoked with a config object, Then it resolves without throwing and leaves the object unchanged (no-op until F-features land)."
  ],
  "source": "po",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json` — initial backlog (17 items), T-001 set to in_progress.
- `factory/runs/cycle-0002/01-product-owner.md` — this report.

## Verification
- `node -e 'JSON.parse(...backlog.json)'` → ok (valid JSON, as required by `scripts/ci.sh`).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | factory/VISION.md §13 | The "attached" reference implementation `azdo-remote-config.ts` is not in the repo. | None; plugin is built from FR-1..FR-11 across F-001..F-006. |

## Assumptions made (no human available)
- No UI exists in this product: every item is `scope.backend = true`, `scope.frontend = false`. The plugin, validator, installers and provisioning tooling all live under `backend/` (exact layout chosen by the Architect).
- Testing never touches real Azure DevOps, `az`, Bifrost or Kilo; these are injected/faked. Vision ACs that need real infrastructure (AC-1, AC-2, AC-10, AC-11) are covered by simulated tests (F-014, F-013) and Phase 0 manual checks recorded in docs (F-016).
- FR-11 (single file, zero deps) applies to the shipped plugin only; dev-only tooling (type-checker, test runner) is allowed.
- Open questions from the vision §12 resolved conservatively for now: default mode `defaults`; key sent as `Authorization: Bearer`; secure key delivery modelled as a 0600 per-engineer file or pluggable hook (F-012); per-team files deferred to P4.
- Cycle 0002 is the first cycle with a backlog (state history empty), so first-cycle rules apply.

## Follow-ups for the backlog
- None yet (no previous cycle reports).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0002/01-product-owner.md
summary: Groomed initial backlog (17 items) from vision; selected T-001 Project skeleton & CI (backend only).
