# Security report — cycle 0008 — F-006: Plugin: cache, fallback, logging and never-crash wiring

## Inputs read
- `git diff main...HEAD` (12 files; code: `backend/plugin/azdo-remote-config.ts`, `backend/test/plugin/hook.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`), `git status` (clean)
- `factory/runs/cycle-0008/02-architect.md` (security notes), `03-backend.md`
- `backend/plugin/azdo-remote-config.ts` in full context (placeholder resolver, merge, settings resolver, fetch error codes, new hook section), `backend/package.json`

## Work done
Reviewed the new hook section (`runConfigHook`, `executeHook`, `validateShared`, `writeCache`, `readCache`, `makeLogger`, `cleanName`/`listNames`), the journaled merge and rollback, and the test hermeticity. Each Architect point checked:

| Check | Result |
|---|---|
| Settings never from hook `config`, fetched content or cache | OK. `resolveSettings(options, {env})` is the only source; `config`/shared/cache never reach it. Top-level `plugin` and `$schema` still dropped by `sanitizeNode`, so shared content cannot alter the plugin tuple. |
| Exclusive temp + rename | OK. `writeFileSync(tmp, {flag:"wx", mode:0o600})` (O_EXCL, does not follow a symlink at tmp), then `renameSync` (replaces a symlink at the final path, does not follow it). Temp removed on failure. |
| Cache file 0600 / dir 0700 | OK on create (POSIX). Existing dir not re-chmodded (by design). Windows ignores mode, file inherits profile ACL (info). |
| Cache contains no secrets | OK. Written as `sanitizeShared(unresolved)`: `apiKey` stripped, placeholders literal. Test asserts resolved value and `sk-bf-shared` absent. |
| Cache poisoning / validation | OK. `statSync` + regular-file + 2 MiB cap, then the same `validateShared` (JSONC parse, plain-object root, depth < 64) as fetched content, then `sanitizeShared` again in `applyShared`. Corrupt cache never merged. |
| Prototype pollution | OK. Parsed keys pass `sanitizeNode` (drops `__proto__`/`constructor`/`prototype`), all writes use `Object.defineProperty`, `resolveContainer` uses `defineProperty`, `isPlainObject` restricts targets to Object/null prototypes. |
| Only cleaned placeholder names in logs | OK. Regex already excludes CR/LF and braces; `cleanName` maps C0, DEL, C1 to `?`, cuts to 200, list capped at 20 with "and N more". |
| No secrets in any log call | OK. All messages are fixed text plus fixed codes (`FetchErrorCode`, cache codes, `missing` names, `mode` enum, fixed warning texts). No `extra`, no `err.message`; only `error.code` read and compared to `ENOENT`. PAT is non-enumerable on settings and never interpolated. Tests serialise every log arg with `JSON.stringify` and `util.inspect(showHidden)`. |
| Logger cannot block startup | OK. Call is never awaited; sync throw caught; thenable gets `noop` handlers inside `try`. Test with a never-settling logger passes. |
| Rollback restores exact prior state | OK. Descriptor captured before each `defineOwn`; reverse-order `Reflect.deleteProperty` / `Reflect.defineProperty`, each guarded. Frozen root and frozen nested `provider` cases tested. |
| Wrong injected fs/homedir never reaches real home | OK. `selectFs`: `undefined` gives real fs, anything non-record gives `cache-unavailable`; `cacheLocation` requires a function returning an absolute non-empty string, else no fs call. `homedir: 5` in placeholder resolution throws inside the guarded reader. Child smoke test redirects `HOME`/`USERPROFILE` and strips `KILO_AZDO_*`/PAT env; missing settings skip fetch and `az`. |
| Never-crash | OK. Outer `try/catch` without binding in `runConfigHook`; L-UNEXPECTED fixed text. |

## Files changed
- `factory/runs/cycle-0008/04-security.md`: this report.

## Verification
- `bash scripts/ci.sh` gave `ci: PASS`: 267 tests, 266 pass, 0 fail, 1 skipped (the POSIX-only 0600 mode assertion on win32). Lint, typecheck and `check-lf` passed.
- `npm audit --omit=dev --audit-level=high` (backend) gave `found 0 vulnerabilities`. `package.json` has no `dependencies`.
- Secrets grep on added diff lines (sk- keys, ghp_, AKIA, private keys, password=, bearer tokens): no matches; no `.env` files in the diff. Test sentinels (`PATSENTINEL-9999`, `sk-bf-local`, `s3cr3t-value`) are fake fixtures.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/plugin/azdo-remote-config.ts:1124-1129, 1217-1230 | The cache is a single fixed file that is not bound to the org/project/repo/path/branch that produced it. When the fetch fails, or settings are missing (`missing-settings`), the cache from a different repo or org can be applied. This is cross-context config confusion: for example, a `baseURL` from config A could be applied together with a local `apiKey` used for context B. FR-7 fixes the path, and both sources were trusted at some point, so this is low. | Backlog: store a source fingerprint (org/project/repo/path/branch) beside the cached config and only use the cache when the fingerprint matches; consider not using the cache fallback for `missing-settings`. |
| 2 | info | backend/plugin/azdo-remote-config.ts:1229-1237 (`cleanName`) | Placeholder names are cleaned of C0/DEL/C1 only. Unicode line/paragraph separators (U+2028/U+2029) and bidi overrides (U+202A-202E, U+2066-2069) pass through to logs, which could spoof log lines in some viewers. Names are capped (200 chars, 20 names), and CR/LF are already excluded by the regex. | Backlog: also map U+2028, U+2029 and bidi controls to `?`. |
| 3 | info | backend/plugin/azdo-remote-config.ts:1160-1166 | A crash between `writeFileSync` and `renameSync` leaves an orphan `*.tmp` (0600, sanitised content) in the cache dir; nothing sweeps old temp files. | Backlog: optionally remove stale `remote-config.json.*.tmp` files owned by the user on a successful write. |
| 4 | info | backend/plugin/azdo-remote-config.ts:1162 | An existing `~/.cache/kilo-azdo` keeps its mode and is not checked (owner/mode/symlink), and on Windows `mode` is ignored. The file itself is created 0600 and holds no secrets, so the exposure is minimal. | None required; document it. |
| 5 | info | backend/test/plugin/hook.test.ts:23-25 | `makeHome()` temp directories are never removed after the tests. Hygiene only. | Backlog: clean up in `t.after`. |

There are no critical, high or medium findings.

## Assumptions made (no human available)
- Shared content from the configured Azure DevOps repo is trusted (ADR-0009 C1 model), so `{file:~/...}` placeholders in shared or cached content and the shared `baseURL` are accepted risk, not findings.
- The Kilo-provided `config` object and `input.client` are trusted host objects; getters or proxies on them are out of scope.
- The ADR-0009 residual risk (project-level override of the plugin tuple options) is already tracked by the Architect as a follow-up and is not re-raised here.

## Follow-ups for the backlog
- Bind the cache to a settings fingerprint and reconsider the cache fallback on `missing-settings` (finding 1).
- Extend `cleanName` to U+2028/U+2029 and bidi controls (finding 2).
- Sweep stale temp files on a successful cache write (finding 3).
- Test hygiene: remove temp homes after tests (finding 5).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0008/04-security.md
summary: F-006 security PASS: settings trust boundary, atomic wx+rename 0600 cache with sanitised validated content, fixed fire-and-forget logs, exact rollback all verified; ci PASS, audit 0 vulns; 1 low + 4 info follow-ups
