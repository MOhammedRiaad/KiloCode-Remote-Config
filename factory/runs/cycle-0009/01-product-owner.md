# Product Owner report — cycle 0009 — F-007: Shared config repo: example kilo.jsonc and validation script

## Inputs read
- `factory/VISION.md` (FR-12, FR-13, AC-13, Appendix A)
- `factory/backlog.json`, `factory/state.json` (last release v0.6.0)
- `CHANGELOG.md` (0.6.0 shipped F-006)
- `factory/runs/cycle-0008/*` (summary, PO, architect, security, review, rerun reports)
- `docs/architecture/ADR-0001-tech-stack.md` (layout: `backend/validator/`, `backend/test/validator/`)

## Work done
- Vision not template (no `VISION_TEMPLATE_UNCHANGED`). The vision is not fully delivered: C1 validator and pipeline, C3 template, C5 installers and C6 provisioning are still open.
- Grooming:
  - Selected **F-007** and raised it to priority 1. F-009's AC4 needs the F-007 validator, and F-008, F-014 and F-015 also depend on it.
  - Rewrote F-007 into 8 testable Given/When/Then ACs. Made the vague parts concrete: exit codes 0/1/2, case-insensitive `apiKey`, how `sk-bf-` is masked (including comments), the vendored schema subset, the optional `--allowed-hosts` flag, and errors vs warnings for prototype-named keys.
  - F-009: added `F-007` to `depends_on`.
  - T-015: added cycle 0008 review info 3-5 (the failing-collaborators assertion, the exact error code for deep nesting, and a check that `server()` makes no logger calls) plus one AC.
  - T-014: added cycle 0008 security info 4 (document cache dir mode behaviour, including Windows).
  - Checked the other cycle 0008 follow-ups. They are already tracked: T-013 (cache fingerprint, project-layer override), T-014 (cleanName, tmp sweep, TOCTOU) and T-015 (temp dirs, case-insensitive env filter, nits). No high or critical security findings are open. Nothing has failed in 2+ cycles, so nothing is blocked.
- Selected item (copy verbatim):

