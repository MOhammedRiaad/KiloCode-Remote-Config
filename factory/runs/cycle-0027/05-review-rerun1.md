# Code Review report — cycle 0027 — T-038: Plugin JSDoc trim pass and wording fixes (comment-only) — Re-review 1

## Inputs read
- `git diff main...HEAD` (working tree clean apart from the intentionally excluded untracked root `kilo.jsonc`)
- Commits cbcfd39 (rework 1), 7701a9b (out-of-band installer change), e51246f (ADR-0022 + contract/overview docs)
- `05-review.md` (prior FAIL), `03-backend-rework1.md`, `04-security-rerun2.md`, `02-architect-smoke-contract.md`
- `docs/architecture/contracts/installer-cli.md` 1.4.0, `contracts/e2e-harness.md` 1.1.0, ADR-0013, ADR-0022, `docs/user-guide.md`

## Work done
### Prior findings 1-3 (cbcfd39), verified against the code
| # | Status | Evidence |
|---|--------|----------|
| 1 runConfigHook log claim | fixed | Now "no secret, PAT, token, Azure DevOps URL or host, or resolved config value"; L-UNRESOLVED names stated as copied as written (sanitised, shortened) and possibly containing paths/hosts. True against `cleanName`. |
| 2 resolvePlaceholders default reader | fixed | `@param deps` says the default readFile is the guarded reader and the invariant says "the default reader reads only regular files up to 1 MiB". |
| 3 executeHook Logs ambiguity | fixed | "then L-UNRESOLVED (if any) and L-APPLIED or LOG_MERGE (L-MERGE)" matches the code. |

T-038 checks re-run: `compare-plugin-shape --base-ref v0.16.2` PASS (200 statements, 6 `__internals` keys identical);
plugin file 1838 lines (<= 1839); longest comment line 110. cbcfd39 touched only the plugin file and the engineer report.
AC-2 ("only the plugin file under backend; no test/architecture diff vs v0.16.2") is no longer literally true for the
branch because of the user-directed ride-along (7701a9b, e51246f). This is an accepted, documented deviation, not an
engineer lane violation. The PR description must say so.

### Out-of-band installer change (7701a9b), reviewed
- `readSharedBaseUrl` (smoke.ts:110-115): bifrost first, then azurefoundry only when the bifrost value is `undefined`
  (absent or a level is not a plain object, via `ownPlainProperty`/`readOwn`). A present non-string bifrost value
  (for example `null`) does not fall back and fails `no-base-url`. This matches ADR-0022 decision 1 and contract 9.2 row 2.
  URL validation, the probe origin and the `/models` suffix all apply to the selected value. Correct.
- Bifrost request headers are exactly `Accept` and `x-bf-vk` (smoke.ts:409-413). `classifyKey` (visible ASCII,
  <= 4096 chars, no placeholder/reference) still runs first, so header injection is impossible. The PAT/az token
  never reaches Bifrost (tests at smoke.test.ts:319-324 and install-smoke AC-5 assert this). Correct.
- `storedApiKey` (personal-config-edit.ts:196-209): a non-empty string header wins, otherwise falls back to
  `bifrost.options.apiKey` unchanged. Its only caller is the update path (install-helper.ts:302), and both the
  hint and the smoke key come from it. That matches the contract. The accepted gaps (header beats a fresh KILO_BIFROST_KEY,
  and the apiKey placeholder still written) are documented in ADR-0022 Consequences and contract section 7/9. I agree they are low.
- The change is small: one helper per file and no new codes, lines or exit codes.
- Tests: every Bearer assertion has moved to `x-bf-vk`, and exact-header `deepEqual` assertions still prove that no
  `Authorization` header is sent. The new fallback/precedence test checks the request URL, so it fails if the
  fallback or the precedence breaks. The new storedApiKey test covers header-over-apiKey and apiKey-only.
  Gaps (non-blocking, see follow-ups): no test pins "present non-string bifrost does not fall back" or
  "empty/non-string header falls back to apiKey"; mutating `own !== undefined` to `typeof own === "string"`, or
  dropping `headerKey !== ""`, survives the suite.
