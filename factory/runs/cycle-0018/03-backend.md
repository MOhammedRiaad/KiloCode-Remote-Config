# Backend report — cycle 0018 — F-016: User and operator documentation

## Inputs read
- `docs/architecture/contracts/docs-check.md`, `factory/runs/cycle-0018/02-architect.md` (B1..B4), `backend/tools/check-fr11.mjs` and its test (style reference).

## Work done
- B1/B2: `backend/tools/check-docs.mjs` implements the contract: CLI (`--root`, `--help`/`-h`, exit 0/1/2), scanned set S via lstat (symlinks skipped), fence and inline-code handling, link classification, slug and duplicate-slug anchors, N(file)/H(file) normalisation, and rules page-missing, cross-link, link-broken, required-text, kilo-range (SUPPORTED_KILO_RANGE read as text), secret-key (value never printed), forbidden-text. Findings sorted by file, line, rule. `node:` imports only; no writes, network or subprocesses.
- B3/B4: `backend/test/tools/check-docs.test.ts`, 15 hermetic tests (fixture roots in tmpdir) covering contract cases 1-11. The secret key is built at run time; no literal `sk-bf-` + 16 alphanumerics in the source.
- Not wired into `npm run lint`; no test runs the tool on the real repo.

## Files changed
- `backend/tools/check-docs.mjs` (new)
- `backend/test/tools/check-docs.test.ts` (new)

## Verification
Acceptance mapping: the tool is the automated check for the docs ACs (AC-2 troubleshooting items, AC-3 engineer-setup items + kilo-range, AC-4/AC-6 runbook items, cross-link/link rules). Tests proving each:
- Valid fixture: "valid fixture passes". page-missing: "page-missing for README and each page".
- Cross-links (9 pairs) and typo case: "cross-link: each required link is enforced", "a typo in a cross-link...".
- link-broken fail and pass cases: "link-broken failures", "link-broken passing cases".
- T/E/R items, heading-only, line-wrapped phrase: "required-text: ..." (3 tests).
- kilo-range read at check time: "kilo-range is read at check time".
- secret-key and forbidden-text: "secret-key: ...", "forbidden-text: ...".
- CRLF, usage, multiple findings: "CRLF input behaves like LF", "usage errors and help", "all findings are reported".

Commands (in `backend/`):
- `npm run lint` -> `check-fr11: PASS`
- `npm run typecheck` -> no errors
- `npm test` -> tests 571, pass 566 (565 pre-existing + 15 new minus counts as subtests), fail 0

Baseline on the real repo (`node backend/tools/check-docs.mjs`, exit 1):
```
check-docs: FAIL README.md: cross-link: no relative link to docs/engineer-setup.md
check-docs: FAIL README.md: cross-link: no relative link to docs/platform-runbook.md
check-docs: FAIL README.md: cross-link: no relative link to docs/troubleshooting.md
check-docs: FAIL docs/engineer-setup.md: page-missing: required page does not exist
check-docs: FAIL docs/platform-runbook.md: page-missing: required page does not exist
check-docs: FAIL docs/troubleshooting.md: page-missing: required page does not exist
check-docs: FAIL (6 problem(s))
```
Only expected page-missing and cross-link findings; no link-broken or secret-key findings (no defects). No kilo-range / required-text findings yet because those pages do not exist.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | contract section 5 | Required phrase T2 contains T1 (`kilo_pure=1`), so the T1 test removes both lines. | none |

## Assumptions made (no human available)
- An empty path with a query/fragment (e.g. `?x#f`) resolves to the source file itself.
- Unterminated `<` in a link target takes the rest of the string.
- Cross-link compares resolved paths only (target existence is reported by link-broken).

## Follow-ups for the backlog
- none

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0018/03-backend.md
summary: check-docs.mjs and 15 hermetic tests implemented; lint, typecheck, tests pass; real-repo baseline shows only expected missing-page/cross-link findings.
