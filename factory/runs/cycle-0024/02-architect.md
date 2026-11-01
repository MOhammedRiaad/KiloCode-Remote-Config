# Architect report — cycle 0024 — T-035: Firewall hint on the authenticated smoke lines and Azure Firewall HTTP 470 classified as blocked

## Inputs read
- `factory/runs/cycle-0024/01-product-owner.md` (T-035, 7 ACs)
- `docs/architecture/ADR-0019-installer-network-preflight.md`, `ADR-0020-plugin-fetch-network-classification.md`
- `docs/architecture/contracts/installer-cli.md` (1.3.1), `contracts/plugin-interface.md` (0.9.0), `overview.md`
- `backend/installer/smoke.ts`, `backend/plugin/azdo-remote-config.ts` (`codeForStatus`, `handleResponse`, `hintFor`, `runFetch`)
- Tests: `backend/test/installer/smoke.test.ts`, `install-smoke.test.ts`, `install-ps1-smoke.test.ts`, `backend/test/plugin/fetch.test.ts`, `hook.test.ts`, `backend/test/e2e/startup.test.ts`, fixture `fake-network.ts`
- `docs/troubleshooting.md`, `docs/user-guide.md`, `docs/platform-runbook.md`, `docs/api.md`, `docs/development.md` (for the docs-writer list)

## Work done
Small change, so no new ADR. ADR-0019 and ADR-0020 are amended (A1 in each), and both contracts get a patch bump.

### Design summary
1. **Smoke hint rule (installer-cli 1.3.2, new section 9.4; ADR-0019 A1.2).** The output order is unchanged: network line, azdo line, bifrost line, no-key hint, then the network hint. The network hint (section 7 text, unchanged, named per front end) is printed **at most once, as the last line**, when any of these holds:

   | Rule | When it holds | Status |
   |---|---|---|
   | N1 | network `fail` with a non-`internal` code | unchanged |
   | N2 | azdo `fail` with exactly `network-unreachable`, `network-blocked` or `timeout` | new |
   | N3 | bifrost `fail` with exactly `network`, `timeout`, `407` or `470` | new |

   **Never a hint for these codes:**
   - **azdo:** `http-*` (401/403/404/...), `auth-unavailable`, `invalid-settings`, `network`, `bad-response`, `too-large`, `invalid-jsonc`, `invalid-shape`, `internal`.
   - **bifrost:** `401`, `403`, `404`, `500` and every other status, `bad-response`, `too-large`, `invalid-key`, `no-base-url`, `invalid-base-url`, `insecure-base-url`, `internal`.
   - **Any `skipped` code.**

   **Edge cases:**
   - `network: fail internal` on its own: no hint (unchanged).
   - `fail internal` together with N2 or N3: one hint. Only a hand-built report can produce this.
   - No-key hint: independent. `runSmoke` can never produce it together with the network hint. A hand-built report prints both, no-key first.
   - The N2/N3 check reads `status` and `code` through `attempt` and compares primitive strings exactly.

   **Why azdo `network` gets no hint but bifrost `network` does.** For the plugin, `network` is a catch-all (ADR-0020 section 4). In the smoke Bifrost check, `network` means the authenticated call was rejected.

   **Exports.** None change; the private `hasNetworkCondition` becomes `needsNetworkHint(report)`. `runSmoke`, `smokeFailed`, the helper and both front ends are unchanged. Exit codes are unchanged because every qualifying line is already a `fail`.
