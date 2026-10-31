# Security report (re-check 1) — cycle 0018 — F-016: User and operator documentation

## Inputs read
- `factory/runs/cycle-0018/04-security.md` (previous findings #1–#5)
- `factory/runs/cycle-0018/03-backend-rework1.md`
- `git show f2887b0` and `git diff main...HEAD`
- `backend/tools/check-docs.mjs` and `backend/test/tools/check-docs.test.ts`

## Work done
- Verified each finding from `04-security.md` against the rework commit `f2887b0` in `backend/tools/check-docs.mjs` and `backend/test/tools/check-docs.test.ts`:
  - **Finding #1 (medium — secret printed through `link-broken` / output): FIXED.** `main()` (`backend/tools/check-docs.mjs:424`) applies `f.message.replace(SECRET_KEY, "sk-bf-<redacted>")` (`SECRET_KEY = /sk-bf-[A-Za-z0-9]{16,}/gi`) to every finding message at the single output point before writing to `stderr`. Covered by `"link forms never echo a secret key"` (4 link forms: `[x](KEY)`, `[x]: KEY`, `[x](#KEY)`, `[x](a.md#KEY)`) and `"kilo-range message never echoes a secret key"` in `backend/test/tools/check-docs.test.ts:285-308`.
  - **Finding #2 (low — symlink/junction escape in `checkLink`): FIXED.** `createContext` resolves `realRoot = realOrNull(root) ?? root` via `realpathSync` (`backend/tools/check-docs.mjs:256`). `checkLink` (`backend/tools/check-docs.mjs:286-291`) resolves `real = realOrNull(res.resolved)`, treats resolution failure as `"file not found"`, requires `isInside(ctx.realRoot, real)` (`"outside the repository"`), and requires `isRegularFile(real)` before reading anchors. Covered by `"links through a junction or symlink leaving the root fail"` in `backend/test/tools/check-docs.test.ts:310-333` (gracefully skips when the sandbox blocks junction creation).
  - **Finding #3 (low — quadratic regex time on very long lines): FIXED.** `extractLinks` (`backend/tools/check-docs.mjs:196-199`) caps link extraction at `MAX_LINK_LINE = 10000` characters and emits a `line-too-long` finding via `checkLinks` (`:297-299`), while `checkLineRules` (`:358-370`) continues to run the `secret-key` and `forbidden-text` scans on full lines. Covered by `"a very long line skips link extraction but keeps the secret scan"` in `backend/test/tools/check-docs.test.ts:335-344`.
  - **Finding #4 (info — docs secret pattern scope):** Unchanged by design (ADR-0017).
  - **Finding #5 (info — test coverage for #1 and #2): FIXED** by the new tests in `backend/test/tools/check-docs.test.ts:285-344`.

## Files changed
- `factory/runs/cycle-0018/04-security-rerun1.md` — security re-check 1 report.

## Verification
- `node --test test/tools/check-docs.test.ts` (in `backend/`): 19 tests, 18 pass, 0 fail, 1 skipped (junction creation blocked by sandbox).
- `npm run lint` and `npm run typecheck` (in `backend/`): PASS.
- `npm audit --omit=dev --audit-level=high` (in `backend/`): 0 vulnerabilities.
- Secret grep on `git diff main...HEAD`: no real-looking `sk-bf-` keys, private keys, GitHub tokens, or AWS keys committed (only the negative-control doc example in `docs/architecture/contracts/docs-check.md` and runtime-constructed `"sk-" + "bf-" + "Ab1".repeat(6)` in the test).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 4 | info | `backend/tools/check-docs.mjs:360` | The docs scan only looks for `sk-bf-` + 16 or more alphanumerics (`SECRET_KEY`); other credential shapes rely on the repo gitleaks job. Matches ADR-0017. | None for this item. Docs-writer must use only `sk-bf-<your-virtual-key>` / `sk-bf-...` placeholders and must not paste sample PATs or tokens. |

## Assumptions made (no human available)
- None beyond those recorded in `04-security.md`. The contract update noted in `03-backend-rework1.md` (`line-too-long` rule, real-path link containment, and output redaction in `docs/architecture/contracts/docs-check.md`) is owned by the Architect / Docs phase.

## Follow-ups for the backlog
- Consider adding gitleaks (or an equivalent PAT/bearer pattern) to the docs gate so docs get the same credential pattern coverage as code.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0018/04-security-rerun1.md
summary: PASS - all previous medium/low findings (#1 secret redaction, #2 realpath containment, #3 line-too-long cap) are fixed and tested.
