# Security report — cycle 0003 — F-001: Plugin: JSONC parser

## Inputs read
- `git diff main...HEAD` (excluding `factory/`): `backend/plugin/azdo-remote-config.ts`, `backend/test/plugin/jsonc.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`, `docs/architecture/ADR-0003-jsonc-parser.md`, `docs/architecture/contracts/plugin-interface.md`, `docs/architecture/overview.md`
- `factory/runs/cycle-0003/02-architect.md` (security notes), `factory/runs/cycle-0003/03-backend.md`
- `backend/tools/check-fr11.mjs`, `backend/package.json`

## Work done
- **Secrets:** grepped the diff for keys, tokens, passwords and private keys, and checked for committed `.env` files. The only hits are the test canary `SECRET-CANARY-42` and a comment saying "no apiKey here". No `.env` files were added.
- **Data exposure (FR-9 / AC-5):** I reviewed every throw site in `parseJsonc`.
  - Messages are fixed text plus a 1-based line and column computed by `locate()`.
  - The `SyntaxError` from `JSON.parse` is discarded by a bare `catch {}`. It is not chained as `cause` and its message is not interpolated.
  - Non-string input throws a fixed `TypeError` message.
  - The canary tests cover unterminated string, unterminated block comment, malformed JSON, bare tokens and empty input.
  - A bare `catch` also turns a possible engine `RangeError` on deep nesting into the fixed message, so nothing leaks through that path either.
- **Injection / unsafe deserialization:** the input goes only to `JSON.parse`, with no reviver, no `eval`, no `Function` and no regex over the input. This surface is not applicable.
- **Prototype pollution:** I probed `{"__proto__":1,"constructor":{"prototype":{"x":1}}}`.
  - `JSON.parse` creates these keys as own data properties, and `Object.prototype` stayed clean.
  - There is no merge in this item. The risk moves to F-003 (see the backlog follow-ups).
- **DoS / performance:** I ran adversarial inputs from a scratchpad script (Node 24.15) against the real module. Every case is linear:

  | Input | Size | Time |
  |-------|------|------|
  | 5M-deep `[[[...]]]` | 10 MB | about 1.3 s, parsed without stack overflow |
  | 200k-deep objects | | 145 ms |
  | Comma followed by 5 MB of whitespace | | 168 ms |
  | `", /*"` repeated without a terminator | | 45 ms |
  | 1.25M empty block comments | | 128 ms |
  | Unterminated block comment or string | 5 MB | about 12 ms |
  | 2.5M trailing-comma array elements | | 345 ms |

  - The `closesContainer` lookahead ranges for successive commas do not overlap, because each stops at the next significant character. That rules out quadratic blow-up.
  - The only cost that grows notably with input is memory. The `parts` array holds one string per character, so heap use rises by about 50 bytes per input character (about 500 MB for 10 MB of input). The input is an authenticated config file, and the architect has already deferred a size cap to F-005/F-006. I classify this as a low follow-up.
- **Lenient grammar:** `{,}` and `[,]` are accepted as empty containers, and `[1,,]` is rejected. This was documented as an architect assumption and has no security impact.
- **FR-11 / lint integrity:**
  - The plugin file has no imports and no `require`.
  - `/*` and `*/` appear only in real doc comments, not in code or string literals, so the `check-fr11` comment-stripping regex cannot hide code.
  - `package.json` has no `dependencies` and no new devDependencies.
- **AuthN/Z, CSRF/CORS, headers, logging:** this item has no network, I/O or logging surface, so none of these apply.

## Files changed
- `factory/runs/cycle-0003/04-security.md`: this report. No source code was modified.

## Verification
- `bash scripts/ci.sh` exited 0: `check-fr11: PASS`, typecheck clean, 30/30 tests passed, `check-lf: PASS`.
- `npm audit --omit=dev --audit-level=high` in `backend/` found 0 vulnerabilities.
- The adversarial and prototype probes were run from the session scratchpad and gave the results above.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/plugin/azdo-remote-config.ts:122-150 | Memory amplification: `parts` is an array with one string per input character, so heap grows about 50x relative to the input (measured about 500 MB for 10 MB). Time is linear. The input is a single authenticated config file, so the risk is low. | Not required this cycle. Before wiring the parser to fetched content (F-005/F-006), enforce a response-size cap, e.g. 1 MiB. Optionally build the output with slices of untouched runs instead of single characters. |
| 2 | info | backend/plugin/azdo-remote-config.ts:48-60 | Error positions show the input's line/column structure (e.g. the column of an unterminated string equals the offset). This is allowed by the AC-5 policy and contains no content. | None. |
| 3 | info | backend/plugin/azdo-remote-config.ts:118-151 | `__proto__`, `constructor` and `prototype` keys are returned as own properties. That is safe now, but becomes a pollution vector if a naive recursive merge consumes them later. | Handled by F-003 (see follow-ups). |

## Assumptions made (no human available)
- The config source is treated as authenticated and trusted-ish, as the architect stated, so the missing size cap is low severity for a parser that is not yet wired to any I/O.
- Engine behaviour for deep nesting (V8's iterative `JSON.parse`) is acceptable. On other engines a `RangeError` is caught and replaced by the fixed message.

## Follow-ups for the backlog
- **F-005/F-006:** enforce a maximum remote config size (e.g. 1 MiB) before calling `parseJsonc`. Finding 1.
- **F-003:** the deep merge must skip `__proto__`, `constructor` and `prototype` keys, or define them as own properties, and must have a regression test. Finding 3.
- **T-002 (existing):** harden the `check-fr11` comment stripping so that `/*` inside string literals cannot hide imports.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0003/04-security.md
summary: parseJsonc leaks no input in errors, runs in linear time on adversarial input, has no pollution at parse time and is FR-11 compliant; 1 low + 2 info follow-ups
