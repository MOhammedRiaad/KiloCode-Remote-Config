# Product Owner report — cycle 0010 — F-009: Personal config template

## Inputs read
- `factory/VISION.md` (FR-16, FR-17, Appendix B, C3)
- `factory/backlog.json`
- `factory/runs/cycle-0009/summary.md`, `04-security.md`, `05-review.md` (follow-ups)
- `backend/validator/kilo-config-rules.ts` (exported API: `validateConfigText`, `SECRET_PATTERN = /sk-bf-[a-z0-9]/i`, rule ids)

## Work done
- Grooming: the cycle 0009 follow-ups were already recorded by the cycle 0009 PO and the release step: T-016 (sanitiser and Unicode format characters), T-017 (test nits), notes on T-002 (recursive rule-5 scan), T-011 (`fileTooLargeFinding` in the contract), F-008 (`--allowed-hosts` in the pipeline) and F-009 (filter the findings, placeholder key). Cycle 0009 had no high or critical security findings, so priorities stay as they are. No item failed in 2 or more cycles, so nothing is blocked.
- Selection: F-009 (priority 2) is the highest-priority `todo` item whose dependencies are all `done` (F-001 and F-007). The other open items are priority 3 or lower. F-009 is set to `in_progress`.
- Refinement: I made the description concrete (file location, example values, no `pat`, a comment for FR-17, how to filter the validator findings). I replaced the 4 loose ACs with 7 Given/When/Then ACs that automated tests can check. Scope: backend only.
- Vision status: not DONE. C1 pipeline (F-008), C5 installers (F-010/F-011), C6 provisioning (F-012/F-013), E2E (F-014) and docs (F-016) are still open.

Selected item:

```json
{
  "id": "F-009",
  "title": "Personal config template",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": { "backend": true, "frontend": false },
  "depends_on": ["F-001", "F-007"],
  "description": "FR-16 / FR-17, C3. Ship the personal config template matching VISION Appendix B as a JSONC file under backend/ (PO default: backend/personal-config/kilo.jsonc; Architect may pick another path under backend/ and record it). It is the file the installers (F-010/F-011) copy to `~/.config/kilo/kilo.jsonc`. Content: `$schema`, one `plugin` entry `[\"./azdo/azdo-remote-config.ts\", {org, project, repo, path, branch, mode}]` with example values (contoso / platform / kilo-config / /kilo.jsonc / main / defaults; org, project and repo written explicitly because repo has no default since contract 0.5.0; no `pat` option, PAT and az login come from env/az per FR-3), and `provider.bifrost.options.apiKey` holding a placeholder (PO default `sk-bf-<your-virtual-key>`) that does NOT match the validator's SECRET_PATTERN. A comment states the file belongs in the global config directory only, never in a project directory (FR-17). The template legitimately contains `apiKey`, so it is NOT checked with the full shared-config rule set: tests reuse the F-007 validator library (`validateConfigText` from backend/validator/kilo-config-rules.ts) and filter its findings (secret-pattern must be absent; api-key and plugin-ignored are expected for this file). No change to the plugin file or its export surface, and no change to the validator's rules or CLI behaviour. Tests live under backend/test/ and run via `bash scripts/ci.sh`. Zero runtime npm deps (FR-11).",
  "acceptance_criteria": [
    "Given the shipped template file, When it is read and parsed with the plugin's `__internals.parseJsonc`, Then it parses without error, the root is a plain object whose top-level keys are exactly `$schema`, `plugin` and `provider`, `$schema` equals `https://app.kilo.ai/config.json`, and the raw text contains a comment mentioning `~/.config/kilo/kilo.jsonc` and that the file must not be placed in a project directory (FR-17).",
    "Given the parsed template, When `plugin` is inspected, Then it is an array with exactly one entry, that entry is a two-element array whose first element is `./azdo/azdo-remote-config.ts` and whose second element is an object with exactly the keys org, project, repo, path, branch and mode (no `pat`), each a non-empty string, with path starting with `/` and mode equal to `defaults` or `enforce`.",
    "Given the template's plugin options, When passed to `__internals.resolveSettings` with an empty injected env, Then `missing` is empty, `warnings` is empty, and settings.org/project/repo/path/branch/mode equal the template's values (the template alone is a complete configuration).",
    "Given the parsed template, When `provider` is inspected, Then its only key is `bifrost`, `provider.bifrost` has only the key `options`, `provider.bifrost.options` has only the key `apiKey`, and apiKey is a string that starts with `sk-bf-` but does not match the validator's exported `SECRET_PATTERN` (e.g. `sk-bf-<your-virtual-key>`), so no baseURL, models or other shared values are duplicated locally.",
    "Given the template text, When validated with the F-007 library `validateConfigText`, Then there is no `secret-pattern` finding and no error finding other than the expected `api-key` rule; and Given a copy of the template text with the placeholder replaced by `sk-bf-AbCdEf1234567890`, When validated the same way, Then a `secret-pattern` finding is reported and no finding field contains `AbCdEf1234567890` (the check is not vacuous).",
    "Given the template as the local Kilo config and the shipped shared example (F-007 backend/shared-config/kilo.jsonc) parsed with parseJsonc, When `__internals.mergeConfig` runs in `defaults` and in `enforce` mode, Then provider.bifrost.options.apiKey still equals the template placeholder, provider.bifrost.options.baseURL and the models `azure/gpt-5` and `azure/gpt-5-mini` are added from the shared file, and the local `plugin` and `$schema` values are unchanged.",
    "Given the repository after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0 and runs the new template tests, backend/package.json has no runtime `dependencies`, backend/plugin/azdo-remote-config.ts is unchanged, and the validator CLI behaviour on the shared example is unchanged (exit 0)."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json`: F-009 set to `in_progress`, description refined, ACs rewritten (7).
- `factory/runs/cycle-0010/01-product-owner.md`: this report.

## Verification
- Checked that all F-009 dependencies (F-001 and F-007) are `done` in the backlog.
- Checked that `SECRET_PATTERN` is `/sk-bf-[a-z0-9]/i`. The placeholder `sk-bf-<your-virtual-key>` therefore does not match, because `<` follows `sk-bf-`.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Template path defaults to `backend/personal-config/kilo.jsonc`. It sits next to `backend/shared-config/`, and the installers will copy it later. The Architect may change it.
- Example values follow Appendix B (contoso/platform/kilo-config, mode `defaults`). The vision leaves the organisation's default mode open, so `defaults` is the conservative choice.
- The template has no `pat` option. PATs belong in env vars or az login (FR-3), so putting a PAT field in the template would invite storing secrets in the file.
- The template does not need to pass the full validator CLI. It legitimately carries `apiKey` and `plugin`. Only the secret-pattern check applies, as the cycle 0009 note says.

## Follow-ups for the backlog
- None new.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0010/01-product-owner.md
summary: Selected F-009 Personal config template (backend only, 7 ACs); vision not yet delivered
