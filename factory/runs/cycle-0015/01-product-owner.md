# Product Owner report — cycle 0015 — F-008: Shared config repo: Azure Pipelines PR gate and branch policy setup

## Inputs read
- factory/VISION.md (FR-12..FR-15, AC-13, components C1/C5)
- factory/backlog.json, factory/state.json (last release v0.11.0, cycle 14 shipped F-011)
- CHANGELOG.md, factory/runs/cycle-0014/summary.md, 02-architect.md, 04-security.md, 05-review.md, 07-docs.md, 08-release-prepare.md
- docs/architecture/ADR-0010-shared-config-validator.md, contracts/validator-cli.md, backend/shared-config/kilo.jsonc, backend/package.json

## Work done
- Vision check: vision defined (no template marker).
- User decision honoured: F-012 / F-013 remain `blocked` with the "SKIPPED by user instruction" note; not selected, split or unblocked; no new key-provisioning items created.
- Cycle 0014 follow-ups: already captured by the orchestrator as T-021 (contract 10.1 wording, overview.md NUL bytes) and T-022 (install.ps1 `%`/.cmd shim, test nits, child-env key stripping, Windows ACL hardening, Windows CI job), plus the F-016 docs note. No high/critical security findings (cycle 0014: 1 low, 3 info), so no security item jumps the queue.
- Re-prioritised F-008 from 3 to 2: it is the next item on the critical path (C1 PR gate, FR-13/FR-14, AC-13) and F-015 depends on it. Remaining vision work: F-008, F-014 (e2e simulated test), F-015 (per-team configs, depends on F-008), F-016 (docs). Not DONE.
- Rewrote F-008: concrete deliverables, locations, pipeline/validator packaging decision delegated to the Architect (with a PO suggestion), 8 Given/When/Then ACs, set status `in_progress`.
- Split policy idempotency out of F-008 into new T-023 (priority 4).
- Added a note to F-016 that the platform runbook should cover the C1 repo, pipeline and branch-policy script.

Selected item:

