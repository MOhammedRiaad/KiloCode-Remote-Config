# Security report — cycle 0024 — T-035: Firewall hint on the authenticated smoke lines and Azure Firewall HTTP 470 classified as blocked

## Inputs read
- `git diff main...HEAD` (branch `factory/T-035-firewall-hint-on-the-authenticated-smoke`, working tree clean)
- `factory/runs/cycle-0024/02-architect.md`, `03-backend.md`
- `docs/architecture/ADR-0019-installer-network-preflight.md` (A1), `ADR-0020-plugin-fetch-network-classification.md`, `contracts/installer-cli.md` (1.3.2, sections 7, 9.4), `contracts/plugin-interface.md` (0.9.1)
- `factory/runs/cycle-0023/04-security.md`, `cycle-0022/04-security.md` (spy-preload method)

## Work done
- **Plugin (`backend/plugin/azdo-remote-config.ts:921-926`)**: the only source change is `status === 407 || status === 470` -> `network-blocked` in `codeForStatus`, plus a comment. `handleResponse` (l.992-1002) calls `codeForStatus` and then `discardBody` before any `declaredTooLarge`/`readCappedBody`, so on 470 the body is cancelled unread, `getReader` is never called, and `readContentType` is evaluated only by the `status === 403` branch (short-circuit), never on 470. No new import, constant or `__internals` key. There is still one authenticated request and no retry. `fetch.test.ts` "T-035 AC-5" covers this with spies (5 content types including a throwing `get`: `names == []`, `{getReader:0, cancel:1}`; 469 stays `http-469`).
- **Installer classification (`backend/installer/smoke.ts:330-333`)**: `classifyProbeStatus` is an exact strict compare (403/407/470). Independent probe: 403/407/470 give `blocked`; 469/471/4700 give `reachable`; `undefined` gives `unreachable`.
- **Credential withholding (independent `runSmoke` harness with a counting fake fetch and a counting `runAz`)**:
  - AzDO probe 470: 1 fetch total, 0 authenticated requests, 0 `az` calls. Output: `azdo-blocked`, `azdo: skipped network-blocked`, `bifrost: skipped azdo-failed`.
  - Bifrost probe 470: 3 fetches, 1 authenticated request (the AzDO PAT to dev.azure.com only), and the virtual key is never sent. Output: `bifrost-blocked`.
  - 469/471 on either probe: the full path runs (4 fetches, 2 authenticated, all pass), so neighbouring statuses still reach the server.
  - No formatted output contained the PAT, key, `https:`, dev.azure.com or the Bifrost host.
- **Hint rule (`smoke.ts:509-522`)**: N1 is unchanged from the old `hasNetworkCondition`. N2 and N3 use `failedWith`, which reads `status` and `code` once each through `attempt`, requires `typeof code === "string"` and checks membership with `Array.prototype.includes` (SameValueZero, exact). No substring, prefix, regex or coercion is involved. Hostile values tried on both lines:
  - `'timeout '`, `' timeout'`, `'Timeout'`, `'TIMEOUT'`, `'4700'`, `'47'`, `'470 '`, `'4070'`, `'network-blocked '`, `'Network'`, `'networks'`, a NUL suffix and a zero-width space
  - `['timeout']`, `['470']`, `new String(...)`, objects with `toString`/`valueOf`, `Symbol('timeout')`, numbers 470/407, `null`, `undefined`, `''`
  - status variants: `'fail '`, `'Fail'`, `'skipped'`, `['fail']`, `new String('fail')`

  Result: **0 false hints**. Positives (all 7 codes, combined with N1, both front ends): the hint appears exactly once and is the last line. Near-negatives (`http-470` on AzDO, Bifrost 403/471, skipped `network-blocked`) give no hint. The hint literal is unchanged and byte-identical to installer-cli section 7 (l.314). Only `${frontEnd}` is interpolated, and it comes from a typed constant.
