# Product Owner report — cycle 0025 — (none): factory DONE, closing summary

## Inputs read
- `factory/VISION.md` (no `VISION_TEMPLATE_UNCHANGED` marker), `factory/backlog.json`, `factory/state.json` (cycle 25, last release v0.16.1)
- `CHANGELOG.md` (v0.14.1 .. v0.16.1)
- `factory/runs/cycle-0024/*` (T-035): PO, architect, security, review, PR, docs and release reports, plus the summary
- `factory/runs/cycle-0021/01-product-owner.md` (the previous DONE closing summary)
- `git status -sb` / `git log origin/main..main`: local `main` is 6 commits ahead of `origin/main`

## Work done
- **Decision: DONE.** No item selected, and nothing set to `in_progress`.
- **Why:**
  - The USER's Azure IP firewall requirement is fully delivered across three releases:
    - F-020 (v0.15.0): installer network pre-flight, run before any credential is sent.
    - F-021 and the F-022 docs (v0.16.0): plugin classification codes `network-unreachable` / `network-blocked` with hints.
    - T-035 (v0.16.1): the hint on the authenticated smoke lines, and HTTP 470 treated as blocked.
  - Cycle 0024 passed with 0 rework iterations. Security raised only 3 info notes and review only 2 info notes. Nothing at medium or above.
  - I checked every remaining candidate against the bar "valuable for the firewall scenario, or a security/correctness risk, AND achievable without a real environment". None passes:
    - **T-036 (formatLine guard).** Defence-in-depth only. No real `runSmoke` path produces a malformed report, and install-helper's try/catch already keeps exit code 4. Its other half (a conditional-access JSON 401/403 hint) needs real-environment evidence and a contract decision.
    - **T-034 (203 HTML sign-in).** Needs real-environment evidence.
    - **T-032 and T-033.** Test nits. The behaviour is already covered (13/13 mutations killed in cycle 0024).
    - **T-031.** AC2 needs a Linux CI run. AC1 and the doc wording are low value.
    - **T-029 and T-025.** Need a real Kilo install and a real Azure DevOps org.
    - **F-017 (placeholder allowlist).** Optional hardening for an accepted risk. The F-008 PR gate is the main control.
    - Everything else is priority 4-5 hygiene.
  - There are 0 `todo` items at priority 3 or above.
- **Backlog grooming:**
  - **T-036.** Added a cycle 0025 note: why it was not selected, and the cycle 0024 architect's optional suggestion of a pwsh child-process 470 smoke test.
  - **`_notes`.** Added a cycle 0025 entry recording DONE.
  - **No new items.** All cycle 0024 follow-ups are already captured: the formatLine guard and the conditional-access hint in T-036, the 203 case in T-034.
  - **F-012, F-013 and F-015** are untouched (blocked, SKIPPED by user instruction). Remote mode stays OFF.

## Closing summary for the user

### Delivered (22 releases, v0.0.1 .. v0.16.1)
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
| v0.14.1 | T-013 | Cache bound to the settings that produced it (`kilo-azdo-cache-v1` envelope) |
| v0.14.2 | T-019 | Installer hardening (CDPATH-safe helper lookup, symlink re-check plus O_NOFOLLOW, real Node version test) |
| v0.15.0 | F-020 | Installer smoke network pre-flight: anonymous origin probes of dev.azure.com and Bifrost before any credential is sent; `smoke network:` line; VPN / IP allow-list hint; exit code 4 |
| v0.16.0 | F-021 + F-022 | Plugin classifies failures of its remote fetch as `network-unreachable` / `network-blocked`, with fixed NETWORK / CREDENTIALS hints (BEHAVIOUR CHANGE: the code `network` became `network-unreachable`); firewall docs and runbook |
| v0.16.1 | T-035 | Hint also printed on the authenticated azdo/bifrost smoke lines (rule N1/N2/N3, at most once); Azure Firewall HTTP 470 treated as blocked (credential withheld; plugin reports `network-blocked`) |

T-005 was a CI/hygiene item shipped in cycle 4 without its own version.

### Skipped by the user's decision
These items have status `blocked`, and their notes say "SKIPPED by user instruction".
- **F-012:** create a Bifrost virtual key per engineer. The Architect's draft is in git stash "F-012 architect draft".
- **F-013:** bulk CSV import, list and disable of keys (offboarding).
- **F-015:** per-team config files. The plugin `path` option and the PR gate's `teams/*/kilo.jsonc` glob already allow team files. There is no dedicated example and no team-specific validation.
- **Remote mode** stays OFF.

To bring one of these back, set its status to `todo` and restart the loop.

### What remains MANUAL (needs a human or a real environment)
1. **Phase 0 checks** in `docs/platform-runbook.md`. Run them with 2 or 3 platform engineers before rollout.
   - A1: config mutated in Kilo's `config` hook reaches the provider and the model list.
   - A2: Kilo passes plugin tuple options to local-file plugins. If it does not, use the KILO_AZDO_* env vars.
   - A3: Bifrost exposes an OpenAI-compatible `/v1` that works with `@ai-sdk/openai-compatible` and Bearer `sk-bf-...`.
   - The Kilo CLI `/models` and the VS Code extension model list show the Bifrost models.
   - Kilo loads the `.ts` plugin from `~/.config/kilo/azdo/` exactly once, on macOS, Linux and Windows.
   - Bifrost rejects a disabled virtual key with 401.