2. **HTTP 470 (ADR-0019 A1.1, ADR-0020 A1, plugin-interface 0.9.1 row 7a, installer-cli 9.0).**
   - **Installer probe:** `classifyProbeStatus(470)` returns `blocked`. The credential is withheld, the network line reads `fail azdo-blocked` / `bifrost-blocked`, the check reads `skipped network-blocked`, and the installer exits with 4.
   - **Plugin:** `codeForStatus` gets `if (status === 407 || status === 470) return "network-blocked";`. The Content-Type is not read, `getReader` is never called, and the existing `handleResponse` cancels the body. `hintFor` is unchanged, so L-HINT-NETWORK follows.
   - **Authenticated responses after a reachable probe:**
     - Bifrost 470 still reads `fail 470`, and now gets the hint (N3).
     - An AzDO 470 now reads `fail network-blocked`, and gets the hint (N2).
   - **Caveat (written into both ADRs and the contracts):** 470 is community-reported, from unofficial sources only (a GitHub gist and the http.dev reference). Microsoft does not document it.
   - **Why the false-positive risk is negligible:**
     - 470 is not an IANA-registered status.
     - Neither `dev.azure.com` nor Bifrost answers 470.
     - The worst case is the same as the documented 403 false positive: the key is withheld, `--no-smoke` is the escape hatch, and the cache fallback is unchanged.
     - If the community report is wrong, nothing changes.
   - **Honest limitation (plugin):** the plugin makes one request, so its PAT or token has already passed through the TLS-inspecting firewall when the 470 comes back. A1 improves only the diagnosis there. The installer's probe is what keeps the credential from being sent.
3. **FR-11 (plugin):** still one file, zero runtime dependencies, no new import, no new constant, no new `__internals` key, exactly one fetch per hook run.

### Backend tasks (senior-backend)
| # | Task | Files | ACs |
|---|---|---|---|
| B1 | `classifyProbeStatus`: add `status === 470` to the blocked set. Update the docstring ("403/407/470 are firewall-style blocks"). | `backend/installer/smoke.ts` | AC-4 |
| B2 | Replace the private `hasNetworkCondition(network)` with a private `needsNetworkHint(report)` = N1 \|\| N2 \|\| N3 (installer-cli 9.4). Add two module-local `readonly string[]` constants, `AZDO_HINT_CODES = ["network-unreachable","network-blocked","timeout"]` and `BIFROST_HINT_CODES = ["network","timeout","407","470"]`. Add a private `failedWith(outcome: unknown, codes)` that reads `status` and `code` with `attempt(() => ...)`, requires `status === "fail"` and `typeof code === "string"`, then calls `codes.includes(code)`. Push the hint once, after the no-key hint. Hint text is byte-identical. Header comment: add ADR-0019 A1 and installer-cli 9.4. No export or type change. | `backend/installer/smoke.ts` | AC-1, AC-2, AC-3, AC-7 |
| B3 | `codeForStatus`: `if (status === 407 \|\| status === 470) return "network-blocked";` (before the 403 branch). Update the comment above it. No other change in the plugin. | `backend/plugin/azdo-remote-config.ts` | AC-5, AC-7 |
| B4 | Re-expect the existing tests that pinned the old behaviour. Every change is **strengthen, not weaken**; full list below. | tests | AC-7 |
| B5 | New tests per AC; list below. | tests | AC-1..AC-6 |
| B6 | `bash scripts/ci.sh` exits 0, including the FR-11 lint, the `__internals` key-set test (unchanged) and check-docs. | - | AC-7 |

