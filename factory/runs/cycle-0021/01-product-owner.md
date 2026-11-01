# Product Owner report — cycle 0021 — (none): factory DONE, closing summary

## Inputs read
- factory/VISION.md (no VISION_TEMPLATE_UNCHANGED marker), factory/backlog.json, factory/state.json
- CHANGELOG.md (v0.0.1 .. v0.14.2), factory/runs/cycle-0020/ (01-product-owner, 04-security, 05-review, summary)
- docs/platform-runbook.md (Phase 0 verification checklist), docs/development.md ("What stays manual")

## Work done
- Decision: **DONE**. No item selected and nothing set to `in_progress`.
- Why:
  - Every vision capability is delivered, except the ones the user chose to skip (F-012, F-013, F-015).
  - Cycle 0020 (T-019, v0.14.2) raised no medium or higher findings: security had 2 low and 3 info, review had 1 low and 4 info.
  - Last cycle I said I would declare DONE unless medium+ findings appeared. None did.
  - What is left falls into two groups: (a) defence-in-depth, test-hygiene or doc-wording nits with low exploitability, and (b) checks that need a real Kilo install, a real Azure DevOps org or a Linux run. Group (b) cannot be closed on this Windows host without a human.
  - Neither group justifies another full 8-agent cycle.
- Backlog grooming:
  - F-017 (allowlist for {file:}/{env:}) lowered from 3 to 4, with a note. It is optional hardening for a risk that was already accepted, and the F-008 PR gate plus branch policy is the main control. With this change no `todo` item of priority 3 or higher remains, which the DONE condition requires.
  - T-025, T-029 and T-031 got notes marking them as needing a human or a real environment.
  - F-012, F-013 and F-015 are untouched (blocked, SKIPPED by user instruction). No new items were created.

## Closing summary for the user

### Delivered (19 releases, v0.0.1 .. v0.14.2)
| Version | Item | What |
|---|---|---|
| v0.0.1 | T-001 | Project skeleton, ADR-0001 stack, ci.sh and GitHub Actions |
| v0.1.0 | F-001 | Plugin: JSONC parser |
| v0.2.0 | F-002 | Plugin: `{env:}` / `{file:}` placeholder resolution |
| v0.3.0 | F-003 | Plugin: in-place merge, `defaults` / `enforce`, apiKey never applied |
| v0.4.0 | F-004 | Plugin: settings resolution (options > KILO_AZDO_* env > defaults) |
| v0.5.0 | F-005 | Plugin: Azure DevOps Items API fetch, PAT / az token auth, timeout, size cap |
| v0.6.0 | F-006 | Plugin: config hook wiring, cache and fallback, logging without secrets, never crashes |
| v0.7.0 | F-007 | Shared config example and validator CLI |
| v0.8.0 | F-009 | Personal config template |
| v0.9.0 | F-010 | install.sh (macOS/Linux) |
| v0.10.0 | F-019 | Installer smoke test (AzDO fetch and Bifrost /v1/models) |
| v0.11.0 | F-011 | install.ps1 (Windows) |
| v0.12.0 | F-008 | Azure Pipelines PR gate, branch-policy script, C1 repo assembly tool |
| v0.13.0 | F-014 | End-to-end simulated startup test |
| v0.14.0 | F-016 | User and operator documentation |
| v0.14.1 | T-013 | Cache bound to the settings that produced it |
| v0.14.2 | T-019 | Installer hardening (CDPATH-safe helper lookup, symlink re-check, real Node version test) |

(T-005 was a CI/hygiene item shipped in cycle 4 without its own version.)

### Skipped by the user's decision (status blocked, notes say "SKIPPED by user instruction")
- F-012: create a Bifrost virtual key per engineer. The Architect's draft is in git stash "F-012 architect draft".
- F-013: bulk CSV import, list and disable keys (offboarding, AC-11).
- F-015: per-team config files (`/teams/<team>/kilo.jsonc`, FR-15). The plugin `path` option and the PR gate's `teams/*/kilo.jsonc` glob already allow team files, but there is no dedicated example or team-specific validation.
- To bring one back, set its status to `todo` and restart the loop.

