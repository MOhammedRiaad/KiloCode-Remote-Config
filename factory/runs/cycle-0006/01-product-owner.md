# Product Owner report — cycle 0006 — F-004: Plugin: settings resolution (options, env, defaults)

## Inputs read
- factory/VISION.md (FR-1, FR-3, FR-8; no template marker present)
- factory/backlog.json, factory/state.json (cycle 6, last release v0.3.0)
- CHANGELOG.md, VERSION, `git log` / `git show HEAD:CHANGELOG.md`
- factory/runs/cycle-0005/* (summary, security, review, docs, ci-prepare, ci-ship); earlier cycles' follow-ups already captured in the backlog (T-002, T-004, T-006, T-007, F-017)
- docs/architecture/ADR-0002-plugin-module-shape.md (the `__internals` seam), backend/plugin/azdo-remote-config.ts (exports)

## Work done
- Checked the vision is defined. 4 of 17 vision items are done (T-001, F-001, F-002, F-003). The vision is not yet delivered.
- Follow-ups from cycle 0005:
  - Security finding 1 (low) and findings 2 and 6 (info), plus Review findings 1 to 3: already in T-007 and T-006.
  - Security finding 3 (fixed log message on a frozen config): already an AC on F-006.
  - Security finding 5 (allow-list for baseURL hosts): already an AC on F-007.
  - Docs follow-up (update docs when F-006 wires the hook): handled by the docs writer in F-006.
  - No high or critical findings, so nothing new gets priority 1.
- **New item T-008** (chore, priority 3): VERSION is 0.3.0 and commit 971158c shipped v0.3.0, but CHANGELOG.md on main has no `[0.3.0]` section. This is the same problem T-005 fixed for 0.1.0, so T-008 also asks for a release-prepare guard.
- No item has failed in 2+ cycles, so nothing is marked blocked.
- Selection: the candidates were the `todo` items at priority 2 whose dependencies are done: F-004, F-007 and F-009. **F-004** was picked because it sits on the critical path F-004 -> F-005 -> F-006, and F-006 makes the plugin actually work (AC-2/3/4/8/9).
- Tightened F-004 so it can be tested automatically:
  - It becomes a pure `__internals.resolveSettings` helper with an injectable env.
  - Exact env var names, defaults and precedence are spelled out.
  - It returns `missing` and `warnings` instead of logging, because logging is wired in F-006.
  - Added ACs that the PAT value never leaks, for safe handling of malformed options, and for prototype-pollution safety.
  - The AZDO_PAT / AZURE_DEVOPS_EXT_PAT / az fallback stays in F-005.
- Set F-004 `status: in_progress`.

Selected item (copy verbatim):

```json
{
  "id": "F-004",
  "title": "Plugin: settings resolution (options, env, defaults)",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "T-001"
  ],
  "description": "FR-1 / FR-8 (and the settings half of FR-3). Pure helper exposed as `__internals.resolveSettings(options, deps?)` (ADR-0002 seam) inside the single plugin file backend/plugin/azdo-remote-config.ts. Resolves org, project, repo, path, branch, mode, pat, timeoutMs with precedence: plugin option (non-empty string / finite number) > KILO_AZDO_* env var (KILO_AZDO_ORG, KILO_AZDO_PROJECT, KILO_AZDO_REPO, KILO_AZDO_PATH, KILO_AZDO_BRANCH, KILO_AZDO_MODE, KILO_AZDO_PAT, KILO_AZDO_TIMEOUT_MS) > built-in default (path `/kilo.jsonc`, branch `main`, mode `defaults`, timeoutMs 5000; org/project/repo/pat have no default). Returns `{ settings, missing, warnings }` where `missing` lists required setting names (org, project, repo) that are unset and `warnings` are fixed messages naming settings only, never values. Env is injectable (default process.env, own properties only). The AZDO_PAT / AZURE_DEVOPS_EXT_PAT fallback and the az token belong to F-005; logging through Kilo's logger is wired in F-006. Not yet wired into the server/config hook. Zero runtime deps (FR-11).",
  "acceptance_criteria": [
    "Given options `{org:\"opt\"}` and an injected env with KILO_AZDO_ORG=env, When `__internals.resolveSettings` runs, Then settings.org equals `opt`; and Given no `branch` option and KILO_AZDO_BRANCH=dev, Then settings.branch equals `dev` (option > env precedence verified for each of org, project, repo, path, branch, mode, pat, timeoutMs).",
    "Given no options (undefined) and an empty env, When settings resolve, Then path is `/kilo.jsonc`, branch is `main`, mode is `defaults`, timeoutMs is 5000, org/project/repo/pat are undefined, and `missing` deep-equals [\"org\",\"project\",\"repo\"].",
    "Given mode `enforce` from options or from KILO_AZDO_MODE, When settings resolve, Then mode is `enforce`; and Given an invalid mode (e.g. `force`, `ENFORCE`, a number) from options or env, When settings resolve, Then mode is `defaults` and `warnings` contains an entry naming `mode`.",
    "Given timeoutMs 3000 as an option number, or KILO_AZDO_TIMEOUT_MS=`2500` in env, When settings resolve, Then timeoutMs is 3000 or 2500 respectively; and Given a non-numeric, zero, negative, NaN, Infinity or non-integer value (option or env), When settings resolve, Then timeoutMs is 5000 and `warnings` contains an entry naming `timeoutMs`.",
    "Given options that are null, an array, a string or a number, or option values of the wrong type (number for org, object for branch) or empty/whitespace-only strings, When settings resolve, Then no error is thrown and each such value is ignored so the env value or default applies; string values are trimmed, and a path without a leading `/` (e.g. `teams/a/kilo.jsonc`) is normalised to `/teams/a/kilo.jsonc`.",
    "Given a `pat` option and KILO_AZDO_PAT both set, When settings resolve, Then settings.pat equals the option value; and Given any input containing a pat value (valid or wrongly typed), When `missing`, `warnings` and any thrown error are inspected, Then none of them contains the pat value.",
    "Given inputs, When settings resolve, Then the options object and env are not mutated, an env created via Object.create({KILO_AZDO_ORG:\"inh\"}) does not supply org (own properties only), and own keys `__proto__`/`constructor`/`prototype` in options do not pollute Object.prototype or the returned settings.",
    "Given the plugin package after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0, backend/package.json has no runtime `dependencies`, and the only new export surface is the `resolveSettings` key on `__internals`."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json`: F-004 set to in_progress with a sharper description and 8 ACs. Added T-008.
- `factory/runs/cycle-0006/01-product-owner.md`: this report.

## Verification
- `node` reload of factory/backlog.json: valid JSON. 25 items. Exactly one item (F-004) is `in_progress`.
- F-004's dependency T-001 is `done` (cycle 2).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | CHANGELOG.md:3 | v0.3.0 (F-003) was released, but CHANGELOG has no `[0.3.0]` section | T-008: CI releaser backfills it with the next release |

## Assumptions made (no human available)
- Env var names follow the `KILO_AZDO_<SETTING>` convention from FR-1: `KILO_AZDO_TIMEOUT_MS` for timeoutMs and `KILO_AZDO_PAT` for pat. The vision-named `AZDO_PAT` / `AZURE_DEVOPS_EXT_PAT` fallbacks belong to F-005 (FR-3).
- org, project and repo have no sensible built-in default. They are reported in `missing`, and F-006 will skip the fetch and use the cache or local config.
- Mode values are case-sensitive (`defaults` / `enforce` only). Anything else falls back to `defaults`, which is the conservative choice for local values.
- No upper cap on timeoutMs. FR-8 says "configurable", and inventing a limit would go beyond the vision.
- The helper returns warnings instead of calling Kilo's logger. Logging is wired in F-006, which keeps F-004 pure and easy to test.

## Follow-ups for the backlog
- T-008 added (CHANGELOG 0.3.0 backfill plus a release guard).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0006/01-product-owner.md
summary: Selected F-004 (plugin settings resolution, backend only, 8 ACs); added T-008 for the missing CHANGELOG 0.3.0 entry.