```json
{
  "id": "F-008",
  "title": "Shared config repo: Azure Pipelines PR gate and branch policy setup",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-007"
  ],
  "description": "FR-13 / FR-14 / AC-13, C1 (shared config repo). Cycle 0015 PO: priority raised to 2 (critical path; F-015 depends on it). Two deliverables under backend/shared-config/ (the template of the C1 `kilo-config` repo; Architect fixes exact file names and records them in an ADR + contract, e.g. a new contracts/shared-config-repo.md): (a) `azure-pipelines.yml`, the PR validation pipeline: `trigger: none` (or main only), `pr` on branch main, installs/uses Node >= 22.18 (e.g. UseNode@1 / NodeTool@0, no npm install, zero runtime deps), and runs the F-007 validator CLI with `--allowed-hosts <host list>` (host list from a pipeline variable with a documented default; cycle 0009: host check is opt-in and ignores ports) over `kilo.jsonc` plus every `teams/*/kilo.jsonc` that exists (no teams directory, or an empty one, must not cause a usage error/exit 2); a non-zero validator exit fails the job. The validator needs `validator/` and `plugin/azdo-remote-config.ts` in the same relative layout plus a package.json with \"type\": \"module\" (ADR-0010): the Architect decides how C1 gets them (PO suggestion: a zero-dependency assemble/export script, e.g. `node backend/tools/assemble-shared-repo.ts <outdir>`, that writes the complete C1 repo tree: kilo.jsonc, azure-pipelines.yml, the policy script, the validator files, the plugin file and package.json, byte-identical copies, refusing a non-empty outdir) so the pipeline's exact command line is testable end to end. (b) A branch-policy script for the platform team (Architect picks bash or a zero-dependency Node .ts; it must run on macOS/Linux and Git Bash) that applies FR-14 to `main` with `az repos policy`: approver-count (minimum 1 reviewer, blocking), required-reviewer for the platform-team group, and build validation bound to the pipeline's build definition id (blocking). Inputs: org (URL or name), project, repository id or name, reviewer group id/descriptor, build definition id, all REQUIRED as flags; `--dry-run` prints the exact az commands without invoking az. It never takes a PAT/token as an argument (az login or AZURE_DEVOPS_EXT_PAT env only), never echoes env values, and passes each value as a single argv element (no eval / shell interpolation). PO decision: idempotency (detecting existing policies) is out of scope for this slice; the usage text states that re-running creates duplicate policies. Tests (node:test under backend/test/) inspect the YAML as text or with a tiny dev-only parser, run the pipeline's validator command in a temp copy/assembled tree, and run the policy script in child processes with a stub `az` on PATH that records argv; they never call real az, Azure DevOps or the network. The plugin file, its export surface, the validator rules/CLI behaviour, the installers and the personal config template are unchanged. Zero runtime npm deps (FR-11). Out of scope: per-team example files and team-specific validation behaviour (F-015).",
  "acceptance_criteria": [
    "Given backend/shared-config/azure-pipelines.yml, When a test inspects it, Then it has a `pr` trigger including branch `main`, CI-push triggering is disabled or limited to main, it selects Node 22.18 or later, contains no `npm install`/`npm ci` step, and has a script step that invokes the validator CLI (`validate-kilo-config.ts`) with `--allowed-hosts` and the files `kilo.jsonc` and `teams/*/kilo.jsonc`.",
    "Given the C1 repo tree in a temp directory (as assembled by the Architect's chosen mechanism) containing the example kilo.jsonc and no teams directory, When the pipeline's validator script step is executed in bash from the repo root with the default allowed-hosts value, Then it exits 0; and Given a `teams/payments/kilo.jsonc` that is valid, Then it exits 0 and the output reports both files.",
    "Given the same temp C1 tree, When kilo.jsonc (or teams/x/kilo.jsonc) gains an `apiKey` field, an `sk-bf-AbCdEf1234567890` string, or a baseURL on a host not in the allowed-hosts list, When the pipeline's validator script step runs, Then it exits non-zero (failing the PR, AC-13) and the output never contains `AbCdEf1234567890`.",
    "Given the C1 tree, When it is inspected, Then validator/validate-kilo-config.ts, validator/kilo-config-rules.ts, validator/kilo-schema-subset.json and plugin/azdo-remote-config.ts are byte-identical to the backend/ sources and their relative layout matches backend/, and a package.json with `\"type\": \"module\"` and no `dependencies` is present.",
    "Given the branch-policy script with all required inputs and `--dry-run`, When executed with a stub az on PATH, Then it exits 0, the stub az is never invoked, and stdout lists exactly three `az repos policy` commands: `approver-count create` with `--minimum-approver-count 1` and `--blocking true`, `required-reviewer create` naming the supplied reviewer group, and `build create` naming the supplied build definition id with `--blocking true`, each scoped to `--branch main` and the supplied repository, org and project.",
    "Given the branch-policy script without `--dry-run`, When executed with a recording stub az, Then az is invoked exactly three times with the same arguments as the dry-run output (each value as one argv element, so a value like `team; rm -rf x` or `$(id)` is passed literally and nothing else is executed), and Given the stub az fails on any call, Then the script stops at that call and exits non-zero with a fixed message naming the failing policy, without echoing az's output.",
    "Given the branch-policy script with any required input missing, an empty value, an unknown flag, or a positional argument, When executed, Then it exits 2 with usage help that does not echo the offending value, and az is never invoked; and Given AZURE_DEVOPS_EXT_PAT set to a sentinel value on any path, Then the sentinel appears in no stdout/stderr, and the script accepts no flag for a PAT or token.",
    "Given the repository after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0 and runs the new pipeline and policy-script tests, backend/package.json has no runtime `dependencies`, backend/plugin/azdo-remote-config.ts, backend/validator/*, backend/personal-config/kilo.jsonc and backend/installer/* are unchanged, and docs/architecture documents the C1 repo layout, the pipeline and the policy script's flags and exit codes."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json` — F-008 groomed and set `in_progress` (priority 2); T-023 added; F-016 description note.
- `factory/runs/cycle-0015/01-product-owner.md` — this report.

## Verification
- `node -e` parse of factory/backlog.json: valid JSON, F-008 `in_progress` with 8 ACs, it is the only `in_progress` item.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- The C1 repo is delivered as a template under backend/shared-config/ (plus a way to assemble a complete repo tree), not as a real Azure DevOps repo — the factory cannot create remote resources; tests run the pipeline command locally.
- The pipeline needs the validator and plugin files in C1 (ADR-0010); how they get there (assemble script vs. other) is an Architect decision, but the exact pipeline command must be testable end to end.
- Branch-policy script targets platform-team machines (macOS/Linux/Git Bash); no PowerShell variant in this slice.
- Required-reviewer group is supplied by id/descriptor; the script does not resolve group names (avoids extra az calls/ambiguity).
- Re-running the policy script creating duplicates is acceptable for this slice if documented in usage (T-023 follows up).
- "PR required" on main is satisfied by having blocking policies on the branch; no separate command.

## Follow-ups for the backlog
- T-023 (added): branch-policy script idempotency.
- After F-008: F-015 (per-team files) becomes eligible; then F-014 and F-016.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0015/01-product-owner.md
summary: Selected F-008 (Azure Pipelines PR gate + branch-policy script for the C1 repo), priority 2, 8 ACs; F-012/F-013 remain skipped.
