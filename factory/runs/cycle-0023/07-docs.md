# Docs report — cycle 0023 — F-021 (+ reduced F-022)

## Inputs read
- factory/backlog.json (F-021, F-022), plugin-interface.md 0.9.0, ADR-0020, existing docs pages, branch diff stat.

## Work done
- Documented the plugin codes network-unreachable, network-blocked, timeout, http-401/403, network, with the two exact hint lines and cache ordering.
- F-022 ACs: codes with actions, exact hints, JSON vs non-JSON 403/407 distinction and IP conditional-access limit, origin-probe caveat, cached config kept while blocked, check-docs passes.

## Files changed
- `docs/troubleshooting.md` — new section for plugin network codes and hints, curl cross-reference.
- `docs/user-guide.md` — hint rows in log table, code table, hint/cache order.
- `docs/api.md` — fetchRemoteConfig code table, behaviour change, contract 0.9.0 / ADR-0020 citation.
- `docs/platform-runbook.md` — "Telling block types apart" (org IP policy vs WAF, smoke line differences).
- `docs/development.md` — new F-021 test blocks.
- README.md not changed (lists no error codes).

## Verification
- `node backend/tools/check-docs.mjs` -> PASS (36 files).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Test-block names in development.md taken from the diff's test titles.

## Follow-ups for the backlog
- Classify Azure Firewall HTTP 470 and 203 HTML sign-in pages.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0023/07-docs.md
summary: Docs for F-021 plugin network codes and hints (and reduced F-022) updated; docs check passes.