**B4: existing tests that pin the old behaviour (strengthen, not weaken):**
1. `backend/test/installer/smoke.test.ts:841` "F-021 AC-7a: ... prints no network hint". Re-title it "... prints exactly one network hint (T-035)". The expected array gains the 4th line `HINT_SH`. Add a count assertion that the hint occurs exactly once, and keep `smokeFailed` and `assertNoLeak`.
2. `smoke.test.ts:230`, the `classifyProbeStatus` table. Add `[470, "blocked"]` and the boundaries `[469, "reachable"]` and `[471, "reachable"]`, and update the title. All existing rows stay.
3. `smoke.test.ts:419`, the Bifrost probe blocked loop `for (const status of [403, 407])`. Extend it to `[403, 407, 470]`, with the same assertions: no `/models` call, key not in any header, 4 lines with the hint.
4. `smoke.test.ts:655-699` (authenticated azdo/bifrost `timeout`) and `:701-726` (throwing authenticated fetch giving azdo `network-unreachable` and bifrost `network`). Keep the report assertions, and **add** `formatSmoke(r)` equality for each report: 4 lines, the hint last.
5. `backend/test/installer/install-smoke.test.ts:198` (azdo `fail timeout`) and `:233` (bifrost `fail timeout`). The anchored regex must now include `\nSmoke test: a network check failed; ... then re-run install\.sh\.\nDone\.\n$`. Exit 4 and the request counts are unchanged.
6. `install-smoke.test.ts:546` "F-021 AC-7b: ... without the network hint". Re-title it, and make the exact stdout tail `smoke network: pass\nsmoke azdo: fail network-unreachable\nsmoke bifrost: skipped azdo-failed\n<HINT install.sh>\nDone.\n`.
7. Unchanged, verified:
   - `smoke.test.ts:187` (http-404 has no hint) and `:563` (internal gives no hint).
   - The `install-ps1-smoke.test.ts` cases `fail 401` and `fail http-404`.
   - `e2e/startup.test.ts` (`fail 401`).
   - `fetch.test.ts:428` / `:1027` (status loops without 470).
   - `hook.test.ts` (no `http-470` pinned anywhere).

**B5: new tests:**
- **AC-1** (`smoke.test.ts`, pure `formatSmoke`): a table over azdo `fail` `network-unreachable` / `network-blocked` / `timeout`, with network pass and bifrost `skipped azdo-failed`.
  - Exact 4-line array, for both `install.sh` and `install.ps1`.
  - Negative table (`http-401`, `http-403`, `http-404`, `auth-unavailable`, `invalid-settings`, `network`, `bad-response`, plus `too-large`, `invalid-jsonc`, `invalid-shape`, `internal`): exactly 3 lines.
- **AC-2** (`formatSmoke`), network pass and azdo pass:
  - bifrost `fail` `network` / `timeout` / `407` / `470`: 4 lines, the hint last.
  - bifrost `fail` `401` / `403` / `404` / `500` / `bad-response` / `invalid-key` / `too-large` / `no-base-url`: 3 lines.
  - Every `skipped` code (`azdo-failed`, `key-reference`, and `network-blocked` with a hand-built network pass): 3 lines.
  - `skipped no-key`: exactly the no-key hint, no network hint.
  - **runSmoke end to end:** probe 404, then an authenticated Bifrost 407 or 470 with canary body and header: `fail 407` / `fail 470` plus one hint.
- **AC-3** (`formatSmoke`, hand-built reports). Assert the hint count is exactly 1 in each case:
  - network `fail azdo-blocked` + azdo `fail timeout`
  - network `fail bifrost-timeout` + bifrost `fail 470`
  - azdo N2 + bifrost N3
  - network `fail internal` + azdo `fail internal` (count 0)
  - network `fail internal` + azdo `fail network-blocked` (count 1)
  - network `fail bifrost-blocked` + bifrost `skipped no-key`: both hints, no-key first
  - a hostile azdo or bifrost whose `code` getter throws: N1 is decided normally, no throw from the hint decision.
- **AC-4, `smoke.test.ts`:**
  - Fake fetch answers the `https://dev.azure.com/` probe with `new Response("Action: Deny. Reason: No rule matched. CANARY", { status: 470, headers: { "content-type": "text/plain", "x-canary": ... } })`.
  - Expected report: `{ network: fail [azdo-blocked], azdo: skipped network-blocked, bifrost: skipped azdo-failed }`, with `fake.calls.length === 1`, `runAz` call count 0, `smokeFailed === true` and 4 lines with the hint.
  - Same for the Bifrost origin probe answering 470: `bifrost-blocked`, no `/models` call, key in no header.
- **AC-4, `install-smoke.test.ts` (child process):** scenario `azdoProbe: { status: 470, body: "Action: Deny" }`.
  - Exit 4, stdout `smoke network: fail azdo-blocked` / `smoke azdo: skipped network-blocked` / `smoke bifrost: skipped azdo-failed` / hint / `Done.`.
  - `requests(sb).length === 1`, the probe carries no credential, and `assertNoSecretsOrStack`.
