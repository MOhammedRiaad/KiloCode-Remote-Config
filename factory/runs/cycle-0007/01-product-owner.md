# Product Owner report — cycle 0007 — F-005: Plugin: Azure DevOps fetch and authentication

## Inputs read
- `factory/VISION.md` (FR-2, FR-3, FR-8, FR-10, FR-11; sections 5 and 7)
- `factory/backlog.json`, `factory/state.json` (cycle 7, last release v0.4.0)
- `CHANGELOG.md` (0.0.1 to 0.4.0)
- `factory/runs/cycle-0006/*` (security, review, architect, CI and summary reports), plus earlier cycle reports through the follow-ups already recorded in the backlog

## Work done
- The vision is defined (no template marker).
- Done: T-001, F-001, F-002, F-003, F-004, T-005. No failed or blocked items, so nothing needed splitting.
- Groomed the cycle 0006 follow-ups:
  - Security low #1 and review #1 (lone surrogates make `encodeURIComponent` throw) go into F-005 as an AC. I removed this point from T-009 so the work is not done twice.
  - Security info #4 and the architect follow-up (never log `settings` with %o/showHidden; when `missing` is non-empty, skip the fetch and log names only) go into the F-006 description. I will turn them into ACs when F-006 is selected.
  - Architect follow-up: `repo` has no default since contract 0.5.0, so the template and installer must write org/project/repo explicitly. Added to the F-009 and F-010 descriptions.
- No new high or critical security items, so priorities are unchanged.
- **Selected F-005**: the highest-priority `todo` item whose dependencies are done (priority 2, depends on F-004, which is done). F-006 depends on F-005. F-007 and F-009 are also priority 2 and ready, but F-005 is on the critical path to a working plugin (F-006 wiring, then the installers). I cut the item from 9 ACs to 8 testable Given/When/Then criteria and defined the helper seam and the result shape.

Selected item (copy verbatim):

