# Code Review report — cycle 0003 — F-001: Plugin: JSONC parser

## Inputs read
- `git diff main...HEAD`, excluding `factory/`. The working tree was clean, so there were no uncommitted changes.
  - `backend/plugin/azdo-remote-config.ts`
  - `backend/test/plugin/jsonc.test.ts`
  - `backend/test/plugin/azdo-remote-config.smoke.test.ts`
  - `docs/architecture/ADR-0003-jsonc-parser.md`
  - `docs/architecture/contracts/plugin-interface.md` (v0.2.0)
  - `docs/architecture/overview.md`
- `factory/backlog.json` (F-001, AC1-7), `factory/VISION.md` Appendix A.
- `factory/runs/cycle-0003/02-architect.md`, `03-backend.md`, `04-security.md`.

## Work done
- Ran the full quality gate myself.
- Mapped each AC to its code and to a test that would fail if the AC broke.
- Checked the implementation against ADR-0003 and contract section 2a.
- Probed edge cases against the real module from a scratchpad script. All of these behave correctly:
  - `{"a":1}/`, `"a\\`, `[1,/**/]`, `[1, // x`, `{"a":1,,}`, `[,]`, `{"a":1}//`, a double BOM, `[1,/* x`, `{"a":/ 1}`, `{"a\\":1,}` and whitespace-only input.
  - Escaping, trailing-comma lookahead and error classification are all right in these cases.
- Checked that each agent stayed in its lane:
  - Backend changed only `backend/`.
  - Architect changed only `docs/architecture/`.
  - There is no frontend work.

### Acceptance criteria coverage
| AC | Implementation | Test (`backend/test/plugin/jsonc.test.ts`) | OK |
|----|----------------|------|----|
| AC1 comments (multi-line, EOF without newline) | `commentEnd`, `blank` | "AC-1 ..." covers `//` at EOF and `/* */` at EOF | yes |
| AC2 trailing commas (nested, ws/comments before closer) | `closesContainer` | "AC-2 ..." | yes |
| AC3 strings preserved (`https://`, `/* */`, `,}`) | `stringEnd` copy | "AC-3 ..." | yes |
| AC4 escaped quote / `"C:\\"` then `//` | `stringEnd` backslash skip | "AC-4 ..." (two cases) | yes |
| AC5 errors descriptive, no echo | `jsoncError`, `locate`, bare catch | exact messages, canary, `cause === undefined` | yes for behaviour, **but the wording differs from the contract (finding 1)** |
| AC6 Appendix A | parser | "AC-6 ..." (text is verbatim from VISION) | yes |
| AC7 CI + FR-11 | no imports, no deps | `bash scripts/ci.sh` exit 0, check-fr11 PASS | yes |

## Files changed
- `factory/runs/cycle-0003/05-review.md`: this report only.

## Verification
- `bash scripts/ci.sh` exited 0:
  - `check-fr11: PASS`
  - `tsc --noEmit` clean
  - 30/30 tests passed
  - `check-lf: PASS`
  - `ci: PASS`
- Ran the edge-case probe with `node` from the session scratchpad. Results are summarised under "Work done".

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | medium | backend | `backend/plugin/azdo-remote-config.ts:131`, `:136`; `backend/test/plugin/jsonc.test.ts:71`, `:77`, `:144` | **Contract mismatch.** Contract v0.2.0 section 2a (`docs/architecture/contracts/plugin-interface.md:70-71`) fixes the messages as `Invalid JSONC: unterminated string starting at line L, column C` and `Invalid JSONC: unterminated block comment starting at line L, column C`. The design hand-off (`02-architect.md`) uses the same wording. The code emits `... unterminated string at line L, column C` without "starting", and the tests pin that non-contract wording. Scenario: any consumer written to the contract gets a string that does not match, e.g. the C1 validator (which reuses `__internals.parseJsonc`) or a later F-item that matches or documents these messages. The tests would then defend the wrong text. | Change both messages to `unterminated string starting at ${locate(...)}` and `unterminated block comment starting at ${locate(...)}`. Update the three exact-message assertions in `jsonc.test.ts` to match. No other change is needed. |

## Assumptions made (no human available)
- The exact message wording in the contract is normative, because the contract table gives literal strings. The ADR's shorter quotes ("unterminated string") are names of the error cases, not the message format, so the contract wins.
- A lone `\r` counts as a line break. The contract is silent on this and the architect's task list specifies it, so it is not a finding.

## Follow-ups for the backlog
- `backend/plugin/azdo-remote-config.ts:38`: `const BOM` holds a raw, invisible U+FEFF character. Prefer the escape `"\uFEFF"`. If an editor strips the character, the constant becomes `""`, and `startsWith("")` would then drop the first character of every input. The current tests would catch that, so this is a nit.
- Memory: `parts` stores one string per character, about 50x the input size (security finding 1). Push slices of untouched runs instead, and add a size cap in F-005/F-006.
- `backend/test/plugin/jsonc.test.ts:30`: `"{} /* eof"+"*/"` uses odd concatenation. A plain literal is fine, because test files are not scanned by check-fr11. This is cosmetic.

FACTORY_RESULT
status: FAIL
report: factory/runs/cycle-0003/05-review.md
summary: CI green and AC1-7 covered, but the unterminated-string and unterminated-comment messages leave out the word "starting" that contract v0.2.0 section 2a requires (backend rework, small)