### Manual Phase 0 checks still open (docs/platform-runbook.md, "Phase 0 verification checklist")
Run these with 2 or 3 platform engineers before rollout:
1. A1: config mutated in Kilo's `config` hook reaches the provider and model list.
2. A2: Kilo passes plugin tuple options to local-file plugins. If it does not, use the KILO_AZDO_* env vars.
3. A3: Bifrost exposes an OpenAI-compatible `/v1` that works with `@ai-sdk/openai-compatible` and Bearer `sk-bf-...`.
4. The real Kilo CLI `/models` and the VS Code extension model list both show the Bifrost models.
5. Kilo loads the `.ts` plugin from `~/.config/kilo/azdo/` on macOS, Linux and Windows, exactly once.
6. Bifrost rejects a disabled virtual key with 401.

Open vision questions still need a decision: Bifrost OSS or Enterprise, `Authorization` vs `x-bf-vk`, the secure channel for delivering keys, and the org default mode (`defaults` or `enforce`).

### Items that need a human or a real environment
- T-031 AC2: push to GitHub, or open a PR, so ubuntu-latest CI runs `scripts/ci.sh`. Confirm the 5 POSIX symlink/race installer tests from T-019 report **passed**, not skipped. They have never run, because the dev host is Windows without a working WSL distro. **Do this first.**
- T-029: with a real Kilo, check whether a project-level Kilo config can override the global plugin options (org/project/repo/path/branch). Add the result to the Phase 0 checklist.
- T-025: in a real Azure DevOps org, confirm what `--valid-duration 0` means for build-validation expiry, and whether a platform-team author's own approval satisfies the required-reviewer group (`creatorVoteCounts`). Fix the policy script or contract if either differs.

### Remaining backlog worth doing later (recommended order)
1. T-031 (AC2 Linux confirmation first, then the post-re-check race test and the ADR-0012 / installer-cli wording)
2. F-017: placeholder allowlist. Do it if the shared repo gains writers outside the platform team.
3. T-008: make ci.sh fail when VERSION has no CHANGELOG section. Cheap guard.
4. T-023 together with T-024: branch-policy script idempotency, plus the `@` prefix rejection.
5. T-014 together with T-030: cache read through one handle, stale temp-file cleanup, cleanName bidi chars, stale comments.
6. T-022 / T-021: install.ps1 `.cmd` shim edge cases, and the NUL bytes in overview.md.
7. T-016 / T-010 / T-002 / T-020 / T-007 / T-012 / T-003 / T-004 / T-006: priority-4 hardening and test gaps. Bundle them with related changes.
8. Priority-5 items (T-009, T-011, T-015, T-017, T-018, T-026, T-027, T-028): optional polish.

## Files changed
- `factory/backlog.json`:
  - F-017 priority changed from 3 to 4, with a note.
  - Notes added to T-025, T-029 and T-031 (human or real environment needed).
- `factory/runs/cycle-0021/01-product-owner.md`: this report.

## Verification
- A Node round-trip check confirmed the serializer reproduces the original backlog.json byte for byte (CRLF, 2-space, ASCII escapes) before the edits were applied.
- After the edits: 0 items `in_progress` and 0 `todo` items with priority <= 3. F-012, F-013 and F-015 are unchanged.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/test/installer/install-sh.test.ts (T-019 AC-3) | The 5 POSIX race tests have never been executed | Linux CI run by a human (T-031 AC2) |

## Assumptions made (no human available)
- Lowering F-017 to 4 is acceptable. It is a security-team suggestion about a risk that was already accepted, not a vision capability, so the "nothing of priority <= 3 remains" condition is met honestly rather than by hiding vision scope.
- Environment-dependent items stay `todo` rather than `blocked`. They are valid work for a human. They are just not autonomous work.

## Follow-ups for the backlog
- None new.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0021/01-product-owner.md
summary: All non-skipped vision capabilities delivered (v0.0.1..v0.14.2); remaining backlog is low-value hardening or needs a human/real environment; factory stops
