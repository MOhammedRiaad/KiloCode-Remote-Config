# Security report — cycle 0007 — F-005: Plugin: Azure DevOps fetch and authentication

## Inputs read
- `git diff main...HEAD` (13 files; product code: `backend/plugin/azdo-remote-config.ts`; tests: `backend/test/plugin/fetch.test.ts`, `settings.test.ts`, `azdo-remote-config.smoke.test.ts`)
- factory/runs/cycle-0007/02-architect.md (security notes), 03-backend.md
- Existing helpers `readOwn`, `isRecordLike`, `selectEnv`, `isDigitString`, `inTimeoutRange` in the plugin file

## Work done
Audited the new `fetchRemoteConfig` section, the `isWellFormedText` amendment to `acceptName`/`acceptBranch`/`acceptPath`, the default az runner, and the tests (to make sure none reach the real network or a real az).

1. **Secrets.** Nothing secret-shaped in the diff: no keys, tokens or private keys, and no `.env` files. The test sentinels (`PATSENTINEL1234`, `tok.SENTINEL-5678`) are fake. The PAT and bearer token only ever go into the `headers` object passed to fetch. Every result is either `{ok,text}` or `{ok,error}`, and `error` is a constant or `http-<integer 100..599>`. No new `catch` binds its error. Nothing is logged (no `console.`). Tests check for leaks with `assertNoLeak` (PAT, token, base64 Basic value, "boom") on every failure path.
2. **URL / SSRF / injection.** The host is the constant `https://dev.azure.com/`. org/project/repo/path/branch must be strings, well-formed UTF-16, and accepted unchanged by the ADR-0006 deny-list validators (`accept(v) === v`). Each value then goes through `encodeURIComponent` before string concatenation. No path or query break-out is possible, and the host cannot change. `redirect: "manual"`, so credentials are never forwarded and a 3xx becomes `http-3xx`.
3. **Header injection.** The Basic value is base64 of `":" + pat`. The PAT must also be visible ASCII 0x21..0x7E after trimming. The Bearer token must be token68 and at most 16384 characters (checked with charCode loops). CR/LF cannot reach a header.
4. **child_process.** Only `execFile` is used. No `shell` option, no `exec`, no `spawn`. POSIX runs `execFile("az", AZ_TOKEN_ARGS)`. On Windows the code runs ComSpec (only if absolute, else `cmd.exe`) with `/d /s /c` and `AZ_COMMAND_LINE`, which is built only from frozen module constants. No caller data reaches the process. Node quotes it as one argument and `/s` strips the outer quotes. `/d` disables AutoRun. `cwd: homedir()` defeats an `az.cmd` planted in the project directory. Other limits: `timeout`, `maxBuffer: 65536`, `windowsHide`. Synchronous throws inside the Promise executor (for example from `homedir()`) become rejections, which give `auth-unavailable`.
5. **Timeout / abort.** One AbortController and one timer cover the az call, the fetch and every `reader.read()`. Each operation is wrapped in `settle()`, which turns synchronous throws and late rejections into handled outcomes, so there are no unhandled rejections. The timer is cleared in `finally` on every path. On a deadline the reader is cancelled through the guarded `discard`.
6. **Response size.** A declared Content-Length above 1 MiB is rejected before the body is read. A streaming running total stops the read once it passes 1 MiB, before decoding and parsing. Decompressed bytes are counted, so a gzip bomb is capped. Runs of empty chunks are bounded (1024). Non-2xx bodies are cancelled.
7. **Never-throw.** There is an outer `try/catch` that returns `network`. All property probes on untrusted objects go through `attempt`/`readOwn`. There are no new `throw` statements; the `throw` statements found by grep are all in pre-existing parser and merge code.
8. **Prototype pollution.** Nothing is merged or assigned from untrusted data. `JSON.parse` output is read only via `readOwn(parsed, "content")`, so getters are never invoked and inherited values are ignored. Inputs are not mutated, and a test covers frozen inputs.
9. **FR-11.** The only new import is `node:child_process`. `backend/package.json` has no `dependencies`, and package files are unchanged in the diff. check-fr11 passes.
10. **Test hygiene.** Every `fetchRemoteConfig` call in the tests either supplies a PAT (so az is never run) or injects `runAz`. Each call injects `fetch`, or replaces `globalThis.fetch` and restores it in `finally`. No test touches the real network or the real az.

