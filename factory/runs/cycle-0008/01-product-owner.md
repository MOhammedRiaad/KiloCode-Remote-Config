# Product Owner report — cycle 0008 — F-006: Plugin: cache, fallback, logging and never-crash wiring

## Inputs read
- `factory/VISION.md` (FR-6 to FR-11, startup sequence, AC-3/4/6/7/8/9, section 8 security/reliability)
- `factory/backlog.json`, `factory/state.json` (cycle 8, last release v0.5.0)
- `factory/runs/cycle-0007/*` (summary, security, review, architect, PR, docs and release-prepare reports, plus the cycle 0007 PO report)

## Work done
- The vision is defined (no template marker). Done so far: T-001, F-001 to F-005, T-005. No items failed or are blocked.
- Cycle 0007 follow-ups were already in the backlog: T-010 (Windows az process tree and a test for the default runner; security low 1, info 3, review info 1 and 2) and T-011 (MAX_EMPTY_CHUNKS in the contract; review info 3). Security info 2 needs no action. Security info 4 (trust boundary) was already noted on F-006 and is now an AC. No high or critical findings, so no priority changes.
- **Selected F-006.** It is the highest-value priority-2 `todo` item, and its dependencies (F-001, F-002, F-003, F-005, plus F-004, which I added explicitly) are all done. It is the critical path: until it lands the plugin does nothing at runtime, and F-010, F-014 and F-015 depend on it. F-007 and F-009 are also priority 2 and ready, but they do not unblock as much.
- Rewrote F-006 from 10 loosely worded ACs into 8 testable Given/When/Then criteria. This folds in the cycle 0006 logging notes (missing settings skip the fetch; warnings at warn level; settings never logged as an object) and the cycle 0007 trust boundary (an ADR on which config layers may supply settings; fetched and cached content validated before merge).
- Moved the Windows case-insensitive env AC into a new item, T-012 (priority 4, depends on F-006), so F-006 stays at 8 ACs.

Selected item (copy verbatim):

