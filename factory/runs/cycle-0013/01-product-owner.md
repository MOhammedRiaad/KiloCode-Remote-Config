# Product Owner report — cycle 0013 — F-019: Bootstrap installer smoke test (install.sh)

## Inputs read
- factory/VISION.md (FR-18..FR-23, AC-10, Appendix A/B)
- factory/backlog.json (all items)
- factory/runs/cycle-0011/summary.md, 02-architect.md (F-019 hand-off note), cycle-0012/summary.md (F-012/F-013 skipped by user)
- docs/architecture/contracts/installer-cli.md (exit codes 0-3, KILO_BIFROST_KEY rules, "F-019 out of scope" note)
- Orchestrator instruction for cycle 0013 (user decision: key provisioning skipped)

## Work done
- Vision check: VISION.md is defined (no template marker).
- Grooming:
  - F-012 / F-013 left `blocked` with their "SKIPPED by user instruction" notes; not selected, split or unblocked. No new key-provisioning items created.
  - F-016 already depends only on F-010 (F-013 dependency waived, provisioning/offboarding runbook content omitted) — unchanged.
  - Cycle 0011 follow-ups are already captured in T-019 (installer hardening, priority 3); no new security items of high/critical severity exist, so nothing pre-empts the critical path.
  - No item has failed in 2+ cycles; nothing to mark blocked or split.
  - Remaining critical path after F-019: F-008 (pipeline/branch policy, p3), F-011 (Windows installer, depends on F-019), F-014 (e2e, depends on F-019), F-016 (docs). F-019 is the only priority-2 todo with all dependencies done, and it unblocks F-011 and F-014.
- Selected **F-019** and set it to `in_progress`. Rewrote its description and expanded the acceptance criteria from 3 to 8 automated, Given/When/Then criteria. Scope: backend true, frontend false.

Selected item (copy verbatim):

