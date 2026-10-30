# Product Owner report — cycle 0005 — F-003: Plugin: in-place merge with defaults/enforce modes

## Inputs read
- factory/VISION.md (no template marker; vision defined)
- factory/backlog.json, factory/state.json (cycle 5, last release v0.2.0)
- CHANGELOG.md (0.0.1, 0.1.0, 0.2.0)
- factory/runs/cycle-0004/summary.md, 08-security-rework1.md, 09-review.md, 11-docs.md, 12-ci-prepare.md, 13-ci-ship.md
- docs/architecture/ADR-0002-plugin-module-shape.md (the `__internals` test seam)
- backend/plugin/azdo-remote-config.ts (checked the BOM constant and the current export surface)

## Work done
- Groomed the backlog against the cycle 0004 follow-ups:
  - Security finding 2 (accepted risk: shared config can read any env var or file) is already tracked as F-017 (priority 3).
  - Security info finding 5 (post-read length check, TOCTOU, /proc) and review info findings 1 and 2 are already tracked as T-006. I added their source to its description.
  - The review note about case-insensitive `process.env` on Windows is already AC 8 of F-006.
  - T-004: the BOM constant is already the ASCII escape `"\uFEFF"` (line 43, no raw U+FEFF in the file). I updated the description so the remaining work is the CI check for invisible characters.
  - There are no high or critical security items, no failed releases and no items that failed in 2 or more cycles, so nothing is blocked or split.
- Selected **F-003** (priority 1, todo; its only dependency T-001 is done) and set it to `in_progress`. It is the last open priority-1 item, and F-006 (the wiring) depends on it.
- Rewrote its acceptance criteria to 8 concrete, automatable Given/When/Then statements. They pin the `__internals.mergeConfig` seam, array handling, aliasing, apiKey protection, prototype pollution and the CI/FR-11 gate.

Selected item (copy verbatim):

```json
{
  "id": "F-003",
  "title": "Plugin: in-place merge with defaults/enforce modes",
  "type": "feature",
  "priority": 1,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "T-001"
  ],
  "description": "FR-6 / AC-6 / AC-7. Pure helper exposed as `__internals.mergeConfig(target, shared, mode)` (ADR-0002 seam) inside the single plugin file backend/plugin/azdo-remote-config.ts. Deep-merges the (already parsed and placeholder-resolved) shared config into Kilo's resolved config object, mutating `target` in place. Plain objects are merged recursively; arrays and scalars are leaf values whose conflict is decided by mode (`defaults`: local wins; `enforce`: shared wins); a key absent locally is added from shared in both modes. Top-level `$schema` and `plugin` in the shared config are ignored. Any `apiKey` key at any depth in the shared config is never applied (local apiKey always preserved; vision AC-6, FR-12). Values copied from shared are deep-cloned so target never aliases shared. An unrecognised mode is treated as `defaults` (conservative). Not yet wired into the config hook (F-006). Zero runtime deps (FR-11).",
  "acceptance_criteria": [
    "Given local `{model:'a'}` and shared `{model:'b', small_model:'s'}`, When `__internals.mergeConfig` runs in `defaults` mode, Then target.model equals `a` and target.small_model equals `s` (shared-only keys are added).",
    "Given local `{model:'a', provider:{bifrost:{options:{baseURL:'L'}}}}` and shared `{model:'b', provider:{bifrost:{options:{baseURL:'S'}}}}`, When merged in `enforce` mode, Then target.model equals `b` and target.provider.bifrost.options.baseURL equals `S`; and When merged in `defaults` mode, Then both local values are kept (AC-7).",
    "Given local `provider.bifrost.options.apiKey = 'sk-bf-local'` and a shared provider.bifrost block whose options contain `apiKey: 'sk-bf-shared'` plus `baseURL`, When merged in `defaults` and in `enforce` mode, Then apiKey still equals `sk-bf-local`, baseURL is merged per mode, and with a local config that has no apiKey the shared apiKey is not added (AC-6).",
    "Given local keys absent from the shared file at top level and nested (e.g. `provider.other`, `provider.bifrost.options.headers`, `agent.x`), When merged in either mode, Then those keys and their values are unchanged.",
    "Given a shared config with top-level `$schema` and `plugin`, When merged in either mode, Then the local `$schema` and `plugin` values are unchanged, and when absent locally they are not added.",
    "Given a target object, When merged, Then the function mutates and keeps the same target reference (including existing nested object references such as target.provider), the shared input is not mutated, and mutating a nested object or array in shared after the merge does not change target.",
    "Given arrays or type conflicts (local `instructions:['a']` vs shared `['b','c']`; local object vs shared string), When merged, Then arrays are replaced wholesale (never concatenated) and conflicts resolve by mode (`defaults` keeps local, `enforce` takes shared), and an unrecognised mode behaves as `defaults`.",
    "Given a shared config parsed from JSON containing own keys `__proto__`, `constructor` or `prototype` at top level and nested, When merged, Then Object.prototype is not polluted and no such key alters target's prototype; and When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0, backend/package.json has no runtime `dependencies`, and the only new export surface is the `mergeConfig` key on `__internals`."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json`: F-003 is now in_progress and its description and acceptance criteria are refined. The T-004 and T-006 descriptions are updated.
- `factory/runs/cycle-0005/01-product-owner.md`: this report.

## Verification
- `node -e "require('./factory/backlog.json')"` parses. Exactly 1 item is in_progress, and F-003 has 8 acceptance criteria.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- **apiKey from shared is never applied, at any depth, in either mode.** Vision AC-6 requires the local apiKey to stay unchanged, and FR-12/FR-13 forbid apiKey in C1. Dropping it is the conservative reading and defends in depth if the validator is bypassed.
- **Arrays are leaf values and are replaced wholesale per mode, never concatenated.** This matches FR-6's "local wins / remote wins" semantics and avoids duplicated entries.
- **A key absent locally is added from shared in both modes.** Otherwise `defaults` mode could never deliver the shared config.
- **An unrecognised mode is treated as `defaults`.** This is consistent with F-004 AC 4. Settings validation itself stays in F-004.
- **Values copied from shared are deep-cloned.** Kilo may mutate its config later, and the cached or shared object must not be aliased.
- The helper is pure and not yet wired into the config hook. The wiring is F-006, following the F-001 and F-002 pattern.

## Follow-ups for the backlog
- None new. The next candidates after F-003 are F-004 (priority 2), F-007 and F-009.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0005/01-product-owner.md
summary: Selected F-003 (in-place merge, defaults/enforce) with 8 testable acceptance criteria; backlog groomed with cycle 0004 follow-ups