- **AC-5, `fetch.test.ts`:** "T-035: a 470 is network-blocked whatever the content type, headers not read".
  - `spiedResponse(470, () => type)` for `text/plain`, `text/html`, `application/json`, `null` and a throwing `get`.
  - Expect `{ ok:false, error:"network-blocked" }`, `spied.names` `[]`, and `spied.state` `{ getReader: 0, cancel: 1 }`.
  - Plus a real `new Response("Action: Deny", { status: 470 })` giving `network-blocked`.
- **AC-5, `hook.test.ts`:**
  - Add `{ reason: "network-blocked", hint: HINT_NETWORK, fetch: respond(470, "Action: Deny. Reason: No rule matched.", "text/plain") }` to `HINT_CASES`. That covers both the no-cache and the bound-cache variants (exact log arrays and levels).
  - Add `respond(470)` to the AC5 bound-cache survival loop (asserts `calls === 1` and the cache bytes and mtime are unchanged).
  - Add a 470 variant to the AC5 `cache-mismatch` test.
- **AC-6:**
  - **Smoke:** a canary test with 470 / 407 and authenticated `network` / `timeout` answers whose bodies and headers carry canaries, plus PAT, az token and key canaries. Check `assertNoLeak(report)` and that the joined `formatSmoke` lines contain no canary, host, URL or org/project/repo value. `runSmoke` resolves (never rejects).
  - **Hook:** add `respond(470, CANARY, \`text/plain; ${HEADER_CANARY}\`)` and a hostile-headers 470 object to the `fetches` list of the existing AC6 test.
- **AC-7:** no new test file. The existing FR-11 lint and `__internals` key-set tests must stay green unchanged.

### Frontend tasks
None. `scope.frontend` is false, and the product has no frontend.

### Docs-writer tasks (after BE)
- **`docs/troubleshooting.md`:**
  - Plugin codes table, `network-blocked` row: "HTTP 407, HTTP 470 (Azure Firewall deny) or HTTP 403 non-JSON".
  - Line 63 "Limits": remove 470 from "not classified", keep 203.
  - Line 67: `smoke azdo: fail network-unreachable|network-blocked|timeout` and `smoke bifrost: fail network|timeout|407|470` now print the VPN / allow-list hint.
  - Network-blocked table, `*-blocked` row: "HTTP 403, 407 or 470".
  - Curl self-check bullets: 470 means Azure Firewall deny. Remove nothing else.
- **`docs/user-guide.md`:**
  - Smoke test section (around line 529): the hint rule of installer-cli 9.4, including which codes never add it; Bifrost 401/403 stay hint-free.
  - Troubleshooting-by-code table rows for `timeout`, `network`, `407`, `470`, `network-blocked`, `network-unreachable`.
  - Line 209 plugin hint rules: `network-blocked` includes 470.
- **`docs/platform-runbook.md`:**
  - "Telling block types apart": a 470 row, "Azure Firewall application-rule deny (no rule matched, HTTP or TLS-inspected HTTPS): add an application rule for `dev.azure.com` / the Bifrost FQDN or exempt it from TLS inspection".
  - Line 109 known limits: remove 470.
  - State that 470 is community-reported, not Microsoft-documented.
- **`docs/api.md`:** lines 277/281, contract plugin-interface 0.9.1; 470 is now classified (`network-blocked`).
- **`docs/development.md`:** a T-035 paragraph (ADR-0019 A1, ADR-0020 A1, installer-cli 1.3.2 section 9.4, plugin-interface 0.9.1) listing the re-expected and new tests.

### Security notes (for the Security engineer)
- **Credential exposure is reduced.** A probe answer of 470 now withholds the PAT, az token and virtual key in the installer.
- **Plugin limitation.** The plugin's single request has already gone through the firewall, so there is no change in exposure there; it is a diagnostic improvement only. This is documented in ADR-0020 A1.
- **No new data reaches output.** The decisions use the integer status and fixed code strings only.
  - For 470 the plugin reads no header (`headers.get` is not called), and the body is cancelled unread.
  - The smoke hint decision reads only `status` / `code`, guarded, with exact string comparison and no coercion.
  - The hint texts are existing constants.