```json
{
  "id": "F-005",
  "title": "Plugin: Azure DevOps fetch and authentication",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-004"
  ],
  "description": "FR-2 / FR-3 / FR-8. Async helper exposed as `__internals.fetchRemoteConfig(settings, deps?)` (ADR-0002 seam) inside the single plugin file backend/plugin/azdo-remote-config.ts. Takes the output `settings` of `resolveSettings` (F-004, contract 0.5.0; `settings.pat` already covers the plugin option and KILO_AZDO_PAT) and fetches the shared file via the Azure DevOps Git Items API. Returns a discriminated result `{ ok: true, text }` or `{ ok: false, error }` where `error` is a fixed, value-free code/message (e.g. invalid-settings, auth-unavailable, timeout, http-<status>, too-large, bad-response, network); it NEVER throws or rejects (FR-10). Injectable deps: `fetch` (default globalThis.fetch), `env` (default process.env, own properties only), `runAz` (default: node:child_process execFile without a shell, bounded by timeoutMs), and timer/AbortController seams as the Architect sees fit. Request uses `Accept: application/json`; the file text is read from the JSON body's `content` string. Lone UTF-16 surrogates in settings (security low finding 1, cycle 0006) must be handled here: either an `isWellFormed()` guard via a contract amendment or catching URIError during URL building. Parsing, placeholder resolution, merge, cache and logging stay in F-006. Zero runtime npm deps (FR-11); Node built-ins only.",
  "acceptance_criteria": [
    "Given settings {org:'my org', project:'plat form', repo:'kilo-config', path:'/teams/a b/kilo.jsonc', branch:'release/1', timeoutMs:5000} and a fake fetch, When `__internals.fetchRemoteConfig` runs, Then exactly one GET is sent to `https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items` with org/project/repo percent-encoded as path segments and query parameters path, versionDescriptor.version=<branch>, versionDescriptor.versionType=branch, includeContent=true and api-version=7.1 (all values percent-encoded), with an `Accept: application/json` header; and Given a 200 response whose JSON body has `content` equal to a JSONC string, Then the result is `{ ok: true, text }` with text equal to that string byte-for-byte (not parsed).",
    "Given PAT sources, When the request is built, Then the Authorization header is `Basic ` + base64(':' + pat) using the first available of: settings.pat (plugin option or KILO_AZDO_PAT, from resolveSettings), then injected env AZDO_PAT, then AZURE_DEVOPS_EXT_PAT (empty/whitespace-only values skipped, env read as own properties only); and in every PAT case the injected az runner is never invoked.",
    "Given no PAT from any source, When fetching, Then the injected az runner is invoked once with arguments starting `account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` (no shell), the trimmed returned token is sent as `Authorization: Bearer <token>`; and Given the runner throws, exits non-zero, times out or returns empty output, Then no HTTP request is sent and the result is `{ ok: false }` with a fixed auth-unavailable error.",
    "Given a fake fetch that never responds, When fetching with timeoutMs 50, Then the request's AbortSignal is aborted at the timeout and the result is `{ ok: false }` with a timeout error within a bounded time (no hang), and the default timeout when settings come from resolveSettings defaults is 5000 ms (FR-8).",
    "Given a non-2xx response (e.g. 401, 404, 500), or a fetch that rejects with an error whose message contains the PAT, When fetching, Then the result is `{ ok: false }` and the error includes the HTTP status number for non-2xx responses, while no returned error contains the PAT, the bearer token, the Authorization header value or the underlying error's message.",
    "Given a response larger than 1 MiB (declared by Content-Length or actual body length when the header is missing or lies), or a 200 body that is not JSON or lacks a string `content` field, When fetching, Then the result is `{ ok: false }` with a too-large or bad-response error and no oversized text is returned (cap enforced before any parsing; parseJsonc memory is about 50x input size).",
    "Given settings with missing org/project/repo, or a value containing a lone surrogate (e.g. org `\ud800`) that passed resolveSettings, When fetching, Then no URIError or other exception escapes, neither fetch nor the az runner is called, and the result is `{ ok: false }` with an invalid-settings error that names no values.",
    "Given any input including hostile values (null/non-object settings or deps, throwing fetch, throwing env proxy), When `fetchRemoteConfig` runs, Then the returned promise always resolves (never rejects) and the settings/env objects are not mutated; and When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0, backend/package.json has no runtime `dependencies`, and the only new export surface is the `fetchRemoteConfig` key on `__internals`."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json` — F-005 is now `in_progress` with a refined description and 8 ACs. Cycle 0006 follow-ups were added to F-006, F-009 and F-010, and the T-009 description was narrowed.
- `factory/runs/cycle-0007/01-product-owner.md` — this report.

## Verification
- After editing, `factory/backlog.json` parses as JSON. F-005 has status `in_progress` and 8 acceptance criteria.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- F-005 is a standalone `__internals.fetchRemoteConfig` helper that returns raw text in a never-throwing `{ok, text|error}` result. Parsing, placeholders, merge, cache and logging stay in F-006. This follows the pattern used for F-001 to F-004.
- The request sends `Accept: application/json` and reads the file from the Items API JSON `content` field. The Architect may choose the raw-content form instead, but must keep AC1 equivalent and amend the AC wording in the ADR.
- PAT precedence is `settings.pat` (option, then KILO_AZDO_PAT from resolveSettings), then AZDO_PAT, then AZURE_DEVOPS_EXT_PAT, then az. This matches contract 0.5.0.
- The size cap is 1 MiB, the same as the `{file:}` cap.
- The az runner uses `execFile` without a shell (Node built-in, FR-11 compliant). The Architect may add `--query accessToken -o tsv` after the required arguments.
- scope.frontend is false. The product has no UI (backlog `_notes`).

## Follow-ups for the backlog
- When F-006 is selected, turn the cycle 0006 logging notes (missing → skip fetch, warnings at warn level, no %o) into ACs and keep it to 8 or fewer.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0007/01-product-owner.md
summary: Selected F-005 (Azure DevOps fetch and authentication) with 8 testable ACs; folded cycle 0006 follow-ups into F-005/F-006/F-009/F-010/T-009
