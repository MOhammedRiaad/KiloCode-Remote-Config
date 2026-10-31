# Architect report — cycle 0008 — F-006: Plugin: cache, fallback, logging and never-crash wiring

## Inputs read
- `factory/runs/cycle-0008/01-product-owner.md` (item JSON, 8 ACs, PO assumptions), `factory/VISION.md` (FR-6..FR-11, AC-3/4/6..9)
- `docs/architecture/overview.md`, `ADR-0001`, `ADR-0002`, `ADR-0006`, `ADR-0007`, `contracts/plugin-interface.md` (0.6.0)
- `factory/runs/cycle-0007/*security*.md` (finding info 4: trust boundary)
- `backend/plugin/azdo-remote-config.ts` (merge section, fetch section, server stub, `__internals`), `backend/test/plugin/azdo-remote-config.smoke.test.ts`, `backend/package.json`

## Work done
- **ADR-0008** (hook wiring, cache, fallback, logging, never-crash). Main decisions:
  - New seam `__internals.runConfigHook(input, options, config, deps?)` (6th key). The default
    `server` does no I/O and returns `{ config: (c) => runConfigHook(input, options, c) }`.
  - Fixed flow order. Missing settings skip both fetch and az and go to the cache fallback.
  - `validateShared` is shared by the fetch and cache paths: JSONC parse, root must be a plain
    object, depth must stay below 64.
  - The cache holds the **sanitised, unresolved** shared config (`sanitizeShared`, so any shared
    `apiKey` is also kept off disk). It is written atomically: `mkdirSync` 0700, then an
    exclusive `wx` temp file with mode 0600 in the same directory, then `renameSync`. Size cap
    is 2 MiB.
  - The cache is read only on the fallback path, and it is validated like fetched content.
  - Logger: `client.app.log.call(app, { body: { service, level, message } })`, read with
    ordinary property access because the SDK uses prototype methods. Calls are fire and forget
    (never awaited), there is no `extra`, and only the 11 fixed messages (L-*) are used.
    Placeholder names are sanitised and capped.
  - Transactional merge (`applyShared`). Phase 2 records each write in a journal and rolls back
    on any throw, so `config` is either unchanged or fully merged, frozen configs included.
    `mergeConfig` itself is unchanged.
- **ADR-0009** (trust boundary, required by AC 8). Settings may come only from the plugin
  options in the global `~/.config/kilo/kilo.jsonc`, from the process env, and from the `az`
  login. Project-level configs are untrusted and unsupported. The hook's `config`, the fetched
  content and the cache are never settings sources. Fetched and cached content is untrusted:
  size cap, parse, plain-object root and depth checks, then merge sanitisation. Residual risk:
  we have not checked how Kilo deduplicates the plugin tuple across config layers. I raised this
  as a follow-up.
- **Contract 0.7.0** (`contracts/plugin-interface.md`):
  - New section 2f (`runConfigHook`, `HookDeps`, `CacheFs`, cache, merge and logger rules) and
    2f-L (exact log messages).
  - `__internals` key list, imports, the "Wiring" rows of 2b-2e, section 3 (hook behaviour;
    T-001 no-op superseded) and section 5 (cache, logs, trust boundary) updated.
- **overview.md**: data flow, C2 status, internal structure (new section 5, hook orchestration)
  and test layout updated.

## Files changed
- `docs/architecture/ADR-0008-config-hook-wiring-cache-logging.md`: new.
- `docs/architecture/ADR-0009-settings-and-content-trust-boundary.md`: new (the trust-boundary ADR required by the ACs).
- `docs/architecture/contracts/plugin-interface.md`: version 0.7.0, section 2f / 2f-L, sections 2-5 updated.
- `docs/architecture/overview.md`: F-006 wiring.
- `factory/runs/cycle-0008/02-architect.md`: this report.

## Backend tasks (senior-backend)

All code goes in `backend/plugin/azdo-remote-config.ts` (single file, FR-11). Follow ADR-0008
and contract section 2f exactly, plus ADR-0007 section 12 (lint rules: no slash-star or
star-slash anywhere, `//` comments, ASCII, LF, erasable TS). The only allowed new imports are
`mkdirSync`, `renameSync`, `unlinkSync` and `writeFileSync`, added to the existing `node:fs`
import. `backend/package.json` must not gain `dependencies`.

**BE-1 Journaled merge (AC 1, AC 8).** Add an optional `journal` parameter to `mergeInto`. Before
each `defineOwn`, push `{ target, key, previous: Object.getOwnPropertyDescriptor(target, key) }`.
`mergeConfig` must behave exactly as before, and the existing merge tests must stay green. Add
`applyShared(target, shared, mode): boolean`, which sanitises, merges with the journal, and on a
throw rolls back in reverse (`Reflect.deleteProperty` / `Reflect.defineProperty`, each step
guarded) and returns false.

