# Product Owner report — cycle 0020 — T-019: Installer hardening: CDPATH-safe helper lookup, symlink re-check, Node version test fix

## Inputs read
- factory/VISION.md (no VISION_TEMPLATE_UNCHANGED marker), factory/backlog.json, factory/state.json
- CHANGELOG.md (latest v0.14.1, T-013), factory/runs/cycle-0019/summary.md
- backend/installer/install.sh (lines 133-141), backend/installer/install-helper.ts (applyPlan), backend/test/installer/install-sh.test.ts, to verify the T-019 findings still apply

## Work done
- Decision: option (a), select ONE more item, not DONE yet. Reason: T-019 holds the only remaining defect that a real engineer can hit. `install.sh` line 139 runs `script_dir=$(cd "$script_dir" && pwd)` without `CDPATH=`. If an engineer's shell exports CDPATH and they run the installer through a relative path, the helper hand-off can break. The AC-5 test "Node 22.18 and newer pass" passes `--help`, which exits before the version check, so that test proves nothing. Both points were checked against the current code.
- Trimmed T-019 to four sub-items: the CDPATH fix with an exit-3 missing-helper check, the symlink re-lstat after mkdir, the Node version test fix with a 22.17.x case, and an sk-bf- leak test. The info-level docs/fixture/shellcheck bits are listed as out of scope.
- Set T-019 to in_progress with 6 Given/When/Then ACs. Scope: backend=true, frontend=false.
- Re-prioritized (3 -> 4), with the reason in each item's notes: T-008 (the CHANGELOG matched VERSION for every release since v0.3.0), T-024 (`@file` is only reachable from the operator's own arguments), T-002 (dev-time lint, not a security boundary). F-017 stays at 3 but is deferred: the PR gate and branch policy (F-008) are the primary control.
- F-012, F-013 and F-015 were left untouched (blocked, SKIPPED by user instruction). No new items were created.

Selected item (copy verbatim):

