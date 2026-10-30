# Product Owner report — cycle 0004 — F-002: Plugin: {env:} and {file:} placeholder resolution

## Inputs read
- `factory/VISION.md` (FR-1..FR-27, AC-1..AC-14)
- `factory/backlog.json`, `factory/state.json` (cycle 4, last release v0.1.0)
- `CHANGELOG.md`, `VERSION`
- `factory/runs/cycle-0003/` (summary, 04-security, 07-security-rework1, 08-review-rework1, 10-docs, 12-ci-ship)
- `docs/architecture/` (ADR-0002 `__internals` seam, ADR-0003, contracts/plugin-interface.md)

## Work done
- Vision is defined (no template marker). Not done yet: 2 of 21 items are done (T-001, F-001).
- Groomed the backlog:
  - Cycle 0003 follow-ups were already in the backlog: a size cap before parseJsonc (F-005 AC), a prototype-pollution guard (F-003 AC), FR-11 lint hardening (T-002), and the raw BOM literal (T-004). I added the parser memory note (security low) to the T-004 description.
  - Fixed T-004 text. The JSON `"﻿"` in backlog.json decoded to a real invisible BOM character, so I changed it to `"\\ufeff"` (an ASCII escape).
  - Added **T-005** (chore, priority 4): CHANGELOG.md has no `[0.1.0]` entry even though VERSION = 0.1.0 and state.json records F-001 released as v0.1.0.
  - Priorities unchanged. No item has failed in 2+ cycles, so none is blocked or split.
- Selected **F-002**, the highest-priority (1) `todo` item with all `depends_on` done (T-001). F-002 and F-003 are tied at priority 1. I took F-002 first in backlog order, and because F-006 consumes the resolver's output.
- Tightened the acceptance criteria to 8 automatable Given/When/Then statements. They pin the `__internals.resolvePlaceholders` seam, injectable env/home/reader, array semantics, no mutation, no secret leakage, and CI/FR-11.

Selected item (copy verbatim):

```json
{
  "id": "F-002",
  "title": "Plugin: {env:} and {file:} placeholder resolution",
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
  "description": "FR-5 / AC-8. Pure helper exposed as `__internals.resolvePlaceholders` (ADR-0002 seam) inside the single plugin file backend/plugin/azdo-remote-config.ts. Recursively resolves `{env:VAR}` and `{file:path}` placeholders in the parsed shared config and returns `{ value, unresolved }` where `unresolved` is a list of placeholder names (never values). Environment, home directory and file reader are injectable for tests (defaults: process.env, os.homedir(), fs.readFileSync). Not yet wired into the config hook (F-006). Zero runtime deps (FR-11).",
  "acceptance_criteria": [
    "Given `{\"x\": \"{env:SET_VAR}\"}` and an injected env with SET_VAR=abc, When `__internals.resolvePlaceholders` runs, Then result.value.x equals `abc` and result.unresolved is empty.",
    "Given `{\"x\": \"{env:MISSING}\", \"y\": 1}` with MISSING unset, When resolved, Then key x is absent from result.value (not present as undefined/empty), y equals 1, and result.unresolved contains exactly `env:MISSING`.",
    "Given `{\"x\": \"pre-{env:MISSING}-post\"}` with MISSING unset, When resolved, Then x equals `pre--post` and result.unresolved contains `env:MISSING`.",
    "Given `{\"x\": \"{file:~/secret.txt}\"}` and secret.txt containing `  s3cret\\n` under an injected fake home directory, When resolved, Then x equals `s3cret` (trimmed) and the file read targeted `<home>/secret.txt` (`~/` expanded).",
    "Given `{file:...}` that cannot be read (missing path, a directory, or a reader that throws with the file contents in its error message), When resolved, Then the key is dropped, result.unresolved contains `file:<path as written>`, and no returned or thrown value contains the file contents or the reader's error text.",
    "Given placeholders nested in objects and arrays (e.g. `{\"a\":{\"b\":[\"{env:SET_VAR}\",\"{env:MISSING}\",\"keep\"]}}`), When resolved, Then nested values follow the same rules, an array element that is only an unresolved placeholder is removed from the array (giving `[\"abc\",\"keep\"]`), and non-string values (numbers, booleans, null) and strings without placeholders are returned unchanged.",
    "Given any input object, When resolved, Then the input object is not mutated, own keys `__proto__`, `constructor` and `prototype` in the input do not pollute Object.prototype, and a string containing multiple placeholders (`{env:A}/{env:B}`) resolves each one.",
    "Given the plugin package after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0, backend/package.json has no runtime `dependencies`, and the only new export surface is the `resolvePlaceholders` key on `__internals`."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json`: F-002 set to in_progress with refined ACs. T-004 escape text fixed. T-005 added.
- `factory/runs/cycle-0004/01-product-owner.md`: this report.

## Verification
- `node -e "require('./factory/backlog.json')"` → parsed OK. The F-002 item was extracted and matches the block above.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | CHANGELOG.md | No `[0.1.0]` entry for F-001 although VERSION is 0.1.0 | T-005 (CI releaser may backfill during this cycle's release) |

## Assumptions made (no human available)
- Array elements that are only an unresolved placeholder are removed from the array. FR-5 says such a value is "dropped", and in an array that means removal, not null.
- `{file:...}` content is trimmed of surrounding whitespace. This matches the existing backlog AC and the common opencode/Kilo behaviour.
- Relative `{file:}` paths (not `~/` or absolute) resolve relative to the home directory or are reported unresolved, at the Architect's discretion. FR-5 only specifies `~/`, so this is left to the Architect and should be recorded in an ADR or the contract.
- Placeholder names in `unresolved` are reported as written (`env:NAME`, `file:<path>`), with no values. File paths are not secret.
- F-002 is chosen over F-003 (both priority 1) by backlog order.

## Follow-ups for the backlog
- None beyond T-005 (added).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0004/01-product-owner.md
summary: Selected F-002 (placeholder resolution, backend only) with 8 testable ACs; added T-005 (missing CHANGELOG 0.1.0 entry)
