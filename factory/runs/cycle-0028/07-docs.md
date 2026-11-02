# Docs report — cycle 0028 — T-040: installer skips redundant bifrost block

## Inputs read
- ADR-0023, docs/architecture/contracts/installer-cli.md 1.5.0, 05-review.md, existing docs.

## Work done
- Replaced the old "header wins over KILO_BIFROST_KEY" caveat with the 1.5.0 behaviour: header present means no bifrost block, header kept without a key, KILO_BIFROST_KEY replaces the header value; otherwise unchanged.
- Stated the known follow-up: key hint text still names provider.bifrost.options.apiKey when the key lives in the header.

## Files changed
- `docs/user-guide.md` — Smoke test key section and "What it writes".
- `docs/troubleshooting.md` — Bifrost 401 section.
- `docs/development.md` — T-040 / ADR-0023 note.

## Verification
- `node tools/check-docs.mjs` (from backend/) -> PASS (39 markdown files checked)
- Grep of docs/ (excluding architecture) shows no remaining "wins over KILO_BIFROST_KEY" wording.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- README.md and docs/api.md unchanged: no endpoint or command changes.

## Follow-ups for the backlog
- Make the installer key hint name the x-bf-vk header when the key lives there.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0028/07-docs.md
summary: Docs updated for T-040 header-follows-key installer behaviour
