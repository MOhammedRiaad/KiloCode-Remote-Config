# Security report — cycle 0006 — F-004: Plugin: settings resolution (options, env, defaults)

## Inputs read
- `git diff main...HEAD` (excluding `factory/`): `backend/plugin/azdo-remote-config.ts`,
  `backend/test/plugin/settings.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`,
  `docs/architecture/ADR-0006-settings-resolution.md`, `docs/architecture/contracts/plugin-interface.md`
  (v0.5.0 section 2d), `docs/architecture/overview.md`.
- `factory/templates/report.md`. Rework iteration 0 (no previous findings).

## Work done
- Reviewed `resolveSettings` and its helpers (`readOwn`, `isRecordLike`, `checkString`, `acceptName`,
  `acceptBranch`, `acceptPath`, `checkMode`, `checkPat`, `checkTimeout`, `pickSetting`, `selectEnv`)
  against ADR-0006 and contract section 2d.
- Secrets grep over the diff: no keys, tokens, private keys or `.env` files. The tests use a
  synthetic `SENTINEL` value only.
- Probed the real module (Node v24.15.0, scratch script outside the repo) with:
  - **PAT secrecy:** `JSON.stringify(result)`, `Object.keys`, object spread, `structuredClone`, `String()`,
    `util.inspect` (default), `util.format("%j")` all omit the PAT. Invalid PAT values (object, number,
    Symbol) produce only fixed warnings. A PAT from `process.env` does not leak through `JSON.stringify`.
  - **Name/branch/path bypasses:** `%2e%2e`, `..`, `.`, NUL and other C0 controls, backslash, `?`, `#`, `%`,
    and NBSP/BOM-padded `..` (removed by `trim()`) are all rejected. Unicode lookalikes (U+FF0E, U+FF0F,
    U+2215, U+2044), C1 controls (U+0085), bidi overrides (U+202E), lone surrogates, and `&`/`;`/`:`/`@`
    are accepted, which matches the ADR's deny-list. See findings 1 to 3.
  - **timeoutMs:** `"0x10"`, `"1e3"`, `"+5"`, `"-5"`, `"5.0"`, Arabic-Indic and fullwidth digits, `"1_000"`,
    `"Infinity"`, a 400-digit string, `2147483648`, `0`, `-0`, `5.5`, `NaN`, `Infinity`, `true` and `10n`
    are all rejected with W4. `" 0010 "` gives 10 and `" 5000 "` gives 5000 (`trim` strips
    Unicode whitespace). Both match the ADR.
  - **Hostile inputs:** a Proxy where every trap throws, a revoked Proxy, a Proxy that returns an
    accessor descriptor, accessor properties, inherited properties, JSON `__proto__`/`constructor`
    pollution payloads, Symbols, functions, `String` objects, arrays and `Object.create(null)`, each as
    `options`, as `deps` and as `deps.env`. **No throw in any case.** No getter was invoked and
    `Object.prototype` was not polluted. A Proxy that reports own data descriptors is honoured, which
    is correct: it reaches the same validation as any other value.
  - **ReDoS:** the code has no regular expressions. All checks are linear loops. A 5,000,000-character
    input resolved in about 124 ms.
- **FR-11:** no new imports, and the `check-fr11` lint passes.

## Files changed
- `factory/runs/cycle-0006/04-security.md` — this report (no source changes).

## Verification
- `bash scripts/ci.sh` → exit 0 (`ci: PASS`; 130 tests, 129 pass, 1 skipped, 0 fail; check-lf PASS).
- `npm audit --omit=dev --audit-level=high` (backend) → found 0 vulnerabilities.
- Hostile-input probe script → no exceptions. The PAT is absent from every serialisation the ADR claims to cover.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/plugin/azdo-remote-config.ts:467 (`acceptName`; also `acceptBranch` / `acceptPath`) | Lone UTF-16 surrogates (such as `"\ud800"`) are accepted for org/project/repo/branch/path. Once F-005 calls `encodeURIComponent` on them as the ADR requires, it throws `URIError`, so F-005 could break FR-10 (never throw) unless it guards the call. Nothing is affected today because the helper is not wired yet. | Backlog: reject strings that are not well-formed (`!trimmed.isWellFormed()`, Node 20+) with W2, or make F-005 wrap the encoding in try/catch. |
| 2 | info | backend/plugin/azdo-remote-config.ts:445 (`hasControlChar`) | C1 controls (U+0080 to U+009F), bidi overrides (U+202A to U+202E, U+2066 to U+2069) and Unicode slash/dot lookalikes (U+FF0F, U+2215, U+2044, U+FF0E) are accepted. After `encodeURIComponent` they cannot change the URL structure, so this is not injection. They can only create confusing 404s, or spoof text if a later item ever logs the values. Warnings never contain values today. | Optional: extend the deny-list to C1 and bidi controls. F-006 must keep logging setting names only. |
| 3 | info | backend/plugin/azdo-remote-config.ts:461 (`checkString`) | There is no length cap. Multi-megabyte values are accepted and would produce oversized URLs in F-005. Processing is linear, so there is no DoS here. | Optional: add a cap (for example 1024 characters) with W2. |
| 4 | info | backend/plugin/azdo-remote-config.ts:571 (`defineProperty pat`) | A non-enumerable `pat` is still shown by `util.inspect(x, { showHidden: true })` and by `console.log("%o", settings)` / `util.format("%o")`, because `%o` turns on showHidden. The ADR claims only default `util.inspect`, so this is not a contract breach. | F-006: log with `%s`/`%j` or with fixed strings, never `%o` on `settings`. Note this in the F-006 design. |

No critical, high or medium findings.

## Assumptions made (no human available)
- Leaks through `showHidden` / `%o` are outside the ADR claims and are out of scope as the brief
  allows, so they are reported as info only.
- Unwired-helper risks that only become real in F-005/F-006 (findings 1 and 4) are rated by their
  current impact, which is none, and passed on as follow-ups instead of blocking.

## Follow-ups for the backlog
- F-005: guard `encodeURIComponent` against lone surrogates, or have F-004's validators reject
  strings that are not well-formed (finding 1).
- F-006: never log `settings` with `%o` or `showHidden`. Log warnings and `missing` only (finding 4).
- Optional hardening: deny C1/bidi controls and cap value length in `checkString` (findings 2 and 3).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0006/04-security.md
summary: No critical/high/medium issues; resolveSettings never threw on any hostile input and the PAT stays out of every output the ADR covers; CI and audit clean; 1 low and 3 info follow-ups.
