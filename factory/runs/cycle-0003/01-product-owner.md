# Product Owner report — cycle 0003 — F-001: Plugin: JSONC parser

## Inputs read
- `factory/VISION.md`: the vision is defined, and the template marker is absent.
- `factory/backlog.json` (18 items; T-001 is done)
- `factory/state.json` (cycle 3, last release v0.0.1)
- `CHANGELOG.md` (0.0.1: T-001 skeleton)
- `factory/runs/cycle-0002/*.md`, especially 02-architect, 04-security, 05-review and 07-docs follow-ups

## Work done
- Checked the cycle-0002 follow-ups against the backlog:
  - The FR-11 lint evasions (security #1 low, review #2/#3 low) are already captured as T-002 at priority 3. They are low severity, so no priority-1 escalation.
  - The architect's release-artefact suggestion is already T-003 (P4).
  - The docs follow-up "remove compose steps from ci.sh" was done by the CI releaser in cycle 0002 (CHANGELOG "Fixed"). No item needed.
  - Security's future concerns are added as ACs to the items that implement them. F-006 gets a new AC: the cache file is 0600 and its directory is created if missing. F-002 gets a new AC: `{file:}` failures report only the placeholder name, never contents. Token redaction and timeouts were already covered by F-005 and F-006.
- No items failed or are blocked, so there is nothing to split.
- Priorities are unchanged. The P1 candidates whose dependencies are done are F-001, F-002 and F-003. I picked F-001 because F-007 and F-009 depend on it, and F-006 depends on it transitively, so it unblocks the most work.
- Set F-001 to `in_progress`. I tightened its acceptance criteria to 7 Given/When/Then criteria, each testable with node:test. Scope is backend only.

Selected item:

```json
{
  "id": "F-001",
  "title": "Plugin: JSONC parser",
  "type": "feature",
  "priority": 1,
  "status": "in_progress",
  "scope": { "backend": true, "frontend": false },
  "depends_on": ["T-001"],
  "description": "FR-4 / AC-5. Pure, exported function (e.g. `parseJsonc(text: string): unknown`) inside the single plugin file backend/plugin/azdo-remote-config.ts. Strips line/block comments and trailing commas outside strings, then JSON.parse. Zero runtime deps (FR-11). Not yet wired into the config hook (F-006).",
  "acceptance_criteria": [
    "Given JSONC with `//` line comments and `/* */` block comments (including a multi-line block comment and a comment at end of file without trailing newline), When parsed, Then the result deep-equals the same document without comments.",
    "Given JSONC with trailing commas in objects and arrays (including nested and with whitespace/comments between the comma and the closing bracket), When parsed, Then it parses to the expected object.",
    "Given string values containing `https://host/path`, `/* not a comment */` and a literal `,}` sequence, When parsed, Then each string value is preserved exactly.",
    "Given strings containing escaped quotes (`\\\"`) and escaped backslashes (a string ending in an escaped backslash, e.g. JSON source `\"C:\\\\\"`) followed by `//`, When parsed, Then string boundaries are respected and content is preserved.",
    "Given invalid JSONC (unterminated string, unterminated block comment, or malformed JSON), When parsed, Then an Error with a descriptive message is thrown and the input text is not echoed in full in the message.",
    "Given the Appendix A example from VISION.md, When parsed, Then provider.bifrost.options.baseURL equals `https://bifrost.yourcompany.internal/v1` and provider.bifrost.models has keys `azure/gpt-5` and `azure/gpt-5-mini`.",
    "Given the plugin package after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0 and backend/package.json still has no runtime `dependencies`."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json`:
  - F-001 is now in_progress, with a refined description and ACs.
  - F-002 and F-006 each got one security follow-up AC.

## Verification
- `factory/backlog.json` parses as valid JSON (checked with node).
- Exactly one item (F-001) is `in_progress`. Its only dependency, T-001, is `done`.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Error messages from the parser must not echo the full input. The shared file should never contain secrets, but this is defense-in-depth for FR-9 and AC-9.
- The parser must live in the single plugin file (FR-11). The test may import it as a named export. The exact name is the Architect's choice.
- The T-002 lint hardening stays at P3 because every related finding is low severity.

## Follow-ups for the backlog
- None beyond those already recorded.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0003/01-product-owner.md
summary: Selected F-001 Plugin: JSONC parser (backend only, 7 ACs); added security follow-up ACs to F-002/F-006.
