# Product Owner report — cycle 0018 — F-016: User and operator documentation

## Inputs read
- `factory/VISION.md` (sections 1-9: FR-7 cache, compatibility/version range, Phase 0, assumptions A1-A3, KILO_PURE risk)
- `factory/backlog.json`, `factory/state.json` (cycle 18, last release v0.13.0)
- `factory/runs/cycle-0016/*` (F-014 shipped as v0.13.0) and `factory/runs/cycle-0017/summary.md` (F-015 skipped by user)
- `docs/development.md` ("What stays manual (Phase 0)"), `docs/user-guide.md`, `docs/architecture/ADR-0001-tech-stack.md` (supported Kilo range `>=7.2.0 <8.0.0`)

## Work done
- Checked the vision gate: `VISION_TEMPLATE_UNCHANGED` is absent, so grooming proceeds.
- Grooming:
  - User decisions still apply. F-012, F-013 (Bifrost key provisioning) and F-015 (per-team files) stay `blocked` with their "SKIPPED by user instruction" notes. I did not select, split or unblock them.
  - Cycle 0016 follow-ups are already in the backlog: T-026 (e2e harness nits from security/review) and the F-016 notes (manual Phase 0 checklist, GitHub origin). Cycle 0017 was abandoned and has no new follow-ups. No new items are needed.
  - No open security item is high or critical. The open security-sourced items (F-017, T-013, T-019, T-024, T-002 at priority 3; others at 4-5) all come from low or accepted-risk findings, so none outranks the last vision feature.
  - Nothing has failed in 2+ cycles, so nothing new is marked blocked.
- Selected F-016, the last remaining vision feature (priority 3). It ties with several priority-3 tech-debt items, and I chose it because it delivers vision scope (the docs, KILO_PURE caveat, version range and Phase 0 checklist). The F-013 dependency is waived by user decision. `depends_on` now lists the shipped features it documents: F-010, F-011, F-008, F-014 (all done).
- Rewrote the acceptance criteria as 6 automated checks. Each has a negative control where that makes sense. Scope stays docs-only (`backend: false`, `frontend: false`). The only code is the docs check script, and the Architect decides where it goes; I recommend a dependency-free Node script under `scripts/` that `scripts/ci.sh` calls.
- Status set to `in_progress`.

