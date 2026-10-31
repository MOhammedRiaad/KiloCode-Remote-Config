# Product Owner report — cycle 0014 — F-011: Bootstrap installer for Windows (install.ps1)

## Inputs read
- factory/VISION.md (FR-18..FR-23, AC-10, AC-12, AC-14)
- factory/backlog.json, factory/state.json (last release v0.10.0, F-019 shipped in cycle 13)
- factory/runs/cycle-0013/* (PO, architect, security, security re-run, review, docs, release, summary)
- docs/architecture/contracts/installer-cli.md (1.1.0; section 4 helper stdin protocol is "shared with F-011")
- backend/installer/install.sh (thin front end that pipes records to install-helper.ts)

## Work done
- Vision check: no VISION_TEMPLATE_UNCHANGED marker; vision defined.
- Grooming:
  - USER DECISION honoured: F-012 and F-013 stay `blocked` with their "SKIPPED by user instruction" notes; not selected, split or unblocked; no new key-provisioning items created.
  - Cycle 0013 follow-ups (review low 1-2, info 3; security info 2 and test-hermeticity suggestion) are already captured in T-020 (priority 4). No high/critical security findings exist, so nothing pre-empts the critical path.
  - Architect cycle 0013 follow-ups added to item descriptions: F-014 reuses the F-019 fake-network preload; F-016 documents exit code 4, --no-smoke/-NoSmoke and smoke fixed codes.
  - No item has failed in 2+ cycles; nothing to mark blocked or split.
  - Remaining vision scope (excluding skipped C6): F-011 (FR-18 Windows half), F-008 (FR-13 pipeline, FR-14 branch policy), F-014 (simulated AC-1/AC-2/AC-10), F-016 (docs), F-015 (FR-15 per-team). DONE is not reached.
- Selection: **F-011** (now unblocked since F-010 and F-019 are done). Raised priority 3 -> 2 because it completes C5/FR-18 (a whole platform of the 3 supported OSes) and is first on the user's preferred critical path. Set to `in_progress`.
- Rewrote the description (thin PowerShell front end reusing install-helper.ts via the section-4 stdin protocol, so file work, smoke test and backups are not reimplemented) and expanded the acceptance criteria from 5 vague to 8 automated Given/When/Then criteria. Scope: backend true, frontend false.

Selected item (copy verbatim):

```json
{
  "id": "F-011",
  "title": "Bootstrap installer for Windows (install.ps1)",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-010",
    "F-019"
  ],
  "description": "FR-18 (install.ps1 half) / FR-19..FR-23 / AC-10 (simulated) / AC-12 / AC-14 for Windows, behaviour parity with install.sh (F-010) and its smoke test (F-019). PO decision (cycle 0014): backend/installer/install.ps1 is a THIN front end like install.sh: it parses parameters, applies env/defaults, checks prerequisites, then pipes the NUL-terminated stdin records of contract installer-cli section 4 (org, project, repo, path, branch, mode, apiKey, smoke) to the existing `node install-helper.ts`, whose exit code it returns. All file work, personal-config editing, backups, permissions and the smoke test stay in the shared helper (no second implementation in PowerShell). Parameters: -Org, -Project, -Repo, -Path, -Branch, -Mode, -NoSmoke, -Help (Architect fixes exact names and records them as a contract amendment, e.g. installer-cli 1.2.0); env fallbacks KILO_AZDO_ORG/PROJECT/REPO/PATH/BRANCH/MODE; the virtual key comes ONLY from env KILO_BIFROST_KEY (no parameter, never in argv) and secrets travel on stdin only. Same exit codes 0-4 and same fixed messages as install.sh (script name may read install.ps1). Must run under Windows PowerShell 5.1 and PowerShell 7+ (pwsh), with no module installs (no Pester requirement). Prerequisites (FR-21): node >= 22.18 on PATH; one of AZDO_PAT / AZURE_DEVOPS_EXT_PAT / KILO_AZDO_PAT non-empty, else `az` on PATH and `az account show` succeeding; all checked before anything is written. Plugin path: <config dir>\\azdo\\azdo-remote-config.ts with config dir from the helper (XDG_CONFIG_HOME or <USERPROFILE>\\.config\\kilo), referenced as ./azdo/azdo-remote-config.ts. Cycle 0010 security: personal config written user-only (the helper's Windows behaviour is documented by the Architect; no new ACL code required unless the Architect decides otherwise), never overwritten without a backup. Tests: node:test suites under backend/test/installer/ spawn `pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File install.ps1` (or powershell.exe when pwsh is absent) with a temp USERPROFILE/HOME, an allow-listed env and stub az/node shims, reusing the F-019 fake-network preload (test/installer/fixtures/fake-network.ts) for smoke cases; when no PowerShell is available the suite skips with a clear message. Tests never touch the real home directory, network, az or Kilo. The plugin file, its export surface, the validator rules, the personal config template and install.sh behaviour are unchanged. Zero runtime npm deps (FR-11).",
  "acceptance_criteria": [
    "Given a temp USERPROFILE (and HOME) with no Kilo config, -Org/-Project/-Repo supplied, KILO_BIFROST_KEY set, AZDO_PAT set and -NoSmoke, When install.ps1 runs under PowerShell, Then it exits 0, `<profile>/.config/kilo/azdo/azdo-remote-config.ts` is byte-identical to backend/plugin/azdo-remote-config.ts, and `<profile>/.config/kilo/kilo.jsonc` is byte-identical to the file install.sh produces for the same inputs in another temp home (one plugin entry `[\"./azdo/azdo-remote-config.ts\", {org, project, repo, path:'/kilo.jsonc', branch:'main', mode:'defaults'}]`, apiKey equal to KILO_BIFROST_KEY).",
    "Given org/project/repo/path/branch/mode supplied only through KILO_AZDO_* env vars, and separately both a parameter and an env var for the same setting, When install.ps1 runs, Then env values are used when parameters are absent and the parameter wins when both are set; and Given a missing org, project or repo, an unknown parameter (e.g. -ApiKey or -Key), or a positional argument, When it runs, Then it exits 2 with a usage message that does not echo the offending argument text and nothing is created under the temp profile.",
    "Given an existing personal config (with comments) containing `model`, `provider.other`, `provider.bifrost.options.headers`, apiKey `sk-bf-existing`, a `my-other-plugin` entry and an outdated azdo-remote-config entry, When install.ps1 runs with KILO_BIFROST_KEY unset, Then every other key deep-equals its previous value, `my-other-plugin` is still present, exactly one azdo-remote-config entry carries the supplied options, apiKey is still `sk-bf-existing`, and a backup byte-identical to the original exists next to it (FR-20).",
    "Given any install.ps1 run (fresh or update), When the temp profile is inspected, Then nothing exists under `.config/kilo/plugin/` or `.config/kilo/plugins/` that was created by the installer and the personal config references azdo-remote-config.ts exactly once (FR-19, AC-12); and Given install.ps1 has run successfully once, When it runs a second time with the same inputs, Then it exits 0, a recursive byte comparison of the config dir shows no change except (at most) the plugin file, and no additional backup is created (FR-23, AC-14).",
    "Given a PATH without `az` and no AZDO_PAT / AZURE_DEVOPS_EXT_PAT / KILO_AZDO_PAT, or a stub az whose `account show` exits non-zero, or no node / a node reporting version 22.17.0 on PATH, When install.ps1 runs, Then it exits 1, stderr names the fix (install the Azure CLI and run `az login`, or set AZDO_PAT; install Node.js 22.18 or later), and nothing is created under the temp profile; and Given no az but AZDO_PAT set, Then the prerequisite check passes (FR-21).",
    "Given the F-019 fake network (AzDO Items API serving backend/shared-config/kilo.jsonc, Bifrost GET /v1/models) and smoke enabled, When install.ps1 runs, Then with succeeding fakes it exits 0 and prints `smoke azdo: pass` and `smoke bifrost: pass` with exactly one Bifrost request carrying `Authorization: Bearer <KILO_BIFROST_KEY>`; with Bifrost returning 401 it prints `smoke bifrost: fail 401` and exits 4 leaving the installed files byte-identical to the success run (AC-10 simulated); and with -NoSmoke no smoke request is sent and no `smoke` line is printed.",
    "Given runs on the success, usage-error, prerequisite-failure and smoke-failure paths with KILO_BIFROST_KEY `sk-bf-AbCdEf1234567890` and AZDO_PAT set to a sentinel value, When the full stdout and stderr are captured and the command line of every process spawned by install.ps1 is checked (e.g. via the stub node/az shims recording their argv), Then neither value appears in any output or argv, and install.ps1 has no parameter that accepts a key or PAT.",
    "Given the repository after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0 and runs the install.ps1 tests (or skips them with a clear message when no PowerShell is installed), the existing install.sh, smoke and helper tests still pass, backend/package.json has no runtime `dependencies`, backend/plugin/azdo-remote-config.ts, backend/personal-config/kilo.jsonc and backend/installer/install.sh are unchanged, and docs/architecture/contracts/installer-cli.md documents install.ps1's parameters, env inputs and exit codes."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json` — F-011 selected (in_progress, priority 2, new description and 8 ACs); F-014 and F-016 descriptions gained cycle 0013 architect follow-ups.
- `factory/runs/cycle-0014/01-product-owner.md` — this report.

## Verification
- `node -e` JSON.parse of factory/backlog.json succeeded; exactly one item (F-011) is `in_progress`, with 8 ACs.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- install.ps1 is a thin front end over the existing Node install-helper.ts (contract section 4 already names F-011 as its consumer) — avoids a second, divergent implementation of FR-20/FR-22 in PowerShell and keeps parity by construction.
- Tests use node:test spawning pwsh/powershell.exe rather than Pester — no module installs needed in CI; GitHub ubuntu runners and this Windows host have pwsh. Skip with a clear message when no PowerShell exists.
- Windows file permissions: the helper's current Windows behaviour (mode bits ignored) is accepted; the Architect documents it and may add ACL hardening only if cheap. Conservative but not required by an AC.
- Personal config parity is asserted byte-for-byte against install.sh output for the same inputs, which is the strongest automated form of "same as install.sh".
- install.sh must remain unchanged; if the Architect needs a shared change it must go in install-helper.ts without altering install.sh behaviour.

## Follow-ups for the backlog
- None new. After F-011: F-008 (pipeline/branch policy) then F-014 (e2e) and F-016 (docs, including Windows install).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0014/01-product-owner.md
summary: Selected F-011 (Windows install.ps1 thin front end over install-helper.ts, parity with install.sh incl. smoke test) with 8 ACs; F-012/F-013 remain skipped.
