# Security report - cycle 0022 - F-020: Installer smoke test: network pre-flight for Azure IP firewall / VPN before any credential is sent

## Inputs read
- `git diff main...HEAD` (branch `factory/F-020-installer-smoke-test-network-pre-flight`, 16 files; working tree clean)
- `factory/runs/cycle-0022/02-architect.md` (security notes), `03-backend.md`
- `docs/architecture/ADR-0019-installer-network-preflight.md` (sections 3-5), `contracts/installer-cli.md` 1.3.0 section 9.0
- `backend/installer/smoke.ts` (full), `backend/plugin/azdo-remote-config.ts` (`resolveSettings`, `runFetch`, `defaultRunAz`)
- `backend/test/installer/smoke.test.ts`, `install-smoke.test.ts`, `install-ps1-smoke.test.ts`, `fixtures/fake-network.ts`, `helpers.ts`, `backend/test/e2e/startup.test.ts`

## Work done
- **Probe hygiene** (`smoke.ts:338-363`): init is `{ method: "GET", headers: {}, redirect: "manual", signal }`, built as a literal with no spread of caller data. No Authorization / api-key / x-api-key / Cookie header and no body. Own AbortController plus own `timeoutMs` deadline via `startDeadline`, and the timer is cleared in `finally`. The body is cancelled unread on every value path, including a late value after the deadline (`startDeadline.settle` discards it). Only `readStatus` is inspected. Headers and body are never read, so hostile or prompt-injection content in a response cannot reach any output.
- **Targets**: AzDO is the constant `https://dev.azure.com/` (the same fixed host prefix the plugin uses, `azdo-remote-config.ts:699`). The Bifrost target is `probeOrigin(urlCheck.url)`, and it is computed only after `modelsUrl` has validated https, no userinfo, no query and no fragment. `URL.origin` drops the path, so the request goes to `<scheme>://<host>[:port]/` only. I checked this empirically: path traversal (`/a/%2e%2e/b`), IDN, a non-default port and an IPv6 literal all reduce to a bare origin. http, file, userinfo and query inputs are rejected before any probe.
- **Credential withholding**: on any non-`reachable` verdict (blocked, unreachable, timeout, internal), `runSmoke` returns before `checkAzdo`, so neither `fetchRemoteConfig` nor `runAz` is reached and no PAT, Basic credential or az token is created. `checkBifrost` returns `skipped network-blocked` before the keyed request is built. The failure mode is safe: when in doubt, withhold. Tests confirm this with spies: AzDO probe reject/hang gives exactly 1 call, `azCalls === 0` and an aborted signal; Bifrost probe 403/407/reject/hang gives 3 calls, none to `/models` and none whose headers contain KEY. The child-process F-020 tests (install.sh and pwsh) assert 3 requests with no KEY and a byte-identical install.
- **Hostile deps**: `fetch: 42` gives probe `internal`, with no call to the guard `globalThis.fetch` (`guardCalls.length === 0`) and the result `network fail internal`, `azdo skipped network-blocked`, exit 4. A `null` or non-function fetch takes the same `typeof !== "function"` branch.
- **Output**: `networkLine` prints only `NetworkCode` strings, which come from a fixed union built in `networkCode()`. A malformed `report.network` gives `fail internal`. The hint text is a constant that interpolates only the `FrontEnd` literal. No host, URL, status text, body or error text is printed. Tests cover forbidden-substring checks for `dev.azure.com`, `bifrost.yourcompany.internal`, `https://`, KEY, PAT, body canary and error canary.
- **Time bound**: `runFetch` runs az and the items fetch under a single deadline, so the worst case is probe + items + probe + models = 4 x `timeoutMs`. ADR-0019 section 4 and contract 9.3 state this correctly.
- **SSRF analysis**: `modelsUrl` accepts any https host, including IP literals, loopback, link-local and RFC1918 (`https://169.254.169.254/`, `https://0x7f.1/` normalised to `127.0.0.1`, `https://[::1]/`, `https://10.0.0.1`). The cloud metadata endpoints (Azure IMDS, AWS) are http-only and http is rejected, so they cannot be reached. Before F-020, the same host already received an authenticated GET carrying the virtual key. The probe adds only an anonymous GET to `/` whose response is reduced to a fixed verdict, so nothing can be read back. F-020 strictly reduces exposure, because the key is now withheld when the origin is not reachable. The control for an attacker-chosen baseURL remains the PR-gated shared config plus the validator `--allowed-hosts`. Blocking private ranges is not warranted: legitimate corporate Bifrost endpoints sit on private DNS / RFC1918 behind the VPN (the exact F-020 scenario), and an IP-literal blocklist would not stop DNS names that resolve internally. DNS rebinding does not matter here: the probe authorizes nothing security-relevant, and the key goes to the configured hostname exactly as before F-020.
- **FP/FN** (ADR-0019 section 3): this matches the code. A false positive (an origin `/` that answers 403 anonymously) withholds the key, exits 4 and keeps the install, with `--no-smoke` as the escape hatch and no new switch. A false negative (a non-403 WAF status, APIM ip-filter, a per-path policy) behaves as before F-020. An opaque-redirect (status 0) would also be classified unreachable, so the error is in the safe direction.
- **Surface**: the new exports are `NetworkCode`, `NetworkOutcome`, `AZDO_PROBE_URL`, `classifyProbeStatus` and `probeOrigin`, which is the design list (`probeOrigin` is explicitly optional). There are no new imports and no new env/flag switches. `install-helper.ts`, `install.sh`, `install.ps1`, `backend/plugin/` and `backend/tools/` are unchanged (`git diff --quiet` on those paths: clean).

