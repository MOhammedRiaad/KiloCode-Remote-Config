# Product Owner report — cycle 0019 — T-013: Bind cache to the settings that produced it

## Inputs read
- `factory/VISION.md` (FR-7 cache, AC-3/AC-4, reliability NFR "offline engineers get the last cached config")
- `factory/backlog.json`, `factory/state.json`, `CHANGELOG.md` (0.0.1 to 0.14.0, no gaps)
- `factory/runs/cycle-0018/*` (summary, security, security re-run, review, release-prepare)
- `backend/plugin/azdo-remote-config.ts` cache/hook section (`writeCache`, `readCache`, `executeHook`) to size the item

## Work done
- Vision check: all vision capabilities are `done` except F-012, F-013 and F-015. Those stay `blocked` with "SKIPPED by user instruction". I did not touch, split or replace them.
- Cycle 0018 follow-ups are already tracked as T-027 (sync the docs-check contract) and T-028 (dedupe user-guide). The security re-run suggested adding a PAT/bearer pattern to the docs gate. That is info-level and I left it out because the repo gitleaks job already covers it.
- Decision: option (a), continue. 28 todo items remain. Several are security-sourced and affect users. They are not negligible.
- Selected **T-013**. It is the only remaining item where a user can get wrong behaviour without noticing: on fetch failure, a cache written for another org, repo, path or branch is applied. That can push the wrong models or providers onto an engineer. Priority raised from 3 to 2 and status set to `in_progress`. Replaced the 2 vague ACs with 7 testable Given/When/Then ACs.
- Split the part of T-013 that cannot be tested into a new item, **T-029** (priority 4, todo, depends on T-013). It covers checking whether a Kilo project-level config can override the global plugin options (ADR-0009 accepted risk). This needs a real Kilo, so it goes on the Phase 0 runbook checklist.
- I considered T-008 (CHANGELOG guard). It costs little but has no user impact, and the changelog currently has no gaps, so it stays as the next candidate.

Selected item (copy verbatim):

```json
{
  "id": "T-013",
  "title": "Bind cache to the settings that produced it",
  "type": "security",
  "priority": 2,
  "status": "in_progress",
  "scope": { "backend": true, "frontend": false },
  "depends_on": ["F-006"],
  "description": "Cycle 0008 security low 1: the cache (~/.cache/kilo-azdo/remote-config.json, FR-7) is one fixed file not linked to org/project/repo/path/branch, so on fetch failure a cache written for another org or repo can be applied. Store a non-secret settings fingerprint (org, project, repo, path, branch; never the PAT or any token) with the cached config and verify it on read; apply the cache only on an exact match. Scope (cycle 0019): plugin cache write/read and hook fallback in backend/plugin/azdo-remote-config.ts, its tests, and the plugin-interface contract section 2f (cache file format). The ADR-0009 question (can a Kilo project-level config override the global plugin options) is split out to T-029 because it needs a real Kilo and cannot be verified by an automated test.",
  "acceptance_criteria": [
    "Given a cache written by a successful fetch with settings for org A / project P / repo R, When the hook runs with settings that differ in any one of org, project, repo, path or branch and the fetch fails, Then the cached config is NOT merged (config object unchanged), and an error-level log with a fixed message (e.g. reason `cache-mismatch`) is written that contains none of the settings values.",
    "Given a cache written for settings S, When the hook runs again with identical settings S and the fetch fails, Then the cached config is applied exactly as before this change (AC-3 / FR-7 behaviour preserved) and the existing 'using cached config' warning is logged.",
    "Given a successful fetch with a PAT supplied via options or env, When the cache file is written, Then the file contains the binding fields (org, project, repo, path, branch) and the shared config, and does NOT contain the PAT value, any Authorization/bearer token, or the az access token (asserted by searching the written bytes for the test secret values).",
    "Given a legacy cache file in the pre-change format (bare shared-config object with no binding) or a cache whose binding is malformed (missing field, wrong type), When the fetch fails, Then the cache is treated as unusable (not applied, never throws), and When the next fetch succeeds, Then the cache is rewritten in the new bound format.",
    "Given required settings are missing (org, project or repo unset), When the hook runs and a cache exists, Then the cache is not applied (no binding can be verified), the existing missing-settings warning is logged, and the hook completes without throwing with the config unchanged.",
    "Given binding values that differ only by letter case or surrounding whitespace, When the fetch fails, Then the outcome follows the comparison rule documented in the plugin-interface contract (exact match on the values as normalised by resolveSettings) and a test pins that rule.",
    "Given the full suite, When `bash scripts/ci.sh` runs, Then it exits 0, the plugin remains one TypeScript file with zero runtime npm dependencies (FR-11), and the e2e simulated startup test still passes its cache-fallback scenario."
  ],
  "source": "security",
  "cycle_done": null,
  "notes": "Selected in cycle 0019. All vision features are done or SKIPPED by user instruction (F-012, F-013, F-015); this is the highest-value remaining security follow-up: a stale cache from another org/repo can silently apply the wrong models/providers. Not applying the cache when settings are missing is a deliberate conservative PO decision; record it in the contract and CHANGELOG. Versioning: patch (security fix)."
}
```

## Files changed
- `factory/backlog.json`: T-013 set to `in_progress`, priority 2, description and 7 ACs rewritten. New item T-029 added (split from T-013). No other items changed.

## Verification
- `python -c "json.load(...)"` on `factory/backlog.json` parses it as valid JSON (47 items).
- `git diff factory/backlog.json` shows changes only to T-013 and the new T-029. The existing escaped characters (`\ud800`, `﻿`, `\u0000`) in other items are kept byte-for-byte.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Missing required settings now means the cache is **not** applied. Before, it was applied. Rationale: with no settings, the binding cannot be checked. Missing settings means the install is misconfigured, not that the engineer is offline, so vision AC-3 ("AzDO unreachable and a cache exists") still holds whenever settings are present.
- Legacy caches without a binding are treated as unusable. The next successful fetch rewrites them, so the cost is at most one offline start without the shared config right after upgrading.
- The binding stores only non-secret identifiers (org, project, repo, path, branch). The Architect picks the exact file format (an envelope or a hash) and the case-sensitivity rule, and records both in contract section 2f.
- Version bump is a patch (security fix to existing behaviour), unless the Architect decides otherwise.

## Follow-ups for the backlog
- T-029 (added): check in Phase 0 whether a Kilo project-level config can override the plugin options.
- Next candidates after this cycle: T-019 (installer hardening), T-024 (reject a leading '@' in the policy script), T-002 (FR-11 lint against import evasions), F-017 (placeholder allowlist), T-008 (CI guard that VERSION has a matching CHANGELOG section).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0019/01-product-owner.md
summary: Selected T-013 (security, backend) - bind the config cache to org/project/repo/path/branch so a cache from another repo is never applied; 7 testable ACs; split T-029 out.