Selected item (verbatim from backlog):
```json
{
  "id": "F-016",
  "title": "User and operator documentation",
  "type": "feature",
  "priority": 3,
  "status": "in_progress",
  "scope": {
    "backend": false,
    "frontend": false
  },
  "depends_on": [
    "F-010",
    "F-011",
    "F-008",
    "F-014"
  ],
  "description": "Engineer setup guide, platform-team runbook (config change, key provisioning, offboarding), KILO_PURE caveat, supported Kilo version range, Phase 0 assumptions A1-A3 checklist. User decision (cycle 0012): F-012/F-013 are skipped, so treat the F-013 dependency as waived and omit key-provisioning/offboarding runbook content. Cycle 0013 architect follow-up: document installer exit code 4, --no-smoke (and the Windows equivalent once F-011 ships) and each smoke fixed code with what to do. Cycle 0014: also document install.ps1 ExecutionPolicy/Unblock-File guidance (already in the user guide), the 'Rewritten by install.sh' header note, and Windows ACL residual risk. Cycle 0015: the platform runbook should cover setting up the C1 repo, the PR pipeline and the branch-policy script from F-008 (if shipped by then). Cycle 0015 security: runbook should tell platform engineers to restrict the 'Bypass policies' and 'Edit policies' permissions on the shared config repo (a PR can alter its own gate). Cycle 0016: fold the manual Phase 0 checklist from docs/development.md ('What stays manual (Phase 0)': real Kilo CLI /models and VS Code model list against real AzDO + Bifrost, Kilo's own loading of the .ts plugin and path resolution, disabled key rejected at request time) into the platform runbook. Also note the repo now has a GitHub origin; document the PR/branch flow if the factory moves to remote mode. User decision (cycle 0017): F-015 (per-team files) is SKIPPED too - do not document per-team files as a feature; the generic `path` option may be mentioned only as the existing plugin/installer setting.",
  "acceptance_criteria": [
    "Given the repository, When the automated docs check (wired into `bash scripts/ci.sh`) runs, Then docs/engineer-setup.md, docs/platform-runbook.md and docs/troubleshooting.md exist, each links to the other two via relative links that resolve to existing files, and README.md links to all three; and Given any of these pages or links is removed (fixture/negative control), Then the check exits non-zero naming the missing item.",
    "Given docs/troubleshooting.md, When the check scans it, Then it mentions `KILO_PURE=1` (with the note that CI jobs needing the shared config must not set it), `az login`, the cache path `~/.cache/kilo-azdo/remote-config.json`, and installer exit code 4 together with `--no-smoke` and its Windows equivalent.",
    "Given docs/engineer-setup.md, When the check scans it, Then it contains the supported Kilo range read at check time from `SUPPORTED_KILO_RANGE` in backend/plugin/azdo-remote-config.ts (not hard-coded in the check), and it covers both install.sh and install.ps1 including the ExecutionPolicy/Unblock-File guidance.",
    "Given docs/platform-runbook.md, When the check scans it, Then it contains a Phase 0 checklist naming assumptions A1, A2 and A3 and the manual checks from docs/development.md (real Kilo CLI `/models` and VS Code model list, Kilo loading the .ts plugin and its path resolution, disabled key rejected by Bifrost at request time), plus sections on setting up the shared config repo, the PR pipeline and the branch-policy script, and on restricting the 'Bypass policies' and 'Edit policies' permissions.",
    "Given all Markdown files under docs/ plus README.md, When scanned for `sk-bf-` followed by real-looking key material (16 or more consecutive alphanumeric characters; `<placeholder>` and `...` forms allowed), Then none is found; and Given a temporary fixture containing such a key (built at test time, never committed), Then the scan fails (negative control).",
    "Given the skipped scope (F-012, F-013, F-015), When the check scans docs/engineer-setup.md and docs/platform-runbook.md, Then they contain no key-provisioning or offboarding procedure and no per-team config file (`teams/`) instructions, and the runbook states that Bifrost virtual keys are issued and disabled manually by the platform team outside this project."
  ],
  "source": "vision",
  "cycle_done": null,
  "notes": "Selected in cycle 0018 (last remaining vision feature). F-013 dependency waived by user decision; depends_on now lists the shipped features whose behaviour is documented. Docs-only (scope.backend/frontend false): the only code is the automated docs check; the Architect decides where it lives (recommended: a dependency-free Node script under scripts/ called from scripts/ci.sh, with fixture-based negative controls). Must omit key provisioning, offboarding and per-team files (SKIPPED by user instruction)."
}
```

## Files changed
- `factory/backlog.json` — F-016: status `in_progress`, `depends_on` updated (F-013 waived), 6 testable acceptance criteria, notes added.
- `factory/runs/cycle-0018/01-product-owner.md` — this report.

## Verification
- Parsed `factory/backlog.json` with Python `json.load`. It is valid, exactly one item is `in_progress` (F-016), and F-016 has 6 acceptance criteria.
- My first scripted rewrite of the backlog failed because a JSON-escaped lone surrogate (`\ud800` in F-005 AC) could not be re-encoded. I restored the file with `git checkout` and then made targeted text edits, so all other items are byte-identical.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | factory/backlog.json (F-005 AC) | Contains a JSON escape for a lone surrogate (`\ud800`). Tools that decode and re-encode the backlog as strict UTF-8 will fail. | Edit the backlog textually, or re-serialise with `ensure_ascii=True`. |

## Assumptions made (no human available)
- F-016 is selected over the tied priority-3 security/tech-debt items — it is the last vision feature, and those items come from low or accepted-risk findings.
- Page names `docs/engineer-setup.md`, `docs/platform-runbook.md` and `docs/troubleshooting.md` are fixed so the check can be deterministic. The existing `docs/user-guide.md` may stay, and new pages may link to it or reuse its content.
- The runbook states that virtual keys are issued and disabled manually by the platform team. This replaces the skipped provisioning/offboarding content without documenting a tool that does not exist.
- The negative-control fake key is generated at test time and never committed, so the repo secret scans and the validator `secret-pattern` rule are not tripped.
- Remote PR/branch flow (GitHub origin) is documented only if the factory moves to remote mode; it is not an acceptance criterion.

## Follow-ups for the backlog
- After F-016, every vision capability except the user-skipped scope (F-012, F-013, F-015) will be done. Remaining todo items are priority 3 tech-debt/security/chore items (T-002, F-017, T-008, T-013, T-019, T-024) and lower. Under the procedure, those priority-3 items must still be worked before the factory can return DONE.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0018/01-product-owner.md
summary: Selected F-016 (user and operator docs, docs-only) with 6 automated-check acceptance criteria; F-012/F-013/F-015 remain skipped.