- **Engineer's noted gap (formatLine unguarded)**: confirmed. A hand-built report whose `code` getter throws makes `formatSmoke` throw. A `Symbol` code also throws, from the template literal in `formatLine`, not from the new hint code. This behaviour existed before this cycle. Can a real `runSmoke` path produce such a report? No. Every outcome in `runSmoke`/`checkAzdo`/`checkBifrost` is a fresh object literal whose code is a string literal or `String(status)`, and the outer `catch` returns `internalReport()` (literals). `install-helper.ts:412-425` wraps both `runSmoke` and `formatSmoke` in `try { ... } catch { failed = true }`. `formatSmoke` builds its array before anything is printed, so a throw prints no partial smoke lines and no error text. The helper then prints `Done.` and the fixed stderr line and sets exit 4. FR-10 (the plugin never throws) is unaffected because `formatSmoke` is installer-only.
- **470 false-positive consequences**: if a real AzDO or Bifrost answered 470 on the anonymous probe, the credential would be withheld, the run would exit 4 with the advisory hint, and `--no-smoke` / `-NoSmoke` remains the way out. This fails closed and leaks nothing. In the plugin, the request has already been sent and only the log code or hint changes. Documented in ADR-0019 A1 (l.234-237) and ADR-0020. Accepted.
- **Hermeticity**: spy preload (`NODE_OPTIONS=--import` hooking `net.Socket.prototype.connect`, `tls.connect`, `dns.lookup/resolve*`, `globalThis.fetch` and all `child_process` variants with `syncBuiltinESMExports`) on `plugin/fetch.test.ts`, `plugin/hook.test.ts`, `e2e/startup.test.ts`, `installer/smoke.test.ts` and `installer/install-smoke.test.ts`: **276/276 pass. 0 socket connects, 0 TLS, 0 DNS, 0 global fetch, 0 `az`/`cmd.exe` spawns.** Spawns seen:
  - 49 bash `install.sh`
  - 16 node with the fake-network preload
  - 4 node `install-helper.ts`
  - 1 e2e fixture
  - 1 pre-existing `node --input-type=module -e`

  This is the same pattern as cycles 0022 and 0023.
- **Secrets grep of the diff**: the only hits are test sentinels (`PAT_SENTINEL_9911`, `tok.AZ_SENTINEL_2233`, `sk-bf-AbCdEf...`) and prose. No `.env` or key material.

## Files changed
- `factory/runs/cycle-0024/04-security.md` — this report (no source changes).

## Verification
- `bash scripts/ci.sh` returned exit 0: check-fr11 PASS, 702 tests (692 pass, 0 fail, 10 skipped as platform-conditional), check-lf PASS, check-docs PASS (36 files), `ci: PASS`.
- `npm audit --omit=dev --audit-level=high` found 0 vulnerabilities. Full `npm audit` also found 0.
- Independent hostile-input and credential-withholding harness (scratchpad `hostile.ts`): BAD = 0.
- Spy-preload run as described above.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| I1 | info | `backend/installer/smoke.ts:493-495` (`formatLine`) | `formatLine` reads `outcome.status`/`outcome.code` unguarded, so a hand-built report with a throwing getter or a Symbol code throws inside `formatSmoke`. This existed before this cycle, and no real `runSmoke` path can produce such a report (literal outcomes plus an outer catch). `install-helper.ts:412-425` catches the throw before any line is printed, so the run still exits 4 with no leak. | None for this cycle. Optional hardening is listed under follow-ups. |
| I2 | info | `backend/installer/smoke.ts:519-521` | `needsNetworkHint` re-reads `network.status`/`network.codes` after `isNetworkOutcome`, so a getter that flips value could differ between reads. This is the same pattern as the old `hasNetworkCondition` and networkLine. Not reachable from `runSmoke` (plain literals). | None. |
| I3 | info | `backend/test/installer/helpers.ts` | Child-process tests set their own `NODE_OPTIONS`, so the external spy cannot reach them. Their no-network guarantee rests on the deny-by-default `fake-network.ts` preload (as I3 in cycles 0022 and 0023). | None. |

No critical, high, medium or low findings.

## Assumptions made (no human available)
- The 10 skipped tests are the existing platform-conditional (pwsh / powershell5 / OS) skips and not new skips. The diff adds no `skip`/`todo`.
- The community-reported Azure Firewall 470 behaviour is taken as described in the backlog and ADRs. Classifying it as a block fails closed (credential withheld), so even if the evidence is wrong there is no security downside.

## Follow-ups for the backlog
- (low priority, hardening) Make `formatLine` / `networkLine` read each field once through `attempt` and render non-string codes as `internal`, so `formatSmoke` cannot throw on any input. Today the install-helper catch already covers this.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0024/04-security.md
summary: T-035 is safe: the plugin maps 407|470 to network-blocked before any header read (body cancelled unread, 1 request, no new import or key); a 470 installer probe withholds the PAT, az token and virtual key (verified by fetch/runAz counters, 469/471 still reach the server); the hint uses an exact typed compare (0 false hints across hostile inputs), appears once and last, text byte-identical; ci.sh PASS, npm audit 0, spy preload 0 sockets/DNS/fetch/az; 3 info notes.
