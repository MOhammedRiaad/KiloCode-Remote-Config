# Architect report — cycle 0028 — T-040: Installer: align written key with the key the smoke test checks

## Inputs read
- `git show a1b8f92` (`backend/installer/personal-config-edit.ts` `keyHeaders` / `applyKey`,
  `backend/test/installer/personal-config-edit.test.ts`)
- `backend/installer/install-helper.ts` (hint wording, unchanged)
- `docs/architecture/ADR-0022-...md`, `ADR-0012-...md`, `ADR-0013-...md`, `overview.md`, `README.md`
- `docs/architecture/contracts/installer-cli.md` 1.4.0

## Work done
- New ADR-0023 (cleaner than rewriting the accepted ADR-0022): on update, when the existing
  config has a non-empty string at `provider.azurefoundry.options.headers["x-bf-vk"]` ("key
  header"), a supplied `KILO_BIFROST_KEY` replaces the header and nothing under
  `provider.bifrost` is created/changed/validated/deleted. Otherwise 1.4.0 rules unchanged; fresh
  unchanged. Invariant: written key == smoke-tested key. Key-header predicate is identical to the
  `storedApiKey` read rule.
- ADR-0022: "Amended by ADR-0023" header; decision 5 and first consequence marked superseded/resolved.
- ADR-0012: "Amended by ADR-0023" header line.
- `contracts/installer-cli.md` 1.4.0 -> 1.5.0:
  - Version entry (1.4.0 entry kept as history, its "write phase unchanged" annotated).
  - Section 2 `KILO_BIFROST_KEY` row: key goes to the key header when present, else `bifrost.apiKey`;
    placeholder only when neither header nor `apiKey` exists.
  - Section 3 exit-3 row: the `provider.bifrost` / `.options` non-object checks apply only without a key header.
  - Section 5 step 2 rewritten (key header present / absent sub-rules; never creates the header,
    never deletes an existing bifrost block).
  - Section 7: hint notes updated; 1.4.0 "known gap" removed (closed); "Never printed" extended to
    the old/new value of a replaced header.
  - Section 9: "header wins over a supplied KILO_BIFROST_KEY" caveat replaced by the 1.5.0 invariant.
- `overview.md`: ADR list pointer and install data-flow line for the key location.
- `README.md`: latest ADR -> ADR-0023, contract 1.5.0.

## Files changed
- `docs/architecture/ADR-0023-installer-key-follows-x-bf-vk-header.md` — new decision record
- `docs/architecture/ADR-0022-smoke-bifrost-azurefoundry-fallback-and-x-bf-vk.md` — amended-by pointer
- `docs/architecture/ADR-0012-posix-bootstrap-installer.md` — amended-by pointer
- `docs/architecture/contracts/installer-cli.md` — 1.5.0
- `docs/architecture/overview.md`, `docs/architecture/README.md` — pointers

## Verification
- `node tools/check-docs.mjs` (from `backend/`) -> `Check-docs: PASS (39 markdown files checked)`, exit 0
- `node --test test/installer/install-ps1-static.test.ts test/installer/personal-config-edit.test.ts`
  -> 23 pass, 0 fail (install-ps1-static is the only test reading the contract)

## Backend tasks
None. Implementation already in commit a1b8f92 and matches contract 1.5.0 section 5 step 2.
Optional (not required for this item): a helper-level test (`install-smoke.test.ts`) that runs an
update with a key header + `KILO_BIFROST_KEY` and asserts the smoke request carries the supplied key.

## Frontend tasks
None (no frontend in this product area).

## Security notes (for the Security engineer)
- No new input, output line or argv use; the key is never printed (contract section 7 extended
  to cover old and new header values). Validation of `KILO_BIFROST_KEY` unchanged on the header path.
- A header holding `{env:`/`{file:` is replaced by a literal key when one is supplied: same as the
  long-standing `bifrost.apiKey` behaviour; file mode `0600` / inherited ACL unchanged; backup keeps old bytes at `0600`.
- An existing `provider.bifrost.apiKey` is not updated on the header path and may hold a stale
  key: it is never deleted (installer does not delete user content). Accepted in ADR-0023.
- With a key header, a non-object `provider.bifrost` is no longer an exit-3 error (it is untouched).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- New ADR-0023 instead of rewriting ADR-0022 — keeps the accepted record intact; amended-by pointers added.
- Contract minor bump (1.5.0) — the write phase behaviour changes; no new inputs/outputs.
- Hint wording `... or edit provider.bifrost.options.apiKey in <path>.` left unchanged (code unchanged).

## Follow-ups for the backlog
- Make the "Set your Bifrost virtual key" hint name the `x-bf-vk` header when the key lives there.
- Optional helper-level integration test for the header-replacement path.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0028/02-architect.md
summary: ADR-0023 + installer-cli 1.5.0 document header-first key write (no redundant bifrost block); docs check and contract tests pass