2. **Azure firewall allow-list.** Follow the platform runbook (firewall section).
   - Configure the Azure IP firewall allow-list for the Bifrost origin `/` (as well as `/v1`), plus the VPN egress ranges. The installer's anonymous pre-flight probes the origin `/`, so the origin must be reachable, not just `/v1`.
   - Then verify from one machine on the VPN and one off it. The off-VPN machine should see `smoke network: fail bifrost-blocked|bifrost-unreachable` plus the hint, and exit code 4.
   - Do not treat HTTP 470 as authoritative evidence. It is a community-reported Azure Firewall deny status.
3. **T-031 AC2: Linux CI confirmation.** Push or open a PR so the ubuntu-latest CI runs `scripts/ci.sh`. Confirm that the 5 POSIX symlink/race installer tests from T-019 report **passed**, not skipped. They have never run, because the dev host is Windows.
4. **T-029.** With a real Kilo, check whether a project-level Kilo config can override the global plugin options (org/project/repo/path/branch).
5. **T-025.** In a real Azure DevOps org, confirm what `--valid-duration 0` means for build-validation expiry. Also confirm whether a platform-team author's own approval satisfies the required-reviewer group (`creatorVoteCounts`).
6. **Open vision questions:**
   - Bifrost OSS or Enterprise?
   - `Authorization` or `x-bf-vk`?
   - What is the secure channel for delivering keys?
   - Is the org default mode `defaults` or `enforce`?

### Unresolved: local `main` is ahead of `origin/main`
- `git status` reports `main...origin/main [ahead 6]`. The 6 commits are:
  - T-013 (v0.14.1)
  - T-019 (v0.14.2)
  - the cycle 0021 records
  - F-020 (v0.15.0)
  - F-021 (v0.16.0)
  - T-035 (v0.16.1)
- The factory runs in local mode and has **pushed nothing**. `origin` (`github.com/MOhammedRiaad/KiloCode-Remote-Config`) still ends at v0.14.0 (F-016).
- **Your decision:** push `main`, ideally through a PR. The Linux CI run in step 3 needs that push anyway. Release tags/versions v0.14.1 .. v0.16.1 exist only locally until then.

### Worthwhile later items (recommended order)
1. **T-031 AC2:** Linux CI confirmation, which comes with the push above. After that, the post-re-check race test and the ADR-0012 / installer-cli wording.
2. **T-034 and the conditional-access half of T-036.** Once a real 203 HTML sign-in and a JSON 401/403 conditional-access (VS403463-style) response have been captured, decide on a dedicated hint. This is the most relevant remaining improvement for the firewall scenario.
3. **F-017:** the placeholder allowlist. Do this if the shared repo gains writers outside the platform team.
4. **T-008:** make ci.sh fail when VERSION has no CHANGELOG section. A cheap guard.
5. **T-023 together with T-024:** branch-policy script idempotency, plus the `@` prefix rejection.
6. **T-014 together with T-030:** cache read through one handle, stale temp-file cleanup, bidi characters in cleanName, stale comments.
7. **T-036 (the formatLine guard half), T-032 and T-033:** smoke and plugin test hardening. Bundle them together.
8. **T-022 and T-021:** install.ps1 `.cmd` shim edge cases, and the NUL bytes in overview.md.
9. **Remaining priority 4 items:** T-016, T-010, T-002, T-020, T-007, T-012, T-003, T-004, T-006.
10. **Priority 5 polish:** T-009, T-011, T-015, T-017, T-018, T-026, T-027, T-028.

## Files changed
- `factory/backlog.json`:
  - a cycle 0025 note on T-036
  - a cycle 0025 `_notes` entry
- `factory/runs/cycle-0025/01-product-owner.md`: this report.

## Verification
- **Serializer check before editing.** A Node round-trip confirmed that the serializer reproduces the original `factory/backlog.json` byte for byte (CRLF, 2-space indent, ASCII `\u` escapes).
- **Counts after editing:** 0 items `in_progress`, and 0 `todo` items with priority 3 or above.
- **Diff:** `git diff --stat factory/backlog.json` shows 4 insertions and 2 deletions. Only the T-036 notes and `_notes` changed.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | (git) | Local `main` is 6 commits ahead of `origin/main`. Releases v0.14.1..v0.16.1 have not been pushed. | A human decides whether to push. |
| 2 | info | backend/test/installer/install-sh.test.ts (T-019 AC-3) | The 5 POSIX race tests have never run. | Linux CI run (T-031 AC2) |

## Assumptions made (no human available)
- **No new cycle for T-036 or the other nits.** Their value is too low to justify a full 8-agent cycle. This follows the user's instruction to reply DONE unless something is valuable or risky and achievable without a real environment.
- **Environment-dependent items stay `todo`, not `blocked`.** They are valid work for a human, just not autonomous work.

## Follow-ups for the backlog
- None new.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0025/01-product-owner.md
summary: Azure IP firewall requirement fully delivered (v0.15.0..v0.16.1); all non-skipped vision capabilities done; remaining items are low-value nits or need a real environment; factory stops