```json
{
  "id": "T-019",
  "title": "Installer hardening: CDPATH-safe helper lookup, symlink re-check, Node version test fix",
  "type": "tech-debt",
  "priority": 3,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-010"
  ],
  "description": "Cycle 0011 security+review follow-ups for backend/installer, trimmed in cycle 0020 to the items with real value. IN SCOPE: (1, review low 2 / sec low 2) install.sh resolves script_dir with `cd \"$script_dir\" && pwd`; when CDPATH is set and the script is invoked via a relative path containing '/', bash cd searches CDPATH and echoes the directory, so script_dir can be wrong or multi-line and the hand-off to install-helper.ts breaks. Fix: `script_dir=$(CDPATH= cd -- \"$script_dir\" && pwd)`, then check that \"$script_dir/install-helper.ts\" is a regular file before handing off; if missing print a fixed one-line error to stderr and exit 3 (no node invocation, no stack trace). (2, sec low 1) install-helper.ts applyPlan: after mkdirSync(azdoDir) and before any chmod/write in configDir/azdoDir (including the no-change chmod of kilo.jsonc), re-lstat configDir, azdoDir and the config file and refuse (existing fixed refusal message/exit code per installer contract) if any became a symlink, never following it. (3, review low 1) the 'Node 22.18 and newer pass the version check' test uses --help which exits before the version check: run it with required args plus AZDO_PAT so the version check really executes, and add a 22.17.x case expecting exit 1. (4, review info 3) run the existing key-leak test also with an sk-bf- prefixed KILO_BIFROST_KEY. OUT OF SCOPE (left for later / not worth a cycle): safe-character printing of plugin/ file names (sec info 3), backup-deletion docs note (sec info 4), extra e2e AC-3 fixture fields (review info 4), optional shellcheck/check-lf in ci.sh. install.ps1 is unchanged (T-022).",
  "acceptance_criteria": [
    "Given CDPATH is set to a directory that contains a subdirectory with the same relative name as the installer's directory, When install.sh is invoked via a relative path containing '/' (e.g. `bash installer/install.sh ...`) with valid args, Then it locates and runs the real install-helper.ts next to install.sh and exits 0, and stdout contains no extra directory line printed by cd.",
    "Given install-helper.ts is absent next to install.sh (test copies install.sh alone into a temp dir), When install.sh runs with valid args and prerequisites satisfied, Then it exits 3, stderr is exactly the fixed one-line message documented in the installer contract, node is not invoked on the missing file, and no stack trace appears.",
    "Given the config directory (or the kilo-azdo plugin directory, or kilo.jsonc) is replaced by a symlink after planning but before writing (simulated via a test hook or by pre-creating the symlink so the post-mkdir re-lstat sees it), When the installer applies its plan on POSIX, Then it refuses with the contract's fixed refusal message and exit code, and the symlink target is not created, modified or chmod-ed.",
    "Given a fake node reporting v22.17.1, When install.sh runs with required args and AZDO_PAT set (no --help), Then it exits 1 with the documented version error; and Given fake node v22.18.0 and v23.0.1 with the same args, Then the version check passes (no version error on stderr).",
    "Given KILO_BIFROST_KEY set to an sk-bf- prefixed test value, When install.sh runs successfully, Then that value appears in neither stdout nor stderr (it is written only to kilo.jsonc).",
    "Given the full suite, When `bash scripts/ci.sh` runs, Then it exits 0, the installer contract documents the exit-3 missing-helper message and the post-mkdir symlink re-check, and existing installer tests (including install.ps1 tests where the platform runs them) still pass."
  ],
  "source": "security",
  "cycle_done": null,
  "notes": "Selected in cycle 0020. Rationale: the only remaining item with a user-facing correctness defect (installer breaks for engineers whose shell exports CDPATH) plus a test that gives false assurance (version check never executed). PO intends to declare DONE in cycle 0021 unless this cycle surfaces medium+ findings. Versioning: patch (fix)."
}
```

## Files changed
- `factory/backlog.json` — T-019 selected and rescoped. Priorities and notes changed for T-008, T-024 and T-002, and a note was added to F-017.
- `factory/runs/cycle-0020/01-product-owner.md` — this report.

## Verification
- `python -c "import json; json.load(open('factory/backlog.json'))"` → ok. The file keeps its ASCII-only, CRLF, 2-space format. A round-trip check showed the serializer reproduces the original byte for byte before the edits.
- Confirmed in the source: install.sh:139 has no `CDPATH=` and no helper-existence check. The install-sh.test.ts:246 version test is the one review low 1 describes.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/installer/install.sh:139 | `cd` without `CDPATH=`, and no check that the helper exists | In scope of T-019 (AC-1, AC-2) |
| 2 | low | backend/test/installer/install-sh.test.ts:246 | Version-pass test never reaches the version check | In scope of T-019 (AC-4) |

## Assumptions made (no human available)
- The missing-helper exit code is 3, as the original cycle 0011 finding proposed. The Architect fixes the exact message in the installer contract.
- The symlink re-check reuses the existing refusal message and exit code, so no new contract code is needed unless the Architect decides otherwise.
- install.ps1 is out of scope (T-022) to keep the item small.

## Remaining backlog assessment (value vs. cost of a full pipeline cycle)
After T-019 ships, the PO intends to return DONE in cycle 0021, unless this cycle's security or review reports raise a finding of medium severity or higher. Everything left is defence in depth with low exploitability, test hygiene or documentation polish. None of it is worth a full autonomous cycle on its own. Worth doing later, by a human or bundled with future feature work:
- F-017 (allowlist for {file:}/{env:}): the most meaningful remaining hardening. Do it if the shared config repo ever gains writers outside the platform team.
- T-008 (ci.sh fails when VERSION has no CHANGELOG section): a very cheap guard. Fold it into the next ci.sh change.
- T-014 / T-030 (cache read through a single handle, temp-file cleanup, cleanName bidi chars): small robustness wins in the plugin. Bundle them with the next plugin change.
- T-024 (`@` prefix in the policy script): a one-line fix with a test. The risk is self-inflicted, so bundle it with T-023.
- T-002 (FR-11 lint evasions): only matters if contributors become untrusted.
- T-029 / T-025 (Kilo option override, branch-policy semantics): these need a real Kilo or Azure DevOps org. They are manual verification and cannot be closed autonomously.
- All priority-5 items (T-009, T-011, T-015, T-017, T-018, T-026, T-027, T-028) and the priority-4 nits: optional.

## Follow-ups for the backlog
- None new. The out-of-scope T-019 remnants (sec info 3/4, review info 4, shellcheck) stay recorded in the T-019 description and can become a priority-5 item if anyone wants them.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0020/01-product-owner.md
summary: Selected T-019 (installer CDPATH/helper-check, symlink re-lstat, real Node version test, sk-bf- leak test); PO plans DONE next cycle barring medium+ findings
