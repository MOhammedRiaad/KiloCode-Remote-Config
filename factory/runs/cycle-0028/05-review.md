# Code Review report — cycle 0028 — T-040: Installer: align written key with the key the smoke test checks

## Inputs read
- `git diff main...HEAD` (a1b8f92 code + test, 2701125 docs); working tree clean (untracked root `kilo.jsonc` ignored as instructed)
- `factory/backlog.json` T-040 (acceptance criteria + notes), `factory/runs/cycle-0028/02-architect.md`
- `docs/architecture/contracts/installer-cli.md` 1.5.0, ADR-0023, ADR-0022/ADR-0012 amendments, `overview.md`, `README.md`
- `backend/installer/personal-config-edit.ts`, `backend/installer/install-helper.ts` (planConfig, run, hint),
  `backend/installer/install.sh`, `backend/installer/install.ps1` (key forwarding only)

## Work done
- Ran the full gate.
- Traced the key flow: `planConfig` -> `planUpdate` -> `applyKey` -> `storedApiKey(update.result)` ->
  `plan.effectiveApiKey` / `needsKeyHint` -> `runSmoke`. The `keyHeaders` predicate
  (`personal-config-edit.ts:163-171`) is the same as the header branch of `storedApiKey` (`:220-226`):
  plain-object `provider` / `azurefoundry` / `options` / `headers`, and a non-empty string `x-bf-vk`.
  So whatever `applyKey` writes is what `storedApiKey` returns, and that value goes to the smoke test.
- Ran these edge cases by hand on `planUpdate` (scratch script; no product code changed):
  - Header present, `provider.bifrost` is a string: no exit 3, bifrost left as is, key replaced.
  - Header present plus a stale `bifrost.apiKey`: the block is kept and not deleted; the effective key is the header.
  - Empty-string header: falls back to the 1.4.0 bifrost path (placeholder, or the supplied key in `apiKey`).
  - Placeholder header with no key: effective key is the placeholder, so the hint shows (contract section 7 rule).
  - Placeholder header with a key supplied: the key replaces the header.
  - Supplied key equal to the header: `changed=false`, so there is no write and no backup.
- Ran an end-to-end check of `install-helper.ts` (smoke off) against a commented azurefoundry-shaped `kilo.jsonc`
  in a scratch `XDG_CONFIG_HOME`. There were 3 runs: (1) no key, (2) a new key, (3) the same key again.
  - Run 1: updated with a backup; header kept; no `bifrost` text in the file; no hint.
  - Run 2: updated with a backup; header replaced.
  - Run 3: "Personal config already up to date", no backup.
  - All runs exited 0, and no key value appeared in the output.
- `install.sh` / `install.ps1` only forward `apiKey=` as a stdin record. They have no config logic, so the change does not affect them.
- Hint text in `install-helper.ts:408` matches contract section 7 line 251 word for word. The trigger
  (`effectiveKey === PLACEHOLDER_KEY`, `install-helper.ts:305`) matches the contract rule. The hint still names
  `provider.bifrost.options.apiKey`. This is known and accepted (follow-up).
- Lanes: product code changed only under `backend/`; no `frontend/`, `scripts/`, `.github/`, `CHANGELOG.md`, `VERSION` edits.
  Docs are architect-owned (`docs/architecture/`); `factory/` edits are orchestrator/PO.
- Diff is minimal: 17 lines of product code, 1 focused test.

## Acceptance criteria coverage
| AC | Code | Test that fails if broken |
|----|------|---------------------------|
| Header differs from supplied key -> written key == smoke-tested key | `personal-config-edit.ts:175-178` | `personal-config-edit.test.ts:167` asserts `storedApiKey(replaced.result) === "sk-bf-new"`; `storedApiKey(update.result)` is exactly what `install-helper.ts:302,414` passes to `runSmoke` |
| Azurefoundry-shaped config -> no bifrost.apiKey placeholder added | `personal-config-edit.ts:175-179` (early return before `childObject(provider,"bifrost")`) | `personal-config-edit.test.ts:167` asserts `Object.hasOwn(provider, "bifrost") === false` for no-key and key cases |

## Files changed
- `factory/runs/cycle-0028/05-review.md` — this report

## Verification
- `bash scripts/ci.sh` -> exit 0 (tests 727, pass 717, fail 0, skipped 10; check-lf PASS; check-docs PASS, 39 files)
- Scratch `planUpdate` edge-case script: all outputs match contract 1.5.0 section 5 step 2.
- Scratch end-to-end helper run (smoke off), 3 runs: exit 0 each; written file and stdout as described above.

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | low | backend | `backend/test/installer/personal-config-edit.test.ts:167` | Three contract 1.5.0 rules have no test: (a) an existing `provider.bifrost` is kept unchanged on the header path; (b) a non-object `provider.bifrost` with a key header is not exit 3; (c) an empty-string header falls back to the bifrost path. Today's code is correct for all three (checked by hand). A regression in (a) would go unnoticed. | Non-blocking: add cases in a follow-up |
| 2 | low | backend | `backend/test/installer/install-smoke.test.ts` (none) | There is no helper-level or `install.sh` / `install.ps1` end-to-end test with an azurefoundry-shaped existing config. Not blocking: the helper wiring (`planUpdate` -> `storedApiKey(result)` -> `runSmoke`) is unchanged and already covered on the bifrost path, and the unit test asserts on the exact value the helper forwards. I also checked the end-to-end behaviour by hand. | Non-blocking: follow-up test asserting the fake Bifrost receives the supplied key in `x-bf-vk` |
| 3 | info | docs writer | `docs/user-guide.md:529-531`, `docs/troubleshooting.md:133` | User docs still describe the 1.4.0 caveat ("header wins over a freshly supplied KILO_BIFROST_KEY ... installer still writes the new key to provider.bifrost.options.apiKey"). This is now wrong. | Docs phase of this cycle must update both to contract 1.5.0 |

No correctness bugs, no contract mismatches, no weakened tests.

## Assumptions made (no human available)
- No end-to-end test is not blocking. The ACs are covered at the level where the behaviour changed, and the helper glue is unchanged.
- Stale user docs (finding 3) are not blocking for code review. The docs writer runs later in this cycle and owns `docs/` outside architecture.

## Follow-ups for the backlog
- The hint `Set your Bifrost virtual key: ... edit provider.bifrost.options.apiKey` should name the `x-bf-vk` header when the key lives there (already known).
- Add unit cases for findings 1a-1c, and a helper-level smoke test with a key header plus `KILO_BIFROST_KEY` (finding 2).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0028/05-review.md
summary: T-040 header-first key write is correct against installer-cli 1.5.0 and CI passes; both ACs are tested; only non-blocking test-gap and user-docs follow-ups remain