**BE-2 `validateShared` (AC 4, AC 5).** The result is `invalid-jsonc` when the input is not a
string or `parseJsonc` throws, and `invalid-shape` when the root is not a plain object or a
container sits at level 64 or deeper. Catches use no binding.

**BE-3 Cache I/O (AC 2, AC 3, AC 4, AC 8).**
- Resolve the cache path from `homedir`. It must be an absolute non-empty string; otherwise the
  result is `cache-unavailable` and no fs call is made.
- `writeCache`: `JSON.stringify(sanitizeShared(shared), null, 2) + "\n"`; byte cap 2 MiB;
  `mkdirSync({recursive, mode 0o700})`; `writeFileSync(tmp, data, {encoding "utf8", mode 0o600,
  flag "wx"})` where `tmp = file + "." + pid + "-" + Date.now() + "-" + counter + ".tmp"`;
  `renameSync`; guarded `unlinkSync(tmp)` on failure. Result codes: `cache-unavailable`,
  `cache-too-large`, `cache-write-failed`.
- `readCache`: `statSync` (ENOENT gives `cache-missing`, any other throw gives
  `cache-unreadable`), then the isFile and size checks, then `readFileSync(file, "utf8")`, then
  `validateShared` (failure gives `cache-invalid`).
- Only the `code` property of an error is read. The `fs` seam is used as described in contract
  2f: present but wrong means unavailable, never the real fs.

**BE-4 Logger adapter (AC 2, 3, 4, 5, 6, 7, 8).**
- `makeLogger(input)`: read `client`, `app` and `log` with ordinary property access inside
  `try`. Call `log.call(app, { body: { service: PLUGIN_ID, level, message } })` without awaiting
  it. Catch sync throws; if the result is a thenable, attach a rejection handler inside `try`. If
  `log` is missing, the logger is silent.
- Message builders produce exactly the L-* texts in contract 2f-L. The placeholder name sanitiser
  replaces code units 0x00-0x1F, 0x7F and 0x80-0x9F with `?`, cuts each name to 200 units, lists
  at most 20 names, and appends `, and <n> more` when names were left out.

**BE-5 `runConfigHook` + server (all ACs).**
- Implement the flow in ADR-0008 section 2 in the given order. Read deps with `readOwn` and pass
  on only the keys that are not `undefined`.
- Add `runConfigHook` as the 6th `__internals` key.
- Replace the server stub with `async (input, options) => ({ config: (config) => runConfigHook(input, options, config) })`.
- Update the file header comment (the hook is no longer a no-op).

**BE-6 Tests.** Add a new file `backend/test/plugin/hook.test.ts`. Every test uses a temp dir
(`fs.mkdtempSync(join(tmpdir(), ...))`) as the injected `homedir`, a fake `fetch` (or `runAz`),
an injected `env`, and a fake `input.client.app.log` that records every argument. No test may
touch the real home directory or the network.

1. AC 1: the shared JSONC with comments from the AC, local config `{model:'local', provider:{bifrost:{options:{apiKey:'sk-bf-local'}}}}`.
   - In `defaults` mode: model `local`, small_model `s`, baseURL `https://b/v1`, apiKey
     `sk-bf-local`, and `config` keeps the same reference (including `config.provider`).
   - In `enforce` mode: model `shared`, apiKey `sk-bf-local`.
2. AC 2: success with a home that has no `.cache`.
   - The file exists and its JSON deep-equals the sanitised unresolved shared config. A
     `{env:X}` placeholder appears literally in the file, the resolved value does not, and
     `sk-bf-shared` is not in the file.
   - A recording `fs` wrapper (delegating to the real fs) shows `writeFileSync` called on a
     `.tmp` path in the same directory with `flag: "wx"` and `mode: 0o600`, then
     `renameSync(tmp, file)`, and no write to `file` directly.
   - On POSIX only (`process.platform !== "win32"`): `statSync(file).mode & 0o777 === 0o600`.
   - The logs include an info entry with service `azdo-remote-config` and message
     `Loaded shared config from Azure DevOps.`
3. AC 3: seed a valid cache, then make the fetch reject (`network`) and, in a separate case,
   return a 500 (`http-500`); also cover `timeout` (fake `setTimeout` that fires immediately, or
   a fetch that never settles with a short `timeoutMs`).
   - The cached config is resolved and merged.
   - The cache file bytes and mtime are unchanged.
   - There is a warn log `Remote config unavailable (<code>); using cached config.`