- Fake-network fixture: `header?: string` defaults to `"authorization"`, so existing scenarios behave byte-for-byte
  as before. The lookup is against lower-cased collected names, so callers must pass a lower-case name (all do).

### Docs (e51246f), reviewed
ADR-0022, installer-cli.md 1.4.0 (version line, sections 7, 9, 9.2 row 2 plus the selection paragraph, request
headers, never-printed), the overview and the ADR-0013 amendment note all match the code. The architecture README points at ADR-0022.

## Files changed
- `factory/runs/cycle-0027/05-review-rerun1.md` — this report.

## Verification
- `bash scripts/ci.sh` → exit 0, `ci: PASS` (726 tests, 716 pass, 0 fail, 10 skipped; check-lf PASS; check-docs PASS, 38 files)
- `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` (backend/) → PASS
- `wc -l backend/plugin/azdo-remote-config.ts` → 1838; max comment line length 110

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | low (blocking: contract mismatch) | architect | `docs/architecture/contracts/e2e-harness.md:76` and `:81` | The contract pins the `auth` variant as `{ mode: "auth"; authorization: string; answer }` with match rule `headers["authorization"] === authorization`. The fixture (`backend/test/installer/fixtures/fake-network.ts:13,95`) now has `header?: string` and matches `headers[header ?? "authorization"]`, and `e2e/startup.test.ts:50` depends on it. The contract (line 12-13) requires that it is "updated at the same time" as the fixture. Scenario: a later test item follows the contract, and either removes `header` as undocumented (which breaks the e2e Bifrost scenario: 401 instead of pass) or writes `header: "X-BF-VK"` expecting a case-insensitive match and gets a 401. | Bump e2e-harness.md to 1.1.1 (cycle-0027, ADR-0022). Add `header?: string` to the type at line 76. Change the Match row to `headers[header ?? "authorization"] === authorization`, with `header` a lower-case header name (default `authorization`). Optionally update the ADR-0016:138 example pointer or note it as historical. Docs only; no code change. |
| 2 | low (non-blocking, docs phase) | docs writer | `docs/user-guide.md:565` (and `:524`) | The `no-base-url` row still says "shared config has no `provider.bifrost.options.baseURL` string". Since 1.4.0 the azurefoundry fallback applies. | Docs phase: update the row and mention the `provider.azurefoundry` fallback and `x-bf-vk` in the smoke section. |
| 3 | info (non-blocking) | backend | `backend/test/installer/smoke.test.ts:1065-1085` | Two documented ADR-0022 rules have no test. A present non-string bifrost baseURL must not fall back. An empty or non-string header must fall back to apiKey. Both mutations survive. | Follow-up: add the two cases. |
| 4 | info (non-blocking) | orchestrator | PR | AC-2 of T-038 is literally exceeded by the user-directed ride-along (installer, tests, architecture docs). | The PR body must list 7701a9b and e51246f as user-directed out-of-band changes. |

## Assumptions made (no human available)
- Finding 1 is blocking because the review rule is "contract mismatch → FAIL" and the contract itself demands a
  same-time update. The fix is a docs-only edit in the architect lane and needs no code rework or security re-check.
- The accepted known gaps (header beats a fresh KILO_BIFROST_KEY; apiKey placeholder still written) are low and
  documented, so they are not flagged.
- The untracked root `kilo.jsonc` is intentionally excluded and not reviewed.

## Follow-ups for the backlog
- Tests for ADR-0022 edge rules (finding 3).
- Carried over: header-vs-fresh-key hint wording; installer writing the key into `azurefoundry.options.headers` (ADR-0022 alternative 3).
- Carried over from 05-review.md: T-039 ADR-0021 3.2 alignment; readCache full cache-* code names; readCappedBody hostile-chunk guards.

FACTORY_RESULT
status: FAIL
report: factory/runs/cycle-0027/05-review-rerun1.md
summary: Prior findings 1-3 fixed and CI passes; ride-along installer code is correct, but contracts/e2e-harness.md was not updated for the fake-network `header` field (contract mismatch, architect, docs-only fix).