```json
{
  "id": "F-007",
  "title": "Shared config repo: example kilo.jsonc and validation script",
  "type": "feature",
  "priority": 1,
  "status": "in_progress",
  "scope": {
    "backend": true,
    "frontend": false
  },
  "depends_on": [
    "F-001"
  ],
  "description": "FR-12 / FR-13 / AC-13, plus cycle 0005 security follow-ups. Two deliverables for C1 (shared config repo): (a) an example shared config, e.g. backend/shared-config/kilo.jsonc, based on VISION Appendix A (Bifrost provider with baseURL and models, no apiKey, no secrets); (b) a zero-runtime-dependency validator CLI under backend/validator/ (ADR-0001 layout, Node >=22.18 built-ins only, run e.g. as `node backend/validator/validate-kilo-config.ts <file>...`), used later by the Azure Pipelines PR gate (F-008) and the template check (F-009). The validator must reuse the plugin's JSONC parser (`__internals.parseJsonc` or an Architect-approved import) rather than a second copy, and must NOT change the plugin's export surface. Rules: parse JSONC; root must be a plain object; check a vendored Kilo config schema subset (Architect defines it, pinned to SUPPORTED_KILO_RANGE, stored under backend/validator/); reject any `apiKey` key at any depth (key name compared case-insensitively); reject `sk-bf-` secret patterns in string values and comments without echoing the secret; reject own keys `__proto__`/`constructor`/`prototype`; warn on other Object.prototype member names (e.g. hasOwnProperty, toString), on `{file:}` paths that never resolve (relative, bare `~`, `~user`, UNC / `//host`), and on top-level `plugin` (ignored by the merge); optional `--allowed-hosts h1,h2` flag rejects provider `options.baseURL` values that are not https or whose host is not in the set. Exit codes (PO decision): 0 = valid (warnings allowed), 1 = validation errors in any file, 2 = usage or I/O error. Output names files, JSON paths and rule ids, never secret values. Tests live in backend/test/validator/ and are run by `bash scripts/ci.sh`.",
  "acceptance_criteria": [
    "Given the shipped example shared config (e.g. backend/shared-config/kilo.jsonc, Appendix A content with comments and an https baseURL), When the validator CLI runs on it in a child process, Then it exits 0, reports the file as valid, and the parsed example has provider.bifrost.options.baseURL as a string and provider.bifrost.models keys `azure/gpt-5` and `azure/gpt-5-mini` and no `apiKey` anywhere.",
    "Given files containing an `apiKey` key at top level, at `provider.bifrost.options.apiKey`, inside an array element, and spelled `APIKEY`, When validated, Then each run exits 1 and the output names the JSON path of the offending key (e.g. `provider.bifrost.options.apiKey`) and does not contain the key's value.",
    "Given a file with the string `sk-bf-AbCdEf1234567890` as a nested value, inside a longer string, inside an array, or in a `//` or `/* */` comment, When validated, Then the run exits 1, the output names the JSON path (or the line number for a comment), and the output never contains `AbCdEf1234567890`.",
    "Given invalid JSONC (unterminated string, unterminated block comment, malformed JSON) or a root that is an array, string, number or null, When validated, Then the validator exits 1 with a parse/shape error naming the file and no stack trace; and Given no file argument or a path that does not exist, When run, Then it exits 2 with a usage or I/O message.",
    "Given files violating the vendored Kilo schema subset (`provider` not an object, `provider.bifrost` not an object, `provider.bifrost.options` or `provider.bifrost.models` not an object, `model` not a string), When validated, Then each exits 1 naming the JSON path; and an automated check confirms the vendored subset file exists under backend/validator/ and records the Kilo version range it was taken from.",
    "Given a shared config whose `{file:}` placeholders use a relative path, bare `~`, `~user/x`, or a UNC / `//host/share` path, When validated, Then the run exits 0 (no other errors) and prints one warning per placeholder naming the JSON path and stating it will never resolve; and `{file:~/x}`, absolute paths and `{env:VAR}` produce no such warning.",
    "Given own keys `__proto__`, `constructor` or `prototype` at any depth, When validated, Then the run exits 1 naming the path and Object.prototype is not polluted; Given keys `hasOwnProperty` or `toString`, Then a warning names the path; and Given `--allowed-hosts bifrost.yourcompany.internal`, When a provider `options.baseURL` is non-https, unparseable, or has another host, Then the run exits 1 naming the path, while without the flag no host error is raised.",
    "Given two files where one is valid and one has an error, When the validator runs on both in one call, Then it exits 1 and reports a result for each file; and When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0, runs the validator tests under backend/test/validator/, backend/package.json has no runtime `dependencies`, and the plugin's export surface is unchanged."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json` — F-007 refined and set in_progress; F-009 depends_on; T-014/T-015 follow-ups.
- `factory/runs/cycle-0009/01-product-owner.md` — this report.

## Verification
- `factory/backlog.json` re-parsed as valid JSON; exactly one item (`F-007`) is `in_progress`; diff limited to the intended items (file kept ASCII-escaped as before).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Exit codes are 0 = valid (warnings allowed), 1 = validation error, 2 = usage/I-O error. This is the usual CLI convention, and F-008's pipeline only needs non-zero on failure.
- `apiKey` is matched case-insensitively. This is conservative: it rejects more.
- `sk-bf-` is also scanned in comments. Comments sit in the reviewed repo file, so a key in a comment is still a leak (FR-12 "no secrets").
- `__proto__`/`constructor`/`prototype` are errors because the merge silently drops them. Other Object.prototype names are only warnings because they are legal Kilo keys.
- The host allowlist is opt-in (`--allowed-hosts`). The vision does not fix the company host, so a default allowlist would invent scope.
- The example file location (`backend/shared-config/kilo.jsonc`) is a suggestion. The Architect may pick another path under `backend/`.
- The validator must reuse the plugin's parser instead of copying it, so the gate parses exactly what the plugin parses.

## Follow-ups for the backlog
- Next cycle candidates: F-009 (template, now unblocked by F-007), then F-008 (pipeline + branch policy).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0009/01-product-owner.md
summary: Selected F-007 (example shared kilo.jsonc + zero-dep validator CLI) with 8 testable ACs; F-009 now depends on F-007; cycle 0008 info follow-ups folded into T-014/T-015