4. AC 4: fetch fails and the cache is absent; or the cache is corrupt text, not JSON, `[]`,
   `"str"`, `1` or `null`.
   - `config` deep-equals its original value.
   - There is an error log matching L-NONE with `cache-missing` or `cache-invalid`.
   - A corrupt cache is never merged.
5. AC 5:
   - With `missing` non-empty (for example no org): the fetch spy and the `runAz` spy have zero
     calls. The log `Remote config skipped: missing required settings: org.` appears, followed by
     the cache fallback. With an invalid option such as `mode: "ENFORCE"`, a warn log with the W3
     text appears.
   - With fetched text that is invalid JSONC, `[]`, `"s"`, `1` or `null`, or nested 64 or more
     levels deep: nothing is cached (no file created, or an existing cache stays unchanged), and
     the reason `invalid-jsonc` or `invalid-shape` appears in the L-CACHE or L-NONE message.
6. AC 6: shared `{"x":"{env:MISSING}","y":"{env:SECRET_VAR}"}` with env SECRET_VAR=`s3cr3t-value`.
   - `!("x" in config)` and `config.y === "s3cr3t-value"`.
   - A log contains `env:MISSING`. No serialised log argument contains `s3cr3t-value`.
   - Also check that placeholder names with control characters are logged with `?` and that the
     list is capped at 20.
7. AC 7: PAT in options; a PAT-less run with a fake `runAz` token; local `sk-bf-` apiKey; a
   resolved secret placeholder. Run the success, cache-fallback and exception paths (for
   example a logger that throws, or `fetch` that throws synchronously).
   - Serialise every argument of every log call with `JSON.stringify` and with
     `util.inspect(arg, { showHidden: true, depth: null })`. None contains the PAT, the token,
     `sk-bf-local`, `sk-bf-shared` or the secret value.
   - No log argument is, or contains, the settings object: check that every argument has exactly
     the shape `{ body: { service, level, message } }` with string values.
8. AC 8: each of these must resolve without throwing, with any logged messages exactly from the
   L-* set (no `err.message` text: make each fake throw `new Error("LEAK-" + marker)` and assert
   that `LEAK-` never appears), and with `config` either deep-equal to the original or fully
   merged:
   - fetch rejects
   - `parseJsonc` throws (invalid text)
   - unwritable cache dir: inject `fs.mkdirSync` throwing, or on POSIX a read-only dir
   - `writeFileSync` throws, and `renameSync` throws (temp file removed via `unlinkSync`)
   - the logger throws synchronously, returns a rejected promise, or never settles (the hook
     still resolves)
   - `Object.freeze(config)`: unchanged, L-MERGE
   - a frozen nested `config.provider` with new top-level keys also pending: unchanged after
     rollback
   - options `null`, `"x"`, `[]`
   - `config` not an object: L-BADCONFIG
   - deps `fs: "nope"` and `homedir: 5`: never touch the real home
9. `__internals` key order:
   `["parseJsonc","resolvePlaceholders","mergeConfig","resolveSettings","fetchRemoteConfig","runConfigHook"]`.

**BE-7 Update the smoke test** (`azdo-remote-config.smoke.test.ts`). The T-001 tests "config
hook leaves the config deep-equal" and "stub never logs" describe superseded behaviour (contract
section 3). Replace them, and do not just delete them:
- Keep the shape tests: the server resolves for `{}`, `undefined` and `null` options; no named
  export is a function; the `__internals` keys are as listed in BE-6.
- Add one child-process test. Run `process.execPath` with the `--input-type=module -e` script
  that imports the plugin by file URL, calls `plugin.server(fakeInput, {})` and then
  `hooks.config(cfg)`, and prints the results as JSON.
  - Child env: a copy of `process.env` with every `KILO_AZDO_*`, `AZDO_PAT` and
    `AZURE_DEVOPS_EXT_PAT` removed, and `HOME` and `USERPROFILE` set to a fresh temp dir.
  - Assert that `cfg` is unchanged, that the logs are L-MISSING (`org, project, repo`) followed
    by L-NONE with `missing-settings` / `cache-missing`, and that no `.cache` directory was
    created in the temp home.
  - This checks the default wiring without network access (the fetch is skipped).

**BE-8 Gate.** `bash scripts/ci.sh` must exit 0. This covers the FR-11 lint, the typecheck with
strict settings (`noUnusedLocals` and so on) and all tests.

## Frontend tasks
- None. F-006 is backend only, and `frontend/` is intentionally absent (overview).