## Files changed
- `factory/runs/cycle-0022/04-security.md` - this report (no source changes).

## Verification
- `bash scripts/ci.sh` gives exit 0: lint incl. check-fr11 rules 6/7, 639 tests (629 pass, 0 fail, 10 skipped, all pre-existing POSIX-only skips), check-lf PASS, check-docs PASS (35 files).
- `npm audit --omit=dev --audit-level=high` (backend) reports `found 0 vulnerabilities`.
- Spy-preload run (cycle-0013 lesson). `node --test` on `smoke.test.ts`, `install-smoke.test.ts`, `install-ps1-smoke.test.ts` and `e2e/startup.test.ts` with `NODE_OPTIONS=--import=<scratch spy>`, which hooks every `child_process` spawn/exec variant, `net.Socket.prototype.connect` and `dns.lookup`. Result: 57/57 pass. **0 socket connects, 0 DNS lookups, 0 `az`/`cmd.exe` spawns** in the test-runner processes. The only spawns are node/bash/pwsh/powershell children for the front-end tests. Those children set their own `NODE_OPTIONS` (`helpers.ts:197`) to the fake-network preload, which replaces `fetch` and denies any unrouted request (`fake-network: request denied`). Their request logs are asserted per test.
- Secret grep on the diff: matches are only test canaries and fixture constants. No `.env` files and no private keys.
- Empirical `modelsUrl`/`probeOrigin` check against hostile baseURLs (see SSRF above).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| I1 | info | `backend/installer/smoke.ts:137-165, 335-337` | The Bifrost probe can target any https origin, including IP literals, loopback, link-local and private ranges, because `modelsUrl` does not restrict hosts. This is not exploitable here: it is an anonymous GET, the response is reduced to a fixed code, http-only metadata services are unreachable, the same host already received the keyed GET before F-020, and the trust boundary is the PR-gated shared config plus validator `--allowed-hosts`. Blocking private ranges would break the legitimate VPN/private-DNS Bifrost. | None. |
| I2 | info | `backend/installer/smoke.ts:472-484` | The AzDO probe runs before `checkAzdo` even when org/project/repo are missing. That sends one anonymous GET to the constant `https://dev.azure.com/`, and when the network is blocked it reports `skipped network-blocked` instead of `fail invalid-settings`. Diagnostics only: no credential and no data are involved. | None (optional UX polish). |
| I3 | info | `backend/test/installer/helpers.ts:197` | Child-process smoke tests overwrite `NODE_OPTIONS`, so an external spy preload cannot reach them. Their no-real-network guarantee rests on the deny-by-default fake-network preload. | None. |

No critical, high, medium or low findings.

## Assumptions made (no human available)
- Node's undici returns the real 3xx response for `redirect: "manual"`. Even if a runtime returned an opaque redirect (status 0), the probe classifies it as `unreachable` and withholds the credential, which is the safe direction.
- The shared config is trusted at the level established by earlier cycles (PR-gated plus host allow-list validator). F-020 does not widen that trust.

## Follow-ups for the backlog
- Optional (low value): skip the AzDO probe when `resolveSettings` reports missing org/project/repo, so `invalid-settings` is reported without network I/O (I2).
- F-022 docs should say that the probe targets the origin `/`, not the baseURL path. Path-routed gateways (App Gateway / APIM path rules) can therefore produce the false positives and negatives already listed in ADR-0019.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0022/04-security.md
summary: F-020 pre-flight is safe - anonymous header-less manual-redirect GET to an https origin, bounded (4 x timeoutMs), body unread, fixed-code output; credentials (PAT/az token/key) are never created or sent on any non-reachable verdict (spies + 0 real sockets/DNS/az in spy-preload run); ci.sh PASS, npm audit 0; 3 info notes only.
