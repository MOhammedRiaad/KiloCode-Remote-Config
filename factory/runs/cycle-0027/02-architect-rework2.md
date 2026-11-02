# Architect report (rework 2) — cycle 0027 — T-038: plugin JSDoc trim pass and wording fixes

## Inputs read
- Review re-check 1 finding #1 (contract mismatch, `contracts/e2e-harness.md:76`, `:81`).
- `backend/test/installer/fixtures/fake-network.ts` (lines 13, 95: `header?: string`, match on `headers[answer.header ?? "authorization"]`).
- `backend/test/e2e/startup.test.ts` (lines 43-53: AzDO `auth` without `header`; Bifrost `auth` with `header: "x-bf-vk"`).
- `docs/architecture/ADR-0016`, `ADR-0022`, `overview.md`, `README.md`.

## Work done
- `contracts/e2e-harness.md` bumped 1.1.0 -> 1.1.1 (cycle-0027, ADR-0022):
  - `FakeAnswer` `auth` variant is now `{ mode: "auth"; authorization: string; header?: string; answer: FakeStaticAnswer }`.
  - Match rule is now `headers[header ?? "authorization"] === authorization`. `header` must be a lower-case header name, because names are collected lower-cased, so `"X-BF-VK"` never matches. If `header` is absent the default is `"authorization"`, which keeps the old behaviour byte-for-byte. The field `authorization` holds the expected value of whichever header is checked.
  - Added a row with the exact F-014 scenario values. AzDO uses `Authorization: Basic <PAT>` (default header). Bifrost uses `header: "x-bf-vk"` with the key (up to 1.1.0 it was `Authorization: Bearer <key>`). The row also says that dropping `header` gives a 401.
- ADR-0016: added an "Amended by ADR-0022" note under the old fake-Bifrost `Bearer` example. The historical text is kept and the contract is named as authoritative.
- ADR-0022 Consequences: recorded the e2e-harness 1.1.0 -> 1.1.1 change.
- overview.md: the e2e data flow now says the fake Bifrost checks `x-bf-vk: <key>` and AzDO checks `Authorization: Basic <PAT>`. Added a fixture-layout comment for the `header` name.
- README.md: the latest-ADR line now also names `contracts/e2e-harness.md` 1.1.1.

## Files changed
- `docs/architecture/contracts/e2e-harness.md` — version 1.1.1, `header?` field, match rule, scenario values.
- `docs/architecture/ADR-0016-e2e-simulated-startup-harness.md` — amendment note.
- `docs/architecture/ADR-0022-smoke-bifrost-azurefoundry-fallback-and-x-bf-vk.md` — consequence bullet for the test contract bump.
- `docs/architecture/overview.md` — e2e data-flow and layout comments (x-bf-vk).
- `docs/architecture/README.md` — latest-ADR line.

No changes to `backend/`, `frontend/` or `kilo.jsonc`.

## Verification
- `node tools/check-docs.mjs` (in `backend/`) -> `check-docs: PASS (38 markdown files checked)`, exit 0.
- `node --test test/installer/install-ps1-static.test.ts test/plugin/source-layout.test.ts` -> 13 pass, 0 fail. install-ps1-static reads only `installer-cli.md`, which this rework did not touch. source-layout checks that the `@see contracts/... section N` targets exist; the e2e-harness section headings did not change.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| — | — | — | Review finding #1 is resolved: the contract now matches the fixture and test. | — |

## Assumptions made (no human available)
- I treated this as a patch bump (1.1.1) and not a minor one, as the reviewer prescribed. The field is optional and the default keeps the old behaviour.
- I left the historical text in ADR-0016 as it was and added an amendment note, so the decision record stays accurate as history.

## Follow-ups for the backlog
- None.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/02-architect-rework2.md
summary: e2e-harness contract 1.1.1 adds the lower-case optional `header` to the fake-network `auth` answer (match headers[header ?? "authorization"]); the e2e fake Bifrost is documented as x-bf-vk across ADR-0016/0022, overview and README; check-docs PASS.
