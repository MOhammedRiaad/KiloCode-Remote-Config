# Product Owner report — cycle 0011 — F-010: Bootstrap installer for macOS/Linux (install.sh): plugin copy, personal config, prerequisite check

## Inputs read
- factory/VISION.md (FR-18..FR-23, AC-12, AC-14, section 5 component C5)
- factory/backlog.json, factory/state.json (cycle 11, last release v0.8.0)
- factory/runs/cycle-0010/* (summary, architect, security, review, docs, release-prepare follow-ups)
- backend/personal-config/kilo.jsonc, docs/architecture/ADR-0001-tech-stack.md (installer layout `backend/installer/`)

## Work done
- Vision not template; not DONE: C5 installers, C6 key provisioning, FR-14 branch policy and the E2E test remain.
- All priority-1/2 items are done. Cycle 0010 follow-ups were already captured (T-018; notes on F-010/F-011); confirmed nothing new is pending. No high/critical security items are open.
- Selected F-010 (critical path: AC-1, AC-12, AC-14 and Phase 0 rollout need a bootstrap; key provisioning F-012 and branch policy F-008 are independent and remain next). Raised priority 3 -> 2.
- Split F-010: the FR-22 smoke test (fetch shared file + Bifrost `/v1/models`) moved to new item **F-019** (priority 3, depends on F-010). F-011 (Windows) now depends on F-010 and F-019 for parity; F-014 (E2E) depends on F-019 because its AC-10 criterion uses the installer smoke test.
- Rewrote F-010 with 8 Given/When/Then acceptance criteria, folding in the cycle 0010 security/architect/docs follow-ups (0600 personal config, backup before modifying, plugin path relative to the global config dir, nothing in `plugin/`).

Selected item (copy verbatim):

```json
{
  "id": "F-010",
  "title": "Bootstrap installer for macOS/Linux (install.sh): plugin copy, personal config, prerequisite check",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-006",
    "F-009"
  ],
  "description": "FR-18 (install.sh half) / FR-19 / FR-20 / FR-21 / FR-23 / AC-12 / AC-14 for POSIX (macOS, Linux; also runnable under Git Bash for CI). Cycle 0011 PO split: the FR-22 smoke test (fetch shared file + Bifrost /v1/models) moved to F-019 so this slice stays small. Location: backend/installer/install.sh (ADR-0001 layout); the Architect records in an ADR how the installer locates the plugin source (e.g. relative to the script, ../plugin/azdo-remote-config.ts, or an explicit source option) and the personal config template (backend/personal-config/kilo.jsonc). Inputs (PO decision): org, project and repo are REQUIRED (repo has no default since contract 0.5.0) and are given as flags (e.g. --org/--project/--repo) or KILO_AZDO_ORG/PROJECT/REPO env vars; optional path/branch/mode with the plugin defaults. The engineer's virtual key is supplied ONLY via the env var KILO_BIFROST_KEY (never a CLI argument, so it never appears in argv / process listings); when absent, an existing apiKey is kept, or the template placeholder is written for a new config and a message tells the engineer to set it. Editing an existing JSONC personal config (FR-20): the Architect may delegate parsing/editing to a zero-dependency Node helper reusing the plugin's parseJsonc (Kilo CLI ships on npm, so Node is assumed present; the installer checks for it and prints a fix if missing) or another approach; comments in an existing personal config need not be preserved, but a byte-identical timestamped backup is written before any modification. Cycle 0010 security/architect/docs follow-ups: the personal config is written with user-only permissions (0600; ~/.config/kilo/azdo/ not group/world-writable), an existing personal config is never overwritten without a backup, and the plugin entry path ./azdo/azdo-remote-config.ts resolves relative to the Kilo global config dir (~/.config/kilo/, honouring XDG_CONFIG_HOME if the Architect confirms Kilo does). Prerequisites are checked BEFORE anything is written. Tests run install.sh in a child bash process with a temp HOME and a fake PATH containing stub az/node as needed; they never touch the real home directory, network, az or Kilo. The plugin file, its export surface and the validator rules are unchanged. Zero runtime npm deps (FR-11).",
  "acceptance_criteria": [
    "Given a temp HOME with no ~/.config/kilo/, org/project/repo supplied, KILO_BIFROST_KEY set and a stub `az` on PATH that reports a logged-in account, When install.sh runs, Then it exits 0, `~/.config/kilo/azdo/azdo-remote-config.ts` is byte-identical to backend/plugin/azdo-remote-config.ts, and `~/.config/kilo/kilo.jsonc` parses with the plugin's `__internals.parseJsonc` to an object with exactly one plugin entry `[\"./azdo/azdo-remote-config.ts\", {...}]` whose org/project/repo equal the supplied values and whose path/branch/mode are `/kilo.jsonc`/`main`/`defaults`, and provider.bifrost.options.apiKey equals KILO_BIFROST_KEY; and on POSIX the personal config's mode is 0600.",
    "Given any run with KILO_BIFROST_KEY set to `sk-bf-AbCdEf1234567890` and AZDO_PAT set to a sentinel value, When the full stdout and stderr of install.sh are captured, Then neither value appears in the output; and Given a fresh HOME and KILO_BIFROST_KEY unset, When install.sh runs, Then apiKey equals the template placeholder `sk-bf-<your-virtual-key>` and the output tells the engineer to set their virtual key.",
    "Given an existing ~/.config/kilo/kilo.jsonc (with comments) containing `model`, `provider.other`, `provider.bifrost.options.headers`, `provider.bifrost.options.apiKey: 'sk-bf-existing'`, another plugin entry `my-other-plugin` and an outdated azdo-remote-config entry, When install.sh runs with KILO_BIFROST_KEY unset, Then every other key deep-equals its previous value, `my-other-plugin` is still present, there is exactly one azdo-remote-config entry carrying the supplied options, apiKey is still `sk-bf-existing`, and a backup file byte-identical to the original exists next to it; and When run with KILO_BIFROST_KEY set, Then apiKey is updated to that value.",
    "Given any install.sh run (fresh or update), When the temp HOME is inspected afterwards, Then nothing exists under `~/.config/kilo/plugin/` that was created by the installer and the personal config references azdo-remote-config.ts exactly once (plugin loads exactly once, AC-12, FR-19).",
    "Given a PATH without `az` and no AZDO_PAT / AZURE_DEVOPS_EXT_PAT / KILO_AZDO_PAT, or a stub `az` whose `account show` exits non-zero, When install.sh runs, Then it exits non-zero, stderr names the fix (install the Azure CLI and run `az login`, or set AZDO_PAT), and no file or directory is created under the temp HOME; and Given no az but AZDO_PAT set, Then the prerequisite check passes (FR-21).",
    "Given install.sh has run successfully once, When it is run a second time with the same inputs, Then it exits 0, and a recursive byte comparison of ~/.config/kilo/ before and after shows no change except (at most) the plugin file, and no additional backup file is created (AC-14, FR-23).",
    "Given missing org, project or repo (no flag and no env var), an unknown flag, or an existing personal config that is not valid JSONC or whose root is not an object, When install.sh runs, Then it exits non-zero with a usage or fixed error message (no stack trace, no file contents echoed) and every pre-existing file under the temp HOME is byte-identical afterwards.",
    "Given the repository after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0 and runs the installer tests (or skips POSIX-permission assertions on Windows with a clear message), backend/package.json has no runtime `dependencies`, and backend/plugin/azdo-remote-config.ts and backend/personal-config/kilo.jsonc are unchanged."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json` — F-010 rewritten and set `in_progress` (priority 2); new F-019 (installer smoke test); F-011 and F-014 dependencies updated.

## Verification
- `node -e` load of factory/backlog.json: valid JSON, 36 items, unique ids, exactly one `in_progress` (F-010).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- The virtual key is passed only via env var `KILO_BIFROST_KEY`, never as a CLI argument — keeps it out of argv / process listings and shell history.
- org/project/repo are required installer inputs (flags or `KILO_AZDO_*` env); path/branch/mode use plugin defaults — repo has no default since contract 0.5.0, and the org cannot be guessed.
- Node is assumed present on engineer machines (Kilo CLI is distributed via npm); the installer checks for it and prints a fix — lets the Architect reuse the plugin's parseJsonc for FR-20 instead of editing JSONC in bash.
- Comments in an existing personal config need not be preserved on update, provided a byte-identical timestamped backup is written first — preserving comments while editing JSONC is high effort; the backup removes the data-loss risk.
- Prerequisite check (az logged in or PAT) runs before any file is written — a failed install leaves the machine untouched.
- The FR-22 smoke test is split into F-019 — keeps the slice to 8 testable criteria and lets the core installer ship first.

## Follow-ups for the backlog
- F-019 (new): installer smoke test.
- Next candidates after F-010: F-012 (key provisioning create), F-008 (pipeline + branch policy), F-019, then F-011.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0011/01-product-owner.md
summary: Selected F-010 install.sh core (plugin copy, personal config create/update with backup, prereq check, idempotency); smoke test split into F-019.
