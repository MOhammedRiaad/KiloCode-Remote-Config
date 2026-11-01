# Security report - cycle 0023 - F-021: Plugin: classify Azure firewall / network-blocked failures in the remote fetch with an actionable log hint

## Inputs read
- `git diff main...HEAD` (17 files; product code: `backend/plugin/azdo-remote-config.ts` only), `git status` (clean)
- `factory/runs/cycle-0023/02-architect.md`, `03-backend.md`, ADR-0020, `docs/architecture/contracts/plugin-interface.md` 0.9.0 (2e rows 6/7/7a, 2f-L)
- `factory/runs/cycle-0022/04-security.md` (spy-preload method)

## Work done
- Line-by-line review of the plugin diff: `FetchErrorCode` (+2 codes), `codeForInterrupted(..., failed)`, `readContentType`, `isJsonMediaType`, `codeForStatus`, `handleResponse`, `performRequest`, `LOG_HINT_*`, `hintFor`, `logHint`, two call sites in `executeHook`.
- Destination/request: unchanged. `performRequest` still makes exactly one call `fetchFn(buildItemsUrl(target), init)` with the fixed `https://dev.azure.com/` prefix, `redirect: "manual"`, one Authorization header. No new destination, no probe, no retry. Imports unchanged (diff touches no `import` line); `__internals` unchanged; no new dependency.
- Content-Type read: only in `codeForStatus` and only when `status === 403` (407 short-circuits before; 401/2xx/other never read it). Single `attempt(...)`-guarded read; `typeof value === "string"` gate, so objects with `toString`/`valueOf`, `String` objects, Promises, Symbols, numbers are treated as absent without coercion. String ops only (`indexOf`, `slice`, `trim`, `toLowerCase`, `endsWith`); no regex, not stored, not returned, not logged.
- Body: classification happens before `discardBody`; `getReader` never called on non-2xx; cancel guarded and not awaited.
- Fuzz harness (scratchpad, imports the real module through `__internals.fetchRemoteConfig` with fake fetch, PAT from fake env):
  - 27 Content-Type values on 403, all classified per contract 2e row 7a: JSON -> `http-403` for `application/json`, `APPLICATION/JSON`, ` application/json ; charset=utf-8`, `application/problem+json`, `Application/Problem+JSON;x=1`, `a/x+json`, `application/vnd.api+json `, tab-padded; `network-blocked` for `application/json-evil`, `application/jsonp`, `text/html; x=application/json`, `application/+json`, `/+json`, `/x+json`, `+json`, `a/b/c+json`, `a//+json`, `a/+json`, `application/json5`, `text/json`, `""`, `;application/json`, `application/json,text/html`, `application/ json`, `application\json`, trailing NUL. Each: `getReader` 0 calls, `cancel` 1 call (rejecting cancel tolerated).
  - Header reads per status: 401/404/407/500/302/199 -> 0 Content-Type reads, 0 `getReader`; 403 -> exactly 1 Content-Type read; 200 -> only `content-length` (pre-existing).
  - Hostile header values (throwing get, null, undefined, number, Symbol, object with side-effecting `toString`/`valueOf`, `String` object, Promise, throwing Proxy) -> `network-blocked`, 0 side effects observed, no throw.
  - Proxy responses that throw on every property except `status` (403 and 407) -> `network-blocked`, no throw.
  - Rejection after the deadline fired -> `timeout`; rejection before the deadline -> `network-unreachable`.
  - `runConfigHook` with throwing, rejecting and hostile-`then` log sinks, canaries in org and Content-Type: no throw, exactly two records (L-NONE error + L-HINT-NETWORK warn), no canary/PAT/host in any log argument.
- Hint texts: byte-compared source constants with contract 2f-L rows: L-HINT-NETWORK and L-HINT-CREDENTIALS identical. Hints are constant strings selected by `hintFor` (fixed code comparisons); emitted only after L-CACHE / L-NONE.
- Advisory only: the cache fallback branch (`if (remote.ok) ... else readCache(binding, ...)`) is unchanged; classification only changes the reason code and adds one log line. Cache binding (T-013) and order unchanged. Timer cleanup (`finally clock.clear`) unchanged. Credentials are never sent elsewhere.
- Tests: removed lines are all replaced by exact re-expectations (`network` -> `network-unreachable`, 403 moved into an explicit JSON/non-JSON test, hint lines added to exact message arrays). Nothing loosened, deleted or skipped.
- `smoke.ts` / installer sources: no diff (only a smoke test re-expectation and a new AC-7b test).

## Files changed
- `factory/runs/cycle-0023/04-security.md` - this report.

## Verification
- `bash scripts/ci.sh` -> exit 0, `ci: PASS` (check-fr11, typecheck, tests, check-lf, check-docs 36 files).
- `cd backend && npm audit --omit=dev --audit-level=high` -> found 0 vulnerabilities; full `npm audit` -> 0.
- Spy-preload run: `NODE_OPTIONS=--import=<scratch spy.mjs>` (hooks all `child_process` variants with `syncBuiltinESMExports`, `net.Socket.prototype.connect`, `tls.connect`, `dns.lookup`, `globalThis.fetch`) on `plugin/fetch.test.ts`, `plugin/hook.test.ts`, `e2e/startup.test.ts`, `installer/smoke.test.ts`, `installer/install-smoke.test.ts`: 264/264 pass. **0 socket connects, 0 TLS connects, 0 DNS lookups, 0 global fetch calls, 0 `az`/`cmd.exe` spawns.** Only spawns: bash `install.sh`, node `install-helper.ts`, node simulator (with the deny-by-default `fake-network.ts` preload), and one pre-existing `node -e` child with incomplete settings.
- Fuzz harness: 0 mismatches.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| I1 | info | `backend/plugin/azdo-remote-config.ts:921` | Content-Type is attacker/intermediary-controlled: a proxy answering 403 with `application/json` gets `http-403` and the credentials hint; a real AzDO 403 without a JSON type gets `network-blocked`. Only the advisory code and hint text change (the credentials hint also mentions the VPN); no security decision depends on it. This is the intended behaviour (ADR-0020). | None. |
| I2 | info | `backend/plugin/azdo-remote-config.ts:911` | `trim()` also strips Unicode whitespace (e.g. NBSP), so `application/json ` counts as JSON. No security effect (advisory classification only). | None. |
| I3 | info | `backend/test/installer/helpers.ts` | Child-process tests set their own `NODE_OPTIONS`, so the external spy cannot reach those children. Their no-real-network guarantee rests on the deny-by-default fake-network preload (same as I3 in cycle 0022). | None. |

No critical, high, medium or low findings.

## Assumptions made (no human available)
- A different ordering of the two hint log lines relative to existing messages is a contract question, not a security one. It was checked against 2f-L and matches.

## Follow-ups for the backlog
- None required.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0023/04-security.md
summary: F-021 is safe: still one authenticated request to the fixed dev.azure.com URL, Content-Type read once and only on 403 (guarded, primitive string, no coercion), 407/403 body never read, advisory codes and two constant hints byte-identical to the contract, hostile inputs never throw; ci.sh PASS, npm audit 0, spy preload shows 0 sockets/DNS/fetch/az; 3 info notes only.
