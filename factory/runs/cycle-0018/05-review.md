# Code Review report — cycle 0018 — F-016: User and operator documentation

## Inputs read
- `git diff main...HEAD` and commit log (`fc2e319`, `f2887b0`)
- `factory/runs/cycle-0018/01-product-owner.md` (F-016 and 6 acceptance criteria)
- `factory/runs/cycle-0018/02-architect.md` (tasks B1–B4, D1–D5, C1–C2)
- `docs/architecture/ADR-0017-docs-information-architecture-and-check.md`
- `docs/architecture/contracts/docs-check.md` and `docs/architecture/contracts/validator-cli.md`
- `factory/runs/cycle-0018/03-backend.md` and `factory/runs/cycle-0018/03-backend-rework1.md`
- `factory/runs/cycle-0018/04-security.md` and `factory/runs/cycle-0018/04-security-rerun1.md`
- `backend/tools/check-docs.mjs` and `backend/test/tools/check-docs.test.ts`

## Work done
- Ran the full quality gate (`scripts/ci.sh` via Git Bash): `check-fr11: PASS`, `tsc --noEmit` (0 errors), `npm test` (575 tests, 570 pass, 0 fail, 5 pre-existing skips), JSON metadata validation, `check-lf: PASS`, `ci: PASS` (exit 0).
- Checked `backend/tools/check-docs.mjs` and `backend/test/tools/check-docs.test.ts` against all 6 acceptance criteria, backend tasks B1–B4 (per ADR-0017 phase split: D1–D5 docs pages are authored in Phase 6 by `docs-writer` and C1 `scripts/ci.sh` wiring is Phase 7 by `ci-releaser`), and `docs/architecture/contracts/docs-check.md`.
- Verified rework 1 (`f2887b0`) for the findings from `04-security.md`:
  - Secret redaction in all finding messages (`f.message.replace(SECRET_KEY, "sk-bf-<redacted>")` at `backend/tools/check-docs.mjs:424`) and negative tests for link targets, fragments, and `kilo-range` (`backend/test/tools/check-docs.test.ts:285-308`).
  - Real-path containment (`realOrNull` / `realpathSync` + `isInside(ctx.realRoot, real)` + `isRegularFile(real)` in `backend/tools/check-docs.mjs:246-294`) and the junction escape test (`backend/test/tools/check-docs.test.ts:310-333`).
  - Line-length cap (`MAX_LINK_LINE = 10000` in `backend/tools/check-docs.mjs:12,196-199,297-299`) emitting `line-too-long` while preserving `secret-key` and `forbidden-text` scans on full lines (`backend/test/tools/check-docs.test.ts:335-344`).
- Checked lane boundaries: `senior-backend` modified only `backend/tools/check-docs.mjs`, `backend/test/tools/check-docs.test.ts`, and its reports in `factory/runs/cycle-0018/03-backend*.md`.

## Files changed
- `factory/runs/cycle-0018/05-review.md` — this review report.

## Verification
- `scripts/ci.sh` → exit 0 (`check-fr11: PASS`, `typecheck` PASS, 575 tests / 570 pass / 0 fail, `check-lf: PASS`, `ci: PASS`).
- `node backend/tools/check-docs.mjs --help` → exit 0 (`usage: node backend/tools/check-docs.mjs [--root <dir>]`).
- Acceptance criteria & contract verification (for Phase 3/4 backend tasks B1–B4):
  - **AC-1 (`page-missing`, `cross-link`, `link-broken`)**: Implemented in `backend/tools/check-docs.mjs:280-320,386-399`; tested with negative controls in `backend/test/tools/check-docs.test.ts:142-199`.
  - **AC-2 (`docs/troubleshooting.md` items T1–T7)**: Implemented in `backend/tools/check-docs.mjs:22-30,322-337`; tested in `backend/test/tools/check-docs.test.ts:201-222`.
  - **AC-3 (`docs/engineer-setup.md` E1 `kilo-range` read at check time + E2–E5)**: Implemented in `backend/tools/check-docs.mjs:31-36,339-356` (reads `backend/plugin/azdo-remote-config.ts` as text, never imports); tested in `backend/test/tools/check-docs.test.ts:201-209,224-230`.
  - **AC-4 (`docs/platform-runbook.md` R1–R17)**: Implemented in `backend/tools/check-docs.mjs:37-59,322-337`; tested (including heading-only enforcement for R10–R13, R15) in `backend/test/tools/check-docs.test.ts:201-217`.
  - **AC-5 (`secret-key` scan across `README.md` and `docs/**/*.md` with runtime-constructed negative control)**: Implemented in `backend/tools/check-docs.mjs:13,358-362,424`; tested in `backend/test/tools/check-docs.test.ts:16,232-244,285-308`.
  - **AC-6 (`forbidden-text` and R18 manual virtual key statement)**: Implemented in `backend/tools/check-docs.mjs:55-67,363-369`; tested in `backend/test/tools/check-docs.test.ts:201-209,246-258`.

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | info | architect | `docs/architecture/contracts/docs-check.md:103` | Rework 1 (`f2887b0`) added the `line-too-long` rule (`> 10000` chars), `realpathSync` containment on link targets, and output redaction per `04-security.md`, which are noted in `03-backend-rework1.md` as a proposed contract update. | Optional backlog follow-up to document `line-too-long` and `realpathSync` containment in `contracts/docs-check.md`. |

## Assumptions made (no human available)
- Per ADR-0017, the 3 documentation pages (`docs/engineer-setup.md`, `docs/platform-runbook.md`, `docs/troubleshooting.md`) are authored in Phase 6 by `docs-writer` and `scripts/ci.sh` wiring is performed in Phase 7 by `ci-releaser`. Phase 4 gates `backend/tools/check-docs.mjs` and `backend/test/tools/check-docs.test.ts` (tasks B1–B4).

## Follow-ups for the backlog
- Sync `docs/architecture/contracts/docs-check.md` with the rework 1 additions (`line-too-long` rule for lines over 10,000 characters, `realpathSync` target containment, and finding-message redaction).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0018/05-review.md
summary: PASS - CI passes (570/570 runnable tests), check-docs.mjs and hermetic tests cover all 6 ACs and contract rules, security rework verified, lane boundaries respected.