## Files changed
- `factory/runs/cycle-0007/04-security.md` — this report (no source changes).

## Verification
- `bash scripts/ci.sh` -> exit 0 (check-fr11 PASS, tsc, `node --test`: 229 tests, 228 pass, 0 fail, 1 skipped; check-lf PASS).
- `npm audit --omit=dev --audit-level=high` (backend) -> found 0 vulnerabilities.
- Grepped the diff for secret patterns: only test-assertion text matched, nothing secret. No `.env` files.
- Grepped the plugin file for `shell`, `exec(`, `spawn`, `console.`, bound `catch (`, `throw`: no new risky constructs. Only `execFile` is used, and the `exec(` hit is the existing `RegExp.exec`. Non-ASCII/CR check on the plugin file: none.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/plugin/azdo-remote-config.ts:1000-1018 | On a timeout, `execFile` kills only `cmd.exe` on Windows; the Python `az` grandchild can stay alive as an orphan. When the shared deadline fires, the runner is not cancelled either; it is only bounded by its own `timeout`, which is equal to the deadline. No secret is exposed; the only impact is resources. ADR-0007 already accepts this risk. | Backlog: on Windows, consider `taskkill /T` on timeout, or pass an AbortSignal (`signal` option) tied to the shared controller. |
| 2 | info | backend/plugin/azdo-remote-config.ts:728-731, 559-562 | If the whole `deps` value is a throwing or revoked Proxy, every `readOwn` returns undefined, so the code falls back to the real `globalThis.fetch`, `process.env` and `defaultRunAz`. The "wrong dependency is unavailable" rule only applies to a readable `fetch`/`runAz` that is not a function. `deps` is an internal test seam, not attacker input, so this is not exploitable. | None required; optionally document it in ADR-0007. |
| 3 | info | backend/plugin/azdo-remote-config.ts:981-1018 | The default runner (including the Windows `cmd.exe /d /s /c` quoting) and the real global fetch path have no automated tests. Reading the code confirms they are correct: constant command line, no shell, cwd = home. | Backlog: add a Windows CI smoke test with a stub `az.cmd` on PATH. |
| 4 | info | (F-006 design) | Trust boundary for wiring. org/project/repo/path come from plugin options or env. If a project-local config could set them, an untrusted repository could point the user's PAT or Entra token at an Azure DevOps repo it controls and serve a config (for example MCP commands) that the user then runs. The host is fixed, so the credential stays at dev.azure.com, but the content is attacker-chosen. | F-006 Architect: state which config layers may supply org/project/repo/path and treat the fetched content as untrusted (validate before merge). |

No critical, high or medium findings.

## Assumptions made (no human available)
- A malicious `ComSpec`/`PATH`/home directory belongs to the user's own environment and is out of the threat model (consistent with ADR-0007).
- `deps` is an internal seam (F-006 will call `fetchRemoteConfig(settings)` without deps); finding 2 is therefore info only.

## Follow-ups for the backlog
- Windows az process-tree kill / signal-based cancellation of the default runner (finding 1).
- Windows CI smoke check of `defaultRunAz` with a stub `az.cmd` (finding 3).
- F-006: define the trust boundary for the settings sources and validate the fetched remote config before applying it (finding 4).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0007/04-security.md
summary: F-005 fetchRemoteConfig passes: no secret leakage (constant error codes), constant host plus validated and percent-encoded URL, base64 and token68 headers, execFile without a shell and with a constant command line, single deadline with abort, 1 MiB streamed cap, never throws, 0 deps and 0 audit findings; 1 low and 3 info follow-ups.