- **What to verify:**
  - No canary from the body, headers, PAT, token, key, host or URL appears in any line.
  - The `__internals` key set is unchanged.
  - The plugin makes no new import and no extra fetch.
  - FR-10: `fetchRemoteConfig` and the hook never throw.
  - `runSmoke` never rejects.
- **Not a weakening:** no existing test is relaxed. Re-expectations add a line or a stricter count.

## Files changed
- `docs/architecture/contracts/installer-cli.md`: 1.3.1 -> 1.3.2. Changed sections:
  - section 7: hint note
  - section 9.0: 470 blocked, with the unofficial-source caveat
  - section 9.1: hint codes
  - section 9.2: row 8 hint note
  - section 9.3: exit codes unchanged
  - new section 9.4: the normative hint rule table and edge cases
- `docs/architecture/contracts/plugin-interface.md`: 0.9.0 -> 0.9.1. Changed parts:
  - row 7a: 470 is `network-blocked`, headers not read
  - code summary
  - wiring note
  - a 2f-L example sequence for 470
- `docs/architecture/ADR-0019-installer-network-preflight.md`: status line, classification table, section 5 note, and Amendment A1 (A1.1 470, A1.2 hint rule, accepted imprecision, test re-expectations).
- `docs/architecture/ADR-0020-plugin-fetch-network-classification.md`: status line, section 5 marked superseded, the 470 row in the false-positive table, and Amendment A1 (code, caveat, consequences).
- `docs/architecture/overview.md`: the plugin fetch codes and the smoke flow (470, hint rule).
- `factory/runs/cycle-0024/02-architect.md`: this report.

## Verification
- `node backend/tools/check-docs.mjs` -> `Check-docs: PASS (36 markdown files checked)`, exit 0.
- The edited architecture docs are pure ASCII (checked with grep).
- I verified by grep that no test pins `http-470` / `470`, and found every test that pins a hint-free authenticated network failure (B4 list).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | `backend/installer/smoke.ts:331` | A probe answer of 470 counts as reachable, so the credential is then sent. | B1 |
| 2 | info | `backend/installer/smoke.ts:508` | The hint is tied to the network line only. | B2 |
| 3 | info | `backend/plugin/azdo-remote-config.ts:922` | 470 reads `http-470` with no hint. | B3 |

## Assumptions made (no human available)
- **Amendments instead of new ADRs** (ADR-0019 A1, ADR-0020 A1). The change is small and lives entirely inside the decisions those ADRs record.
- **Contract bumps are patch-level:** installer-cli 1.3.2 and plugin-interface 0.9.1. The PO text said "minor", but there is no new code, line format, input or export; only classifications and when the hint is printed change. This matches the patch release bump.
- **Bifrost `fail network` gets the hint** even though it also covers a rare body-stream failure after a 2xx or a non-function injected fetch. Splitting the code would change the stable bifrost code vocabulary.
- **The network hint is the last line, after the no-key hint** (unchanged order). For a hand-built report with N1/N2/N3 present it is printed once.
- **AzDO 470 reads `fail network-blocked`, Bifrost 470 reads `fail 470`.** I kept the existing pass-through vocabularies rather than adding a new code.

## Follow-ups for the backlog
- T-034 (203 HTML sign-in) remains, and needs evidence.
- Optional: a PowerShell child-process 470 smoke test in `install-ps1-smoke.test.ts`, if pwsh is available on CI. It is not required, because `formatSmoke` is shared and is unit-tested for both front-end names.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0024/02-architect.md
summary: T-035 design: installer-cli 1.3.2 (new 9.4 hint rule N1|N2|N3, probe 470 blocked) and plugin-interface 0.9.1 (470 -> network-blocked, headers unread) via ADR-0019/0020 amendment A1; 3 backend code edits, 6 strengthened test re-expectations, new tests per AC, no frontend.
