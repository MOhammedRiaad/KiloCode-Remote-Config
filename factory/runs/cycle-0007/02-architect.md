# Architect report — cycle 0007 — F-005: Plugin: Azure DevOps fetch and authentication

## Inputs read
- factory/runs/cycle-0007/01-product-owner.md (item, 8 ACs, assumptions)
- factory/VISION.md (FR-2, FR-3, FR-8, FR-10, FR-11, FR-12)
- docs/architecture/ADR-0001..0006, overview.md, contracts/plugin-interface.md v0.5.0
- factory/runs/cycle-0006/02-architect.md, 04-security.md (low #1: lone surrogates), 05-review.md
- backend/plugin/azdo-remote-config.ts (existing `readOwn`, `isRecordLike`, `selectEnv`, `acceptName` / `acceptPath` / `acceptBranch`, `inTimeoutRange`, `DEFAULT_TIMEOUT_MS`, `__internals`)
- backend/tools/check-fr11.mjs (comment stripper regex removes slash-star..star-slash spans and whole `//` lines; import check accepts only `node:` specifiers; rejects `require(`)
- backend/tsconfig.json (target ES2022: `String.prototype.isWellFormed` is not typed), backend/package.json, smoke test key-list assertions

## Work done
Design for F-005. ADR-0007 and contract section 2e are normative; this is a summary.

### Signature and result
```ts
async function fetchRemoteConfig(settings: unknown, deps?: unknown): Promise<FetchResult>
type FetchResult = { ok: true; text: string } | { ok: false; error: FetchErrorCode }
type FetchErrorCode = "invalid-settings" | "auth-unavailable" | "timeout" | "too-large"
                    | "bad-response" | "network" | `http-${number}`
```
- 5th `__internals` key: `{ parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings, fetchRemoteConfig }`. No other export changes.
- Never throws or rejects. Outer `try` with a binding-less `catch` returns `network`. There is no `throw` statement. Results are fresh objects with exactly `ok`+`text` or `ok`+`error`. Error codes are constants (`http-` + integer status 100..599, non-2xx).
- deps: `fetch`, `env`, `runAz(args, { timeoutMs }) => Promise<{ exitCode: number | null; stdout: string }>`, `setTimeout`, `clearTimeout`. `undefined` means the default is used. A wrong injected `fetch`/`runAz` (not a function) makes that dependency **unavailable** (`network` / `auth-unavailable`). It never falls back to the real network or the real az. `env` uses the existing `selectEnv`.

### Processing order
1. **Settings check.** Runs first. Nothing else is touched until it passes. org/project/repo/path/branch must be strings, well-formed UTF-16 (`isWellFormedText`), and `acceptX(v) === v` (the ADR-0006 validators are reused). Otherwise the result is `invalid-settings`. If `timeoutMs` is not in range, 5000 is used.
2. **URL.** Built by concatenation with `encodeURIComponent` on every value, in the exact order `path`, `versionDescriptor.version`, `versionDescriptor.versionType=branch`, `includeContent=true`, `api-version=7.1`. It is passed to fetch as a string. The AC1 expected URL is written out in the contract.
3. **fetch availability**, then **one deadline**: one `AbortController` and one timer of `timeoutMs`, covering az, fetch and the whole body read. Every await is `Promise.race`d with the deadline. The timer is cleared in `finally`.
4. **Credentials.** `settings.pat`, then `AZDO_PAT`, then `AZURE_DEVOPS_EXT_PAT` (own data props). A value is usable if `trim()` leaves a non-empty string containing only visible ASCII 0x21..0x7E. Unusable values are skipped. The header is `Basic ` + `Buffer.from(":"+pat,"utf8").toString("base64")`; the base64 output makes header injection impossible. With a PAT, runAz is never called.
5. **az.** `runAz(["account","get-access-token","--resource","499b84ac-...","--query","accessToken","--output","tsv"], { timeoutMs })` is called once. The token is accepted only if `exitCode === 0` and the trimmed stdout is non-empty, at most 16384 characters, and uses only the token68 charset (checked with `charCodeAt`). Otherwise the result is `auth-unavailable` and no HTTP request is sent. If the deadline fires during az, the result is `auth-unavailable`.
6. **Request.** One `fetch(url, { method:"GET", headers:{ Accept:"application/json", Authorization, "X-TFS-FedAuthRedirect":"Suppress" }, redirect:"manual", signal })`. A rejection gives `network`, or `timeout` if the deadline has fired.
7. **Status.** 2xx continues. Another integer from 100 to 599 gives `http-<status>`; 3xx is included because redirects are never followed. Any other value gives `bad-response`.
8. **Size.** If the Content-Length header is all digits and above 1048576, the result is `too-large` and the body is not read. The body is read through `getReader()` with a running byte total; going over 1 MiB cancels the reader and gives `too-large`. All of this happens before decoding.
9. **Body.** A fatal UTF-8 `TextDecoder`, then `JSON.parse`. The result must be record-like with an own string `content`; otherwise `bad-response`. On success, `content` is returned exactly as is.

### Key decisions
- **Lone surrogates.** An explicit guard (`isWellFormedText`, a `charCodeAt` loop). I did not use catching `URIError` or `String.prototype.isWellFormed`, because the ES2022 lib has no typing for it. The guard is applied in fetchRemoteConfig. It is also **added to `acceptName`, `acceptBranch` and `acceptPath` in resolveSettings** (contract 2d amended, ADR-0006 status note), so such values now get W2 and fall through. `checkPat`, mode and timeoutMs are unchanged. Task BE-1 does this.
- **Windows az.** `az` is `az.cmd`, and Node refuses to spawn `.cmd` files without a shell (CVE-2024-27980, EINVAL). So the default runner calls `execFile(ComSpec-if-absolute or "cmd.exe", ["/d","/s","/c","az " + AZ_TOKEN_ARGS.join(" ")])`, still without `shell: true`. The command line is built only from module constants, so there is no injection surface. `cwd: homedir()` is set on every platform to defeat binary planting: Windows searches the current directory before PATH, and Kilo's cwd is an arbitrary project. Other options: `timeout: timeoutMs`, `maxBuffer: 65536`, `windowsHide: true`, `encoding: "utf8"`.
- **Redirect.** `"manual"`. The Authorization header is never forwarded, and a 3xx response shows up as a diagnosable `http-3xx`.
- **Single deadline** for az, fetch and body together (default 5000 ms, FR-8). This is the conservative choice for startup latency.
- **Timer seam** (`setTimeout`/`clearTimeout`). It lets the default of 5000 ms be asserted without waiting 5 s.
- **FR-11 lint.** The only new import is `execFile` from `node:child_process`. `Buffer`, `TextDecoder`, `AbortController` and `fetch` are globals. The file must not contain the slash-star or star-slash sequence anywhere, so there is no star-slash-star Accept header and character sets use charCode checks. New comments use `//` only. ASCII only, LF line endings.

## Files changed
- `docs/architecture/ADR-0007-azdo-fetch-and-auth.md`: new ADR (all decisions above).
- `docs/architecture/contracts/plugin-interface.md`: v0.6.0. New section 2e. `__internals` key order. New import. Section 2d well-formed amendment. Section 4 pat row. Section 5 normative for the Items API and az.
- `docs/architecture/ADR-0006-settings-resolution.md`: status line notes the ADR-0007 amendment of section 4.
- `docs/architecture/overview.md`: cycle-0007 header, C2 status, data flow, internal structure, test layout.
- `factory/runs/cycle-0007/02-architect.md`: this report.

## Backend tasks

All work is in `backend/`. No real network and no real `az` in any test. Every test injects `fetch` and `runAz` fakes. Where a PAT is used, inject a `runAz` spy that fails the test if it is called.

**Constraints (all tasks):**
- No slash-star or star-slash sequence anywhere in `backend/plugin/azdo-remote-config.ts` (comments, strings, regex literals). New comments use `//`. Prefer `charCodeAt` loops over regex literals.
- ASCII only, LF only, erasable TypeScript only, no `require(`, no dynamic import.
- The only new import is `import { execFile } from "node:child_process";`. `backend/package.json` stays without `dependencies`.
- No `throw` statement in the new code. `catch` clauses have no binding, or ignore it. Never copy an error message, value, URL, header, PAT, token or stdout into a result.
- Types and constants stay module-local (not exported).

### BE-1: well-formedness guard and resolveSettings amendment (AC-7; contract 2d)
- Add a module-local `isWellFormedText(text: string): boolean` (a `charCodeAt` loop: 0xD800-0xDBFF must be followed immediately by 0xDC00-0xDFFF; a stray 0xDC00-0xDFFF is invalid).
- In `acceptName`, `acceptBranch` and `acceptPath`, return `undefined` (giving W2) when `!isWellFormedText(trimmed)`. Do not change `checkPat`, `checkMode` or `checkTimeout`.
- Tests in `backend/test/plugin/settings.test.ts` (extend):
  - org option `"\ud800"` gives W2 for `plugin option org`, and a valid env `KILO_AZDO_ORG` applies.
  - `"a\udc00b"` for project, `"x\ud800"` for repo, branch `"b\ud800"` and path `"/a\udfff"` each give W2 and the fallback applies.
  - A valid surrogate pair (`"😀"`, written as escapes in the test) is accepted for project.
  - Nothing throws.

### BE-2: implement `fetchRemoteConfig` in `backend/plugin/azdo-remote-config.ts` (AC-1..AC-8)
- New section `// ---- Azure DevOps fetch and auth (ADR-0007) ----` after resolveSettings and before `__internals`.
- Module-local types `FetchErrorCode`, `FetchResult`, `FetchInit`, `FetchLike`, `AzRunResult`, `AzRunner`, `FetchDeps`.
- Module-local constants:
  - `MAX_RESPONSE_BYTES = 1048576`
  - `AZ_RESOURCE`
  - `AZ_TOKEN_ARGS` (frozen array, exact order as in contract 2e)
  - `MAX_TOKEN_CHARS = 16384`
  - `AZDO_HOST_PREFIX = "https://dev.azure.com/"`
- Implement exactly as in contract 2e steps 1 to 9 and ADR-0007 sections 2 to 11:
  - **Settings check first.** On failure, nothing else is touched: no env read, no timer.
  - **URL** by string concatenation with `encodeURIComponent`.
  - **Deps resolution** via `readOwn`. A wrong fetch or runAz is unavailable.
  - **Deadline.** One deadline helper. A `race(op)` wrapper turns sync throws into rejections (`new Promise((r) => r(fn()))`). `finally` clears the timer.
  - **PAT chain.** Use `readOwn` on `settings` and on `selectEnv(deps)`, with the visible-ASCII rule. Build the Basic header with the global `Buffer`.
  - **az path** with token validation by charCode.
  - **The single fetch.** Use the `init` keys and header order exactly as specified.
  - **Response handling:** status, then Content-Length, then a streamed capped read (cancel guarded, never awaited unguarded), then fatal TextDecoder, then `JSON.parse`, then the own-string `content` check.
- Default runner `defaultRunAz`, as in contract 2e "Default runAz":
  - Uses `execFile`. Never pass `shell`. Set `cwd: homedir()`.
  - On win32, use ComSpec (own property of `process.env`, `isAbsolute`) or `"cmd.exe"` with `["/d","/s","/c","az " + args.join(" ")]`.
  - Map the callback result to `{ exitCode, stdout }`.
  - Wrap the call in `new Promise`.
- Set `__internals = { parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings, fetchRemoteConfig }`.
- Update the header comment (mention ADR-0007 and the fetch helper; the hook is still a no-op).
- Do not wire it into `server`/`config` (that is F-006).

### BE-3: tests `backend/test/plugin/fetch.test.ts` (new)
Use `node:test` + `node:assert/strict`. The fake fetch records `(url, init)` and returns `new Response(...)` or a hand-built stream. The fake runAz records its args. A sentinel PAT is `"PATSENTINEL1234"`; a sentinel token is `"tok.SENTINEL-5678"`. Required cases:
1. **AC-1 URL.** With the AC settings and `pat: "p"` (build settings with `resolveSettings`, or by hand with a non-enumerable pat):
   - Exactly one call.
   - `url` strictly equals `https://dev.azure.com/my%20org/plat%20form/_apis/git/repositories/kilo-config/items?path=%2Fteams%2Fa%20b%2Fkilo.jsonc&versionDescriptor.version=release%2F1&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`.
   - `init.method === "GET"`, `init.redirect === "manual"`, `init.signal` is an AbortSignal.
   - `Object.keys(init.headers)` deep-equals `["Accept","Authorization","X-TFS-FedAuthRedirect"]`, and `Accept === "application/json"`.
   - A 200 body `JSON.stringify({ content: jsoncText })`, where jsoncText has comments, a trailing comma, a non-ASCII character and CRLF, returns `{ ok: true, text }` with text strictly equal to jsoncText. The result has exactly the keys `ok` and `text`.
2. **AC-2 PAT order.**
   - `settings.pat` beats AZDO_PAT, which beats AZURE_DEVOPS_EXT_PAT. Assert `Authorization === "Basic " + Buffer.from(":" + expected).toString("base64")`.
   - Whitespace-only and empty values are skipped.
   - A value with an embedded CR/LF, a space or a non-ASCII character is skipped and the next source applies.
   - An inherited env value (`Object.create({ AZDO_PAT: "x" })`) and an accessor property are ignored (getter count 0).
   - A trimmed PAT is used.
   - In every PAT case the runAz spy has 0 calls.
3. **AC-3 az.**
   - No PAT anywhere (env `{}`): runAz is called once, `args` deep-equals the AZ_TOKEN_ARGS literal, and its first 4 elements are `account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`.
   - stdout `"  tok.SENTINEL-5678\r\n"` with exitCode 0 gives `Authorization === "Bearer tok.SENTINEL-5678"`.
   - Each of these gives `auth-unavailable` and 0 fetch calls: runner throws synchronously; runner rejects; exitCode 1; exitCode null; stdout `""` or `"  "`; stdout with an inner space or CR/LF; stdout over 16384 characters; runner never settles with timeoutMs 50; runner returns a non-object.
   - `deps.runAz: null` gives `auth-unavailable` and never runs a real az. This guards the "wrong fake" rule.
4. **AC-4 timeout.**
   - The fake fetch never settles and captures `init.signal`. With timeoutMs 50 the result is `{ ok:false, error:"timeout" }` within 2000 ms, and `signal.aborted === true`.
   - A body stream that never delivers a chunk also gives `timeout`.
   - With a fake `setTimeout`/`clearTimeout` and settings from `resolveSettings({org,project,repo,pat}, {env:{}})`, the timer delay is 5000.
   - `clearTimeout` is called on a successful path.
5. **AC-5 errors.**
   - Statuses 401, 404, 500 and 302 give `http-401` / `http-404` / `http-500` / `http-302`.
   - A fetch that rejects with `new Error("boom PATSENTINEL1234")`, and one that throws synchronously, give `network`.
   - For every failure in this file, `JSON.stringify(result)` contains neither the sentinel PAT, the sentinel token, the base64 Authorization value, nor `"boom"`.
6. **AC-6 size and shape.**
   - Content-Length `"1048577"` gives `too-large`, and the body reader is never pulled (use a stream with a pull counter).
   - Content-Length lies (`"10"`) or is absent and the real body is 1048577 bytes, gives `too-large`.
   - An endless stream gives `too-large` and stops; assert the pull count is bounded.
   - A body of exactly 1048576 bytes of valid JSON is accepted.
   - Each of these gives `bad-response`: a non-JSON body; `null`; `[]`; `{}`; `{content: 5}`; invalid UTF-8 bytes; status 0 / non-integer status (hand-built response object); a missing body.
7. **AC-7 invalid settings.** Each gives `invalid-settings`, 0 fetch calls and 0 runAz calls, and the error has no input value:
   - missing org, project or repo;
   - org `"\ud800"`;
   - project `"a\udc00"`;
   - path `"/x\ud800"`;
   - branch `"b\udbff"`;
   - org `"a/b"`;
   - path without a leading `/`;
   - settings `null`, `42`, `"x"`, `[]`.
8. **AC-8 hostile inputs.**
   - deps `null`, `42`, and a `Proxy` whose traps all throw, including a revoked proxy.
   - env as a throwing proxy, combined with `settings.pat`. The pat is still used, or the case cleanly gives `auth-unavailable`. Pick the deterministic expectation for each case.
   - fetch returns a non-object, or a Response whose `headers.get` throws.
   - Every case resolves (wrap each in a `Promise.race` against a 3 s guard and assert a resolved result).
   - `settings` and `env` deep-equal their clones afterwards, and frozen inputs do not throw.

### BE-4: smoke test update and quality gate (AC-8)
- `backend/test/plugin/azdo-remote-config.smoke.test.ts`: assert `typeof __internals.fetchRemoteConfig === "function"`. The key list becomes `["parseJsonc","resolvePlaceholders","mergeConfig","resolveSettings","fetchRemoteConfig"]`. Module exports stay `["PLUGIN_ID","SUPPORTED_KILO_RANGE","__internals","default"]`.
- `bash scripts/ci.sh` exits 0 (check-fr11, `tsc --noEmit`, `node --test`). `backend/package.json` is unchanged.
- grep the plugin file:
  - no slash-star or star-slash outside the pre-existing JSDoc lines;
  - no non-ASCII and no CR bytes;
  - no `shell:` key;
  - no `throw` in the new section.

## Frontend tasks

None. `scope.frontend` is false and `frontend/` is intentionally absent.

## Security notes (for the Security engineer)
- **Secrets.** The PAT and the token exist only inside the `headers` object passed to fetch. Results are constant codes. Check that no `catch` binds and reuses an error, and that no template literal interpolates input into `error`.
- **Header injection.** The Basic value is base64, so it is safe by construction. PAT candidates are additionally limited to 0x21..0x7E. The Bearer token is limited to the token68 charset and 16384 characters.
- **URL injection / SSRF.** The host is the constant `https://dev.azure.com/`. Every interpolated value is validated (ADR-0006 deny-list, `accept(v) === v`, well-formed) and percent-encoded. `redirect: "manual"`, so credentials are never forwarded to another host.
- **Process execution.**
  - `execFile`, never a shell option.
  - On Windows, cmd.exe gets a command line made only of constants, and `/d` disables AutoRun.
  - `cwd: homedir()` prevents an untrusted project directory from planting `az.cmd`/`az.exe`/`cmd.exe`.
  - The run is bounded by the timeout, a 64 KiB maxBuffer and the shared deadline.
  - Residual risks:
    - a malicious `ComSpec` or `PATH` in the user's own environment (out of scope: the attacker already controls the user's environment);
    - on Windows, an orphaned az grandchild after a timeout kill.