## AC to task map
| AC | Tasks |
|---|---|
| 1 merge defaults/enforce | BE-1, BE-5, BE-6.1 |
| 2 cache create, atomic, 0600, info log | BE-3, BE-4, BE-6.2 |
| 3 fetch fail + cache, warn | BE-3, BE-4, BE-6.3 |
| 4 no / corrupt cache, error, unchanged | BE-2, BE-3, BE-6.4 |
| 5 missing settings, warnings, invalid content | BE-2, BE-5, BE-6.5 |
| 6 placeholder names, no values | BE-4, BE-6.6 |
| 7 no secrets in any logger argument | BE-4, BE-6.7 |
| 8 never-crash, CI, no deps, trust ADR | BE-1..BE-5, BE-6.8, BE-7, BE-8, ADR-0009 (done) |

## Security notes (for the security engineer)
- **Trust boundary:** see ADR-0009. Check the following:
  - Settings are read only from `options` and `env`, never from `config`, fetched content or
    the cache.
  - The merge still drops top-level `plugin`, so shared content cannot change the plugin tuple.
- **Cache:**
  - The file must never contain resolved placeholder values or a shared `apiKey` (it holds the
    sanitised unresolved config).
  - Writes use exclusive `wx` and rename, which never follows a symlink at the temp or final
    path. File mode 0600 and directory mode 0700 are set on create; existing directories are not
    re-chmodded.
  - Reads use `statSync`, a regular-file check and the 2 MiB cap, then full validation.
- **Logging:**
  - There is no `extra`, and only fixed messages are used.
  - Placeholder names are the only text taken from untrusted input; they are sanitised for
    control and C1 characters and their count and length are capped. Check for log injection.
  - Error objects: only `code === "ENOENT"` is read.
  - Fire and forget: a hanging logger cannot block startup.
- **Never-crash:**
  - Outer catch without binding.
  - The journaled rollback must restore the exact previous descriptors.
  - A partial merge must be impossible for frozen, sealed or non-configurable targets.
- **Test hermeticity:** a wrong injected `fs` or `homedir` must never fall back to the real home.
  The child-process smoke test redirects `HOME` and `USERPROFILE` and clears the PAT and
  settings env.
- **Residual (accepted):** see ADR-0009 section 1, on project-level overrides of the plugin
  tuple options.
- **Residual (accepted):** shared content can use `{file:~/...}`, which is fine under the
  C1-trusted model in ADR-0009.

## Verification
- I did not change any code. I re-read the contract after the scripted edit: every replaced
  anchor matched exactly once (the script asserts this), and the overview data flow renders as
  intended.
- I checked the design against the code:
  - `mergeInto` / `sanitizeShared` (lines 314-373) support the journal refactor without
    changing `mergeConfig`'s contract.
  - `readOwn`, `isRecordLike` and `isPlainObject` exist for reuse.
  - The server stub is at lines 1021-1023.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/test/plugin/azdo-remote-config.smoke.test.ts | The T-001 no-op and "never logs" tests contradict contract 0.7.0, and with default deps they would read the developer's real home. | Replace them as described in BE-7 (superseded behaviour; this is not disabling tests). |

## Assumptions made (no human available)
- **The cache stores `sanitizeShared(parsed)` and not the raw parsed value.** It still satisfies
  "parsed shared config, placeholders unresolved", and it keeps any shared `apiKey` off disk.
  Tests compare the file against the sanitised form.
- **Logs are fire and forget, with no `extra`.** Kilo awaits the hook, so a hanging SDK log call
  must not block startup, and fixed messages keep AC 9 trivially provable.
- **`client.app.log` is called as a method.** In the generated SDK it is a class prototype
  method that uses `this`.
- **Missing settings use the same fallback as a failed fetch** (PO decision), with reason
  `missing-settings`.
- **Cache size cap is 2 MiB.** The serialised form of content within the 1 MiB fetch limit does
  not exceed it in practice; anything above the cap is rejected safely.
- **The temp file name uses pid, time and a counter, not `node:crypto`.** The `wx` flag makes a
  collision fail safely, and it avoids a new import.
- **`XDG_CACHE_HOME` is ignored**, because FR-7 fixes `~/.cache/kilo-azdo/`.
- **We do not know how Kilo merges the plugin tuple's options across config layers.** This is
  documented as residual risk in ADR-0009, with a follow-up.

## Follow-ups for the backlog
- Verify how Kilo 7.x deduplicates plugin tuples and resolves options across the global and
  project config layers. If a project config can override the global tuple's options, add a
  guard: org/project/repo must match `KILO_AZDO_*` when those are set, or come from an env
  allow-list (ADR-0009 residual risk).
- Docs writer: state that the plugin tuple belongs only in the global `~/.config/kilo/kilo.jsonc`,
  and list the log messages (contract 2f-L) for troubleshooting.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0008/02-architect.md
summary: F-006 design: runConfigHook seam, validated atomic sanitised cache, fixed fire-and-forget logs, transactional merge (ADR-0008), trust-boundary ADR-0009, contract 0.7.0; backend tasks BE-1..BE-8
