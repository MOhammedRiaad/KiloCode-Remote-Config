# Architect report — cycle 0027 — T-038 (ride-along): smoke test azurefoundry baseURL fallback and x-bf-vk header

## Inputs read
- `git show 7701a9b` (user-directed out-of-band change: `backend/installer/smoke.ts`,
  `backend/installer/personal-config-edit.ts`, tests)
- `backend/installer/install-helper.ts` (how `storedApiKey` feeds `effectiveApiKey` / `needsKeyHint`)
- `docs/architecture/contracts/installer-cli.md`, `ADR-0013`, `overview.md`, `README.md`

## Work done
- New ADR-0022 recording the decision: (1) shared baseURL = `provider.bifrost.options.baseURL`,
  falling back to `provider.azurefoundry.options.baseURL` only when the bifrost path is absent
  (bifrost wins when both exist; a present non-string bifrost value does not fall back);
  (2) the Bifrost request sends exactly `Accept: application/json` and `x-bf-vk: <effective key>`, no
  `Authorization`; AzDO auth unchanged; (3) update-path effective key = personal
  `provider.azurefoundry.options.headers["x-bf-vk"]` when a non-empty string, else
  `provider.bifrost.options.apiKey`; (4) key validation and no-leak guarantees unchanged;
  (5) write phase unchanged.
- `installer-cli.md` bumped 1.3.2 -> 1.4.0: version note; section 7 key-hint condition now refers
  to the effective key; no-key smoke hint annotated with the known gap (wording unchanged);
  "Never printed" now explicitly covers the key whether from `apiKey` or the `x-bf-vk` header;
  section 9 effective-key definition rewritten (including header-wins-over-`KILO_BIFROST_KEY`
  on update); section 9.2 row 2 now refers to the "selected shared baseURL" with a precise
  selection paragraph; request header line now `x-bf-vk: <effective key>`.
- `overview.md` install data flow updated (baseURL fallback, `x-bf-vk`).
- `ADR-0013` gains an "Amended by: ADR-0022" line; `README.md` (no ADR index exists) gains a
  "Latest ADR" pointer.

## Files changed
- `docs/architecture/ADR-0022-smoke-bifrost-azurefoundry-fallback-and-x-bf-vk.md` — new ADR
- `docs/architecture/contracts/installer-cli.md` — 1.4.0, sections 7, 9, 9.2
- `docs/architecture/overview.md` — smoke data flow
- `docs/architecture/ADR-0013-installer-smoke-test.md` — amended-by line
- `docs/architecture/README.md` — pointer to ADR-0022

## Verification
- `node tools/check-docs.mjs` (backend) -> PASS (38 markdown files)
- `node --test test/installer/install-ps1-static.test.ts` (reads the contract) -> 0 failures
- Contract text cross-checked against `smoke.ts` `readSharedBaseUrl` / `modelsUrl` and
  `personal-config-edit.ts` `storedApiKey` / `install-helper.ts` lines 291-305.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/installer/install-helper.ts:302 | On update a non-empty azurefoundry `x-bf-vk` header wins over a freshly supplied `KILO_BIFROST_KEY`; the "Smoke test: set KILO_BIFROST_KEY ..." hint can then mislead (e.g. header holds the placeholder). Documented in contract and ADR. | None this cycle; follow-up |
| 2 | info | backend/installer/smoke.ts:409 | Security: the key now travels in `x-bf-vk` instead of `Authorization`; still only to the validated https models URL, redirect manual, never to AzDO, never printed. PAT / az token never sent to Bifrost. | None |

## Assumptions made (no human available)
- The installer still writes the `provider.bifrost.options.apiKey` placeholder (or `KILO_BIFROST_KEY`)
  when creating / updating the personal config, and never writes `provider.azurefoundry` — unchanged
  by 7701a9b; follow-up candidate.
- Contract bump is minor (1.4.0) because the on-the-wire request header and input sources changed,
  although no new input, line, code or exit code was added.
- `README.md` has no ADR index table; a single "Latest ADR" pointer was added instead of creating one.
- Help text (section 10, `install.ps1 -Help`) "calls Bifrost GET <baseURL>/models" is still accurate
  and was not changed (it is also asserted by `install-ps1-static.test.ts`).

## Follow-ups for the backlog
- Installer write phase: optionally write `KILO_BIFROST_KEY` into
  `provider.azurefoundry.options.headers["x-bf-vk"]` when the personal config uses that shape (or
  stop writing the `bifrost.apiKey` placeholder), and update the personal config template
  (ADR-0011 / ADR-0012).
- Reword the no-key smoke hint / key hint to mention the `x-bf-vk` header location.
- User docs (`docs/` installer / troubleshooting pages) may still say `Authorization: Bearer` /
  `provider.bifrost.options.baseURL` — docs writer to check.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/02-architect-smoke-contract.md
summary: ADR-0022 + installer-cli 1.4.0 record the smoke azurefoundry baseURL fallback, x-bf-vk header and header-first effective key.
