# Code Review report — cycle 0024 — T-035: Firewall hint on the authenticated smoke lines and Azure Firewall HTTP 470 classified as blocked

## Inputs read
- `git diff main...HEAD` (working tree clean), `factory/backlog.json` (T-035, 7 ACs), `01-product-owner.md`,
  `02-architect.md`, `03-backend.md`, `04-security.md`, `docs/architecture/contracts/installer-cli.md` 1.3.2 (sections 7, 9.0, 9.4),
  `docs/architecture/contracts/plugin-interface.md` 0.9.1 (2e row 7a), ADR-0019 A1, ADR-0020 A1, `docs/architecture/overview.md`.

## Work done
- Ran the full quality gate: `bash scripts/ci.sh` -> exit 0 (702 tests, 692 pass, 0 fail, 10 skipped; check-lf PASS; check-docs PASS; `ci: PASS`).
- Checked the code against the contract:
  - `smoke.ts` `classifyProbeStatus`: 403/407/470 blocked, undefined unreachable, others reachable (installer-cli 9.0).
  - `smoke.ts` `needsNetworkHint` = N1 (unchanged network rule) OR N2 (azdo `fail` and code exactly `network-unreachable|network-blocked|timeout`) OR N3 (bifrost `fail` and code exactly `network|timeout|407|470`). `failedWith` reads `status`/`code` via `attempt`, requires a primitive string and uses `Array.includes` (exact equality, no coercion). Matches 9.4 exactly.
  - Hint pushed at most once (single `if`), after the no-key hint, last line; text unchanged; only `${frontEnd}` varies.
  - `azdo-remote-config.ts` `codeForStatus`: `407 || 470` returns `network-blocked` before any `readContentType` call, so Content-Type is not read for 470 (plugin-interface 2e row 7a). One file, no new import, no new constant, `__internals` untouched.
  - `install-helper.ts`, `install.sh`, `install.ps1`: not in the diff (confirmed with `git diff --stat`).
- Ran 13 mutations on a scratch copy (`git archive HEAD backend`, never in the repo). All were killed:

| # | Mutation | Tests run | Result |
|---|----------|-----------|--------|
| M1 | drop 470 from `classifyProbeStatus` | smoke + install-smoke | 4 fail |
| M2 | drop 470 from `codeForStatus` | fetch + hook | 5 fail |
| M3 | azdo `network` adds the hint | smoke | 1 fail |
| M4 | bifrost `401` adds the hint | smoke | 1 fail |
| M5 | N2/N3 use a substring match instead of exact equality | smoke | 1 fail |
| M6 | hint printed twice (extra azdo push) | smoke | 5 fail |
| M7 | network hint before the no-key hint | smoke | 1 fail |
| M8 | N3 removed | smoke + install-smoke | 5 fail |
| M9 | N2 removed | smoke + install-smoke | 7 fail |
| M10 | `skipped` counts as qualifying | smoke | 2 fail |
| M11 | 470 reads Content-Type before returning | fetch | 1 fail |
| M12 | bifrost `407` dropped from N3 | smoke | 2 fail |
| M13 | front-end name fixed to `install.sh` in the network hint | smoke | 2 fail |

- Checked the six existing tests that now expect different output (all stricter, none deleted or weakened):
  1. `smoke.test.ts` F-021 AC-7a: the exact expected array gains `HINT_SH`, plus a count == 1 assertion. This is the intended behaviour change and it is pinned more tightly.
  2. `classifyProbeStatus` table: adds rows for 469, 470 and 471, and removes none.
  3. Bifrost-origin withheld-key loop: `[403, 407]` becomes `[403, 407, 470]`, with the same assertions.
  4. Authenticated timeout and throwing-fetch tests: the earlier report assertions are kept, and exact `formatSmoke` equality is added.
  5. `install-smoke.test.ts` azdo/bifrost `fail timeout`: the anchored regex now also requires the hint line before `Done.`.
  6. `install-smoke.test.ts` F-021 AC-7b: the exact stdout tail now includes `HINT_SH`, and the request count and no-secret checks are kept.
- Checked the engineer's deviation. Their report says the throwing-getter case was dropped from the smoke formatter test. `fetch.test.ts` AC-5 does include a throwing `get` for 470. For `formatSmoke`, `formatLine` was already unguarded before this change, and `runSmoke` only builds plain data objects, so a throwing getter can only come from a hand-built report. The new N2/N3 decision itself is guarded. This is consistent with security I1, so I accept it.
- Maintainability: `needsNetworkHint` and `failedWith` are small, named after the contract rule (N1/N2/N3 comment at the file header), and the code lists are `readonly` constants. Nothing is duplicated and no code is left unused. The old `hasNetworkCondition` was removed, not left behind.
- User scenario (an engineer off the VPN, behind an Azure IP firewall):
  - When the pre-flight fails (403/407/470/unreachable/timeout), N1 shows the hint, as before.
  - When the pre-flight passes but the authenticated call is reset, refused, times out or gets 403-HTML/407/470 from AzDO, N2 shows the hint.
  - When Bifrost's authenticated call gets network/timeout/407/470, N3 shows the hint.
  - Credential and content failures (http-401/403-JSON/404, invalid-jsonc, bifrost 401/403/500, invalid-key, no-key) show no network hint. The plugin side shows the NETWORK hint for 470.
  - Remaining gap, by design of the contract: an AzDO conditional-access IP policy answers with a JSON 401/403 (`http-401`/`http-403`), so it gets no network hint. See the follow-ups.

## Files changed
- `factory/runs/cycle-0024/05-review.md` — this report.

## Verification
- `bash scripts/ci.sh` -> exit 0 (`ci: PASS`, 692 pass / 0 fail / 10 skipped).
- 13 of 13 scratch mutations killed (table above).

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | info | docs writer | `docs/development.md:109` | Says the authenticated-request failure after a passing pre-flight "exits 4 with no network hint". This is stale since T-035. | Update during the Docs phase of this cycle (not a code defect, outside the engineers' lanes). |
| 2 | info | backend | `backend/installer/smoke.ts:494` (`formatLine`) | Reads `status`/`code` without a guard. This is not new code: a hand-built report with throwing getters throws in `formatSmoke`. `runSmoke` never produces such a report. | None this cycle (agrees with security I1 and the engineer's finding 1). |

No blocking findings.

## Assumptions made (no human available)
- I judged the remaining AzDO conditional-access case (JSON 401/403, no hint) against the contract, which deliberately keeps `http-403`/`http-401` hint-free. It is not a defect in this item.

## Follow-ups for the backlog
- Consider a distinct hint for AzDO conditional-access IP policy denials (JSON 401/403 carrying a `VS403463`-style message), without reading or echoing the body text into output. This would need a contract decision.
- Optionally guard `formatLine` with `attempt`, so `formatSmoke` handles a malformed report without throwing.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0024/05-review.md
summary: T-035 passes review: CI exits 0, the code matches contract rule N1|N2|N3 and the 470 handling, all 7 ACs have tests, 13/13 mutations killed, 6 re-expected tests are stricter; 2 info findings.