```json
{
  "id": "F-006",
  "title": "Plugin: cache, fallback, logging and never-crash wiring",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-001",
    "F-002",
    "F-003",
    "F-004",
    "F-005"
  ],
  "description": "FR-7 / FR-9 / FR-10 / AC-3 / AC-4 / AC-6 / AC-7 / AC-8 / AC-9, startup steps 2-6. Wire the shipped helpers (resolveSettings, fetchRemoteConfig, parseJsonc, resolvePlaceholders, mergeConfig) into the plugin's exported `config` hook inside the single file backend/plugin/azdo-remote-config.ts. Flow: resolve settings from plugin options + env; if `missing` is non-empty skip the fetch (log setting names only) and use the cache path; otherwise fetch; parse and validate the fetched text (root must be a plain object); on success write the cache, on any failure read the cache; resolve placeholders on the chosen config; merge in place with settings.mode. Cache: `<home>/.cache/kilo-azdo/remote-config.json`, holding the parsed shared config BEFORE placeholder resolution (PO decision: resolved {env:}/{file:} values may be secrets and must never be written to disk); directory created if missing; file mode 0600 on POSIX; written atomically (temp file + rename) so a crash never leaves a half-written cache; the cache content is validated on read exactly like fetched content. Logging goes through Kilo's logger with `service: azdo-remote-config` (Architect decides the exact Kilo logger API and keeps an injectable logger seam for tests); only fixed messages, setting names, error codes and placeholder names are logged, never values, and `settings` is never passed to the logger as an object. Trust boundary (cycle 0007 security info 4): the Architect records in an ADR which Kilo config layers may supply org/project/repo/path/pat and that fetched and cached content is treated as untrusted input (validated before merge; apiKey never applied, already enforced by mergeConfig). Deps (home dir, fs, fetch, env, runAz, logger) are injectable; tests never touch the real home directory or network. The Windows case-insensitive process.env note moved to T-012. Zero runtime npm deps (FR-11).",
  "acceptance_criteria": [
    "Given complete settings in plugin options, a fake fetch returning a shared JSONC with comments and `{\"model\":\"shared\",\"small_model\":\"s\",\"provider\":{\"bifrost\":{\"options\":{\"baseURL\":\"https://b/v1\",\"apiKey\":\"sk-bf-shared\"}}}}`, and a Kilo config `{model:'local', provider:{bifrost:{options:{apiKey:'sk-bf-local'}}}}`, When the plugin's `config` hook runs in `defaults` mode, Then the same config object is mutated in place with model `local`, small_model `s`, baseURL `https://b/v1` and apiKey `sk-bf-local`; and in `enforce` mode model becomes `shared` while apiKey stays `sk-bf-local` (AC-6, AC-7).",
    "Given a successful fetch and a fake home directory without `.cache/kilo-azdo/`, When the hook runs, Then `<home>/.cache/kilo-azdo/remote-config.json` is created containing the parsed shared config with placeholders still unresolved (no resolved env/file value is written to disk), the write is atomic (temp file + rename), and on POSIX the file mode is 0600; and an info log with service `azdo-remote-config` states the remote source was used.",
    "Given the fetch fails (e.g. timeout or http-500) and a valid cache file exists, When the hook runs, Then the cached config is placeholder-resolved and merged into the config, the cache is not overwritten, and a warn-level log with service `azdo-remote-config` names the fixed error code (AC-3).",
    "Given the fetch fails and no cache exists, or the cache file is corrupt, not JSON, or has a non-object root, When the hook runs, Then the config deep-equals its original value, an error-level log is written with a fixed message, and a corrupt cache is never merged (AC-4).",
    "Given resolved settings with `missing` non-empty, When the hook runs, Then neither fetch nor the az runner is called, the log names only the missing setting names (e.g. `org`), the cache fallback of the previous criteria applies, and each resolveSettings warning is logged at warn level; and Given fetched text that is invalid JSONC or whose root is not a plain object (array, string, number, null), When the hook runs, Then it is neither merged nor cached and the cache fallback applies.",
    "Given a shared file containing `\"x\": \"{env:MISSING}\"` and `\"y\": \"{env:SECRET_VAR}\"` with SECRET_VAR set to `s3cr3t-value`, When the hook runs, Then config.x is not set, config.y is `s3cr3t-value`, and the logs name `env:MISSING` but contain neither `s3cr3t-value` nor any other placeholder value (AC-8).",
    "Given a run with a PAT in plugin options, a bearer token returned by a fake az runner (PAT-less run), an `sk-bf-` apiKey in the local config and a resolved secret placeholder, across the success, cache-fallback and exception paths, When every argument of every logger call is captured and serialised (including util.inspect with showHidden), Then none contains any of those secret values, and the logger never receives the settings object (AC-9, FR-9).",
    "Given each internal failure in turn (fetch dependency rejecting, parseJsonc throwing, unwritable cache directory, cache write throwing, logger throwing, a frozen Kilo config making mergeConfig throw TypeError, options null or non-object), When the hook runs, Then it resolves without throwing, any logged message is fixed text (never err.message), and Kilo's config is left either unchanged or fully merged (FR-10); and When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0, backend/package.json has no runtime `dependencies`, and docs/architecture contains an ADR stating which config layers may supply org/project/repo/path/pat and that fetched/cached content is validated as untrusted before merge."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json`: F-006 is now `in_progress` with a refined description, an added F-004 dependency and 8 ACs. Added T-012.
- `factory/runs/cycle-0008/01-product-owner.md`: this report.

## Verification
- After editing, `factory/backlog.json` parses with `node`. F-006 has status `in_progress` and 8 ACs, and it is the only `in_progress` item.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- **The cache stores the parsed shared config before placeholder resolution.** VISION step 5 ("writes the result") is ambiguous, and resolved `{env:}`/`{file:}` values can be secrets. Keeping them off disk matches the "no secrets" goal. Placeholders are resolved again each time the cache is loaded.
- **Missing required settings follow the same cache fallback as a failed fetch.** This keeps engineers working offline and avoids a separate code path. The cache file is per user, so this cannot cross a trust boundary.
- **Fetched or cached content whose root is not a plain object is rejected** and is never merged or written to the cache. A corrupt cache is ignored, which is the AC-4 path.
- **Cache writes are atomic** (temp file, then rename), so a crash cannot leave a half-written cache that later becomes the AC-4 path.
- **The Architect chooses the exact Kilo logger API** and keeps an injectable logger seam. The tests assert on the captured logger calls.

## Follow-ups for the backlog
- After F-006, choose between F-009 (template, small) and F-007 (validator). F-009's AC 4 needs the F-007 validator, so F-007 should come first, or F-009 should get its own sk-bf- check.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0008/01-product-owner.md
summary: Selected F-006 (cache, fallback, logging and never-crash wiring) with 8 testable ACs including the cycle 0007 trust-boundary note; added T-012