- **DoS.** One deadline covers az, fetch and the body. The 1 MiB cap is enforced while streaming, before decode and parse. There is no retry.
- **Fail-safe deps.** A wrong injected fetch or runAz never falls back to the real network or the real az.
- **Not tested.** The default runner and the global fetch cannot be exercised without real az or a real network. Review them by reading.

## Verification
- Documentation-only changes; no product code was changed.
- The contract update was applied by a script that asserted each anchor matched exactly once. Contract section headers are now in the order 2a..2e, 3, 4, 5, and the Version line is 0.6.0. CRLF line endings were preserved in the edited existing docs.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/tools/check-fr11.mjs:17 | The comment stripper is regex based. A slash-star inside a string or regex in the plugin file would hide code from the import check. | Engineers must follow the constraint above. Hardening the lint is backlog T-009 territory. |
| 2 | info | ADR-0007 section 7 | The default `execFile` runner (including the Windows cmd.exe path) has no automated test, because that would need a real az. | Manual review by Security. A possible later item is a Windows smoke check in CI with a stub `az.cmd` on PATH. |

## Assumptions made (no human available)
- The JSON form of the Items API (`Accept: application/json`, `content` field) is kept as the AC says. Raw download was rejected.
- An unusable PAT (characters outside 0x21..0x7E) is skipped silently and the next source is tried. This matches the ADR-0006 fall-through semantics, and there is no new error code.
- One deadline covers az, fetch and the body, rather than separate budgets. A deadline that fires during az maps to `auth-unavailable`, as AC-3 requires; one that fires during HTTP maps to `timeout`.
- The catch-all fallback code is `network`.
- 3xx responses map to `http-3xx`. Status 0 or a non-integer status maps to `bad-response`.
- `X-TFS-FedAuthRedirect: Suppress` is added so that Azure DevOps answers 401 instead of serving a sign-in page.
- The `az` arguments include `--query accessToken --output tsv` after the required prefix (the PO allowed this).
- A hand-built settings value that would need trimming or normalisation (for example a path without a leading `/`) is `invalid-settings`.

## Follow-ups for the backlog
- F-006: call `fetchRemoteConfig(settings)` only when `missing` is empty. Log only the error code, at warn level. On failure, fall back to the cache.
- Optional: a CI smoke check of the default az runner on Windows with a stub `az.cmd`.
- T-009 (lint hardening): make check-fr11 tokenize strings and regexes instead of using a regex comment stripper.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0007/02-architect.md
summary: Designed F-005 fetchRemoteConfig (ADR-0007, contract v0.6.0): validated+encodeURIComponent URL, PAT chain to az via execFile without a shell (cmd.exe constant line on Windows, cwd=home), single abortable deadline, manual redirects, 1 MiB streamed cap, fixed value-free error codes, never throws; lone-surrogate guard also added to resolveSettings; 4 backend tasks, no frontend.