```json
{
  "id": "F-019",
  "title": "Bootstrap installer smoke test (install.sh)",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-010"
  ],
  "description": "FR-22 / AC-10 (simulated), split out of F-010 in cycle 0011. After a successful install (exit 0 path of contract installer-cli 1.0.0), install.sh runs a smoke test with two checks: (1) `azdo`: fetch the shared file with the plugin's own `__internals.fetchRemoteConfig` (same URL, PAT/az-token rules and fixed error codes as FR-2/FR-3; no second HTTP/auth implementation) and parse it with `__internals.parseJsonc`; (2) `bifrost`: GET `<provider.bifrost.options.baseURL>/models` (baseURL from the fetched shared config, trailing slash normalised; with the Appendix A value this is `https://bifrost.yourcompany.internal/v1/models`) with `Authorization: Bearer <apiKey>` where apiKey is the value now in the personal config. PO decisions (conservative): the key is never sent over non-https, so a non-https or unparseable baseURL makes the bifrost check fail with a fixed code without any request; when the personal config still holds the template placeholder `sk-bf-<your-virtual-key>` (no key set) the bifrost check reports `skipped` with a message to set KILO_BIFROST_KEY and sends nothing; when the azdo check fails the bifrost check is `skipped`. Each request is bounded by the plugin timeout (settings.timeoutMs, default 5000 ms) and response bodies are capped (1 MiB). Exit codes (contract amendment, Architect records it): 0 = installed and every check passed or was skipped; 4 = installed but at least one smoke check failed; a failed smoke test NEVER undoes or modifies the installation. A `--no-smoke` flag skips the smoke test (for offline machines and for the existing F-010 installer tests, which must not touch the network). Output is one line per check: `smoke <check>: pass|fail|skipped [<fixed code or HTTP status>]`. Test seam (Architect decides; PO suggestion): the smoke logic lives in a pure module under backend/installer/ with injectable fetch/runAz/env, unit-tested with fakes, plus child-process tests of install.sh that replace globalThis.fetch via a test-only preload (e.g. NODE_OPTIONS=--import <fixture>) or local fake HTTP servers; no product-level option may redirect the AzDO host or relax the https rule. Tests never touch the real network, az, Kilo or home directory. The plugin file and its export surface, the validator rules and the personal config template are unchanged. Zero runtime npm deps (FR-11).",
  "acceptance_criteria": [
    "Given a temp HOME, valid org/project/repo, AZDO_PAT set, KILO_BIFROST_KEY set, a fake AzDO Items API returning the shipped example shared config (backend/shared-config/kilo.jsonc) and a fake Bifrost returning 200 for GET /v1/models, When install.sh runs, Then it exits 0, prints `smoke azdo: pass` and `smoke bifrost: pass`, the AzDO request was made via the plugin's fetchRemoteConfig URL rules (dev.azure.com Items API, api-version=7.1, the configured path/branch), and exactly one Bifrost request was sent to `https://bifrost.yourcompany.internal/v1/models` carrying `Authorization: Bearer <KILO_BIFROST_KEY>`.",
    "Given the fake Bifrost returns 401 (AC-10, simulated) or the fake AzDO returns 404, When install.sh runs, Then the failing check prints `fail` with the HTTP status (e.g. `smoke bifrost: fail 401`, `smoke azdo: fail http-404`), when azdo fails the bifrost check is reported `skipped` and no Bifrost request is sent, the script exits 4, and the personal config and plugin file are byte-identical to those of a successful run with the same inputs (installation is not undone).",
    "Given a fetch that never responds, or a fetched shared file that is invalid JSONC, has no string provider.bifrost.options.baseURL, or has an `http://` or unparseable baseURL, When the smoke test runs, Then the relevant check fails with a fixed code (e.g. timeout, invalid-jsonc, no-base-url, insecure-base-url) within a bounded time (timeoutMs), no request carrying the virtual key is sent to a non-https URL, and the script exits 4.",
    "Given a fresh HOME with KILO_BIFROST_KEY unset (personal config holds the placeholder `sk-bf-<your-virtual-key>`), When install.sh runs with succeeding fakes, Then the bifrost check is reported `skipped` with a message telling the engineer to set KILO_BIFROST_KEY, no Bifrost request is sent, and the script exits 0; and Given an existing personal config with apiKey `sk-bf-existing` and KILO_BIFROST_KEY unset, Then the Bifrost request carries `Bearer sk-bf-existing`.",
    "Given no PAT from any source and a stub az that returns a token, When the smoke test runs, Then the AzDO request carries `Authorization: Bearer <token>` (same rules as FR-3 through fetchRemoteConfig) and the Bifrost request carries only the virtual key, never the az token or PAT.",
    "Given smoke test runs on the success, 401, 404, timeout and exception paths with KILO_BIFROST_KEY `sk-bf-AbCdEf1234567890`, AZDO_PAT and an az token set to sentinel values, When the full stdout and stderr are captured, Then none of those values (nor the base64 Basic credential) appears, and no error message text from fetch or the response body is echoed.",
    "Given `--no-smoke`, When install.sh runs, Then no HTTP request and no az token call for the smoke test is made, no `smoke` line is printed and the exit code follows the F-010 contract; and Given an install that fails before writing (exit 1, 2 or 3), Then the smoke test does not run.",
    "Given the repository after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0, runs the new smoke-test tests and the existing F-010 installer tests (which make no real network call), backend/package.json has no runtime `dependencies`, backend/plugin/azdo-remote-config.ts and backend/personal-config/kilo.jsonc are unchanged, and docs/architecture/contracts/installer-cli.md documents the smoke test output, exit code 4 and `--no-smoke`."
  ],
  "source": "po",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json` — F-019 set to in_progress with expanded description and 8 acceptance criteria.
- `factory/runs/cycle-0013/01-product-owner.md` — this report.

## Verification
- `node -e "JSON.parse(...backlog.json...)"` → valid JSON; exactly one in_progress item (F-019, 8 ACs).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- The virtual key is never sent to a non-https Bifrost baseURL; the check fails with a fixed code instead — protects the key if the shared file is misconfigured or tampered with.
- When the personal config holds only the template placeholder, the bifrost check is `skipped` (exit 0) rather than failing — a fresh install without a key is a supported F-010 path.
- New exit code 4 = "installed, smoke test failed" so automation can distinguish it from prerequisite/usage/file-system errors (1-3) while the installation is kept (FR-22 "report pass or fail").
- `--no-smoke` flag added for offline machines and to keep the existing F-010 tests network-free.
- The AzDO check reuses the plugin's `fetchRemoteConfig` so auth and URL rules cannot drift from FR-2/FR-3.
- No product-level option may redirect the AzDO host; fakes are injected through a test-only seam (Architect's choice).

## Follow-ups for the backlog
- None new. F-011 (Windows installer) must include parity with this smoke test; F-014 can reuse its fakes.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0013/01-product-owner.md
summary: Selected F-019 (install.sh FR-22 smoke test: AzDO fetch + Bifrost /v1/models, exit 4 on failure, --no-smoke) with 8 ACs; F-012/F-013 remain skipped.
