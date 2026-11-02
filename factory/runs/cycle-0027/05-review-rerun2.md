# Code Review report — cycle 0027 — T-038: Plugin JSDoc trim pass and wording fixes (comment-only) — Re-review 2

## Inputs read
- `05-review-rerun1.md` (prior FAIL, finding 1), `02-architect-rework2.md`
- `git diff fabb944 HEAD` (commit e6ebe9b); working tree clean
- `docs/architecture/contracts/e2e-harness.md` (now 1.1.1), `backend/test/installer/fixtures/fake-network.ts`, `backend/test/e2e/startup.test.ts`

## Work done
- Delta since the last review (fabb944..e6ebe9b) touches only these files: `docs/architecture/ADR-0016-*.md`, `ADR-0022-*.md`,
  `README.md`, `contracts/e2e-harness.md`, `overview.md`, and `factory/runs/cycle-0027/02-architect-rework2.md`.
  No changes under `backend/`, `frontend/`, `scripts/` or `.github/`.
- Finding 1 (e2e-harness contract mismatch) is **fixed**:
  - The contract type `{ mode: "auth"; authorization: string; header?: string; answer: FakeStaticAnswer }` matches
    `fake-network.ts:13` exactly.
  - The match rule `headers[header ?? "authorization"] === authorization` matches `fake-network.ts:95`. The note
    "header must be lower-case, because names are collected lower-cased" matches `fake-network.ts:76-78`.
  - The scenario values match `startup.test.ts:44-52`: AzDO has no `header` and uses `authorization: "Basic " + BASIC`;
    Bifrost uses `header: "x-bf-vk"`, `authorization: k` and `answer: { status: 200, body: '{"object":"list","data":[]}' }`.
  - The version line is bumped to 1.1.1. ADR-0016 has an amendment note, ADR-0022 Consequences lists the contract
    bump, and both the README and the overview were updated.
- Security re-check: not needed. The delta is documentation only (no code, config or test change) and describes
  fixture behaviour that security already reviewed in 04-security-rerun2. I agree with the orchestrator.

## Files changed
- `factory/runs/cycle-0027/05-review-rerun2.md` — this report.

## Verification
- `bash scripts/ci.sh` → exit 0, `ci: PASS` (726 tests, 716 pass, 0 fail, 10 skipped; check-lf PASS; check-docs PASS, 38 files)

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | — | architect | `docs/architecture/contracts/e2e-harness.md:76-85` | Prior blocking finding: resolved. | None. |
| 2 | low (non-blocking, docs phase) | docs writer | `docs/user-guide.md:565` (and `:524`) | Carried over: the `no-base-url` row and the smoke section do not mention the azurefoundry fallback or `x-bf-vk`. | Docs phase update. |
| 3 | info (non-blocking) | backend | `backend/test/installer/smoke.test.ts:1065-1085` | Carried over: no tests for "a present non-string bifrost baseURL does not fall back" or "an empty or non-string header falls back to apiKey". | Backlog follow-up. |
| 4 | info (non-blocking) | orchestrator | PR | Carried over: the PR body must list 7701a9b, e51246f and e6ebe9b as user-directed out-of-band changes (AC-2 is literally exceeded). | PR body. |
| 5 | info (non-blocking) | architect | `docs/architecture/contracts/e2e-harness.md:56` | The section 3 heading still says "version for 1.0.0", although the section now also carries 1.1.1 content. The content is correct, so this is cosmetic. | Optional wording tidy-up. |

## Assumptions made (no human available)
- The untracked root `kilo.jsonc` is still intentionally excluded (the working tree is clean in this snapshot).

## Follow-ups for the backlog
- Tests for the ADR-0022 edge rules (finding 3).
- Carried over: header-vs-fresh-key hint wording; installer writing the key into `azurefoundry.options.headers`; T-039 ADR-0021 3.2 alignment; readCache full cache-* code names; readCappedBody hostile-chunk guards.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/05-review-rerun2.md
summary: e2e-harness contract 1.1.1 now matches fake-network.ts and startup.test.ts; delta is docs/factory only; CI passes; remaining findings non-blocking.
