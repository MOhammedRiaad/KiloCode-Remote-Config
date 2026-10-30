# Architect report — cycle 0006 — F-004: Plugin: settings resolution (options, env, defaults)

## Inputs read
- factory/runs/cycle-0006/01-product-owner.md (item and its 8 acceptance criteria)
- factory/VISION.md (FR-1, FR-3, FR-8, FR-9, FR-10, FR-11, FR-15, AC-9)
- docs/architecture/ADR-0001..0005, overview.md, contracts/plugin-interface.md v0.4.0
- backend/plugin/azdo-remote-config.ts: existing helpers `hasOwn`, `defineOwn`, `isPlainObject`, `__internals`
- backend/test/plugin/azdo-remote-config.smoke.test.ts (asserts the exact `__internals` key list)
- backend/tools/check-fr11.mjs (its comment stripper uses the regex `/\/\*[\s\S]*?\*\//`)
- backend/tsconfig.json (strict, noUncheckedIndexedAccess, no exactOptionalPropertyTypes)
- factory/runs/cycle-0005/02-architect.md (report format)

## Work done
Design summary. ADR-0006 and contract section 2d hold the full detail and are normative.

### Signature and result
```ts
function resolveSettings(options?: unknown, deps?: SettingsDeps): SettingsResult
```
- It is module-local and exposed as the 4th key of `__internals`: `{ parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings }`.
- It is synchronous and pure. It never throws and never mutates its inputs.
- It returns `{ settings, missing, warnings }`.
  - `settings` has these keys, in this order: org, project, repo, path, branch, mode, pat, timeoutMs.
  - org, project, repo and pat are `string | undefined`.
  - `pat` is an own **non-enumerable**, non-writable property, so `JSON.stringify` or a logged `settings` never shows the PAT.
- All types and constants are module-local. No new exports and no new imports.

### Sources
- `options`: used only if it is a non-null, non-array object.
  - `undefined` or `null`: ignored with no warning.
  - Any other value: ignored, and warning W0 is added.
- `deps.env`: the env to read. It must be a non-null, non-array object.
  - If `deps` or `deps.env` is undefined, `process.env` is read at call time.
  - Any other value is treated as an empty env.
- Every read goes through one guarded helper: `Object.getOwnPropertyDescriptor` inside a `try`.
  - Only own **data** properties count.
  - Inherited properties, accessors and throwing proxies count as absent.
  - Getters are never invoked.
- Only the 8 fixed option keys and the 8 fixed env names are ever read. Nothing is copied from `options`, so pollution is impossible.

### Precedence
Option, then `KILO_AZDO_*` env, then default. A source value is treated like this:
- **Absent** (`undefined`, `null` or not own) or **empty** (whitespace-only): skipped silently.
- **Invalid**: skipped with a warning.
- **Valid**: the first one wins.

An invalid option therefore falls through to the env, then to the default. That is consistent with AC-5.

Defaults:
- path: `/kilo.jsonc`
- branch: `main`
- mode: `defaults`
- timeoutMs: 5000
- org, project, repo, pat: no default (`undefined`)

`missing` is the setting names from `["org","project","repo"]` that are still undefined.

### Validation
All values are trimmed first.

| Setting | Rejected (W2 unless noted) |
|---|---|
| org, project, repo | control characters, `/`, `\`, `?`, `#`, `%`, and exactly `.` or `..` |
| branch | control characters, space, `\`, `?`, `#`, `%`, `..`, `//`, a leading or trailing `/` |
| path | A leading `/` is prepended first. Then rejected: control characters, `\`, `?`, `#`, `%`, and any empty, `.` or `..` segment |
| mode | anything except exactly `defaults` or `enforce` (case-sensitive): W3 |
| pat | only needs to be a non-empty string |
| timeoutMs | A number must be an integer from 1 to 2147483647. A string must match `^[0-9]+$` and fall in the same range. Anything else: W4 |

- Wrong types give W1 for string settings, W3 for mode and W4 for timeoutMs.
- The `..` decision: `..` and `.` path segments are **rejected**. They are not resolved and not kept.

### URL-safety decision (for F-005)
The settings helper **validates** the character sets (above) and ignores bad values with the fixed warning W2. F-005 must **still** encode every interpolated value with `encodeURIComponent` / `URLSearchParams` as defence in depth.

### Warning texts
These are fixed (ADR-0006 section 6). `<src>` is either `plugin option <name>` or `environment variable <ENV> (<name>)`.

- W0: `Ignored plugin options: expected an object.`
- W1: `Ignored <src>: expected a string.`
- W2: `Ignored <src>: contains characters or segments that are not allowed.`
- W3: `Ignored <src>: expected "defaults" or "enforce".`
- W4: `Ignored <src>: expected a whole number of milliseconds from 1 to 2147483647.`

Ordering rules:
- W0 comes first.
- Then the settings in order, with the option warning before the env warning.
- There is at most one warning per setting and source.
- Values never appear in a warning.

### Documents
- **ADR-0006** was written.
- The **contract** was bumped from 0.4.0 to **0.5.0**:
  - new section 2d;
  - the `__internals` row was updated;
  - section 4 is now normative: `repo` no longer has a `kilo-config` default, and `KILO_AZDO_PAT` was added.
- The **overview** was updated.

## Files changed
- `docs/architecture/ADR-0006-settings-resolution.md`: new ADR.
- `docs/architecture/contracts/plugin-interface.md`: v0.5.0, section 2d, `__internals` key order, section 4 normative.
- `docs/architecture/overview.md`: cycle-0006 / F-004 header, C2 status, data flow, internal structure, test layout.
- `factory/runs/cycle-0006/02-architect.md`: this report.

## Backend tasks

All work is in `backend/`.

**Constraints for the engineer (all tasks):**
- Do not write the two-character sequences slash-star or star-slash anywhere in the plugin file. That covers comments, string literals and regex literals, because the check-fr11 comment stripper would treat them as a comment.
  - Watch regexes and strings that deal with paths. Prefer string operations for path checks: `startsWith`, `endsWith`, `split("/")`, `includes`. Do not use regexes like `/^\/+/`.
- New comments use `//` only.
- ASCII only. No raw invisible characters: write control-character checks with `charCodeAt`, not literal characters.
- LF line endings.
- Only `node:` imports. Add no import for this item: `process` is a global that is already used.
- Erasable TypeScript only.
- `backend/package.json` keeps no `dependencies`.
- The function must contain no `throw` statement.

### BE-1: implement `resolveSettings` in `backend/plugin/azdo-remote-config.ts` (AC-1..AC-7)
- Add a section `// ---- Settings resolution (ADR-0006) ----` after `mergeConfig` and before `__internals`.
- Add these module-local items. None of them is exported.
  - Types: `Mode`, `RequiredSetting`, `Settings`, `SettingsDeps`, `SettingsResult`.
  - Constants: `DEFAULT_PATH = "/kilo.jsonc"`, `DEFAULT_BRANCH = "main"`, `DEFAULT_TIMEOUT_MS = 5000`, `MAX_TIMEOUT_MS = 2147483647`.
  - A fixed table of setting name to env var name.
- Add the guarded own-data reader:
  - `try { const d = Object.getOwnPropertyDescriptor(src, key); return d !== undefined && "value" in d ? d.value : undefined; } catch { return undefined; }`
  - Use a `catch` without a binding.
  - Do not reuse `hasOwn` plus bracket access, because that would invoke getters.
- Add a guarded `isRecordLike(v)` that wraps `typeof`, `null` and `Array.isArray` in a `try` and returns false on a throw.
- Apply the per-setting validators, normalisation, precedence and warnings exactly as in ADR-0006 sections 3, 4 and 6 and contract section 2d.
  - Warning text must be built only from the constant names. Never interpolate any input.
- Build `settings` as an object literal with the 7 enumerable keys in this order: org, project, repo, path, branch, mode, timeoutMs.
  - Then call `Object.defineProperty(settings, "pat", { value: pat, enumerable: false, writable: false, configurable: false })`.
  - Note: the contract lists pat in 7th position conceptually. With non-enumerable pat, `Object.keys(settings)` must equal `["org","project","repo","path","branch","mode","timeoutMs"]`.
- Set `__internals = { parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings }`, in that order.
- Update the header comment of the file to mention ADR-0006 and settings.

### BE-2: tests `backend/test/plugin/settings.test.ts` (new)
Use `node:test` and `node:assert/strict`. Always inject `env` except in the single `process.env` test. Required cases:
1. **AC-1 precedence.** For each of the 8 settings, the option beats the env, and the env beats the default. For example, `{org:"opt"}` with `KILO_AZDO_ORG=env` gives `opt`. With no branch option and `KILO_AZDO_BRANCH=dev`, branch is `dev`. Cover timeoutMs from an option number (3000) and from an env string (`"2500"`). Cover pat via `settings.pat`.
2. **AC-2 defaults.** `resolveSettings(undefined, { env: {} })` gives path `/kilo.jsonc`, branch `main`, mode `defaults`, timeoutMs 5000, and org/project/repo/pat `undefined`. `missing` deep-equals `["org","project","repo"]` and `warnings` deep-equals `[]`. Also check that `missing` is `[]` when all three are set, and `["repo"]` when only repo is unset.
3. **AC-3 mode.**
   - `enforce` from an option or from env gives `enforce`.
   - `force`, `ENFORCE`, `Enforce`, `""` (silent) and `1`, each as an option and as env, give `defaults`.
   - Every invalid case except the empty string has a warning containing `mode`.
   - Check the exact W3 texts for both the option source and the env source.
   - An invalid option with a valid env `enforce` gives `enforce`, with one option warning.
   - `"  enforce  "` gives `enforce`.
4. **AC-4 timeoutMs.**
   - These option values give 5000 plus a warning containing `timeoutMs`: `0`, `-1`, `NaN`, `Infinity`, `-Infinity`, `2.5`, `"abc"`, `true`, `{}`, `2147483648`.
   - These env values do the same: `"0"`, `"-5"`, `"abc"`, `"NaN"`, `"Infinity"`, `"2.5"`, `"1e3"`, `"0x10"`, `"2147483648"`.
   - Accepted: `" 2500 "` gives 2500, `2147483647` is accepted, and the option string `"3000"` gives 3000.
   - Check the exact W4 text.
5. **AC-5 malformed options.**
   - `null` gives no warning.
   - An array, a string, a number, `true` and a function each give exactly W0 and the defaults or env values apply.
   - A number for org and an object for branch give W1 and the env value applies.
   - `""` or `"   "` for org gives no warning and the env value applies.
   - Values are trimmed (`"  a  "` gives `a`).
   - `teams/a/kilo.jsonc` gives `/teams/a/kilo.jsonc`.
   - These path values give W2 and the default applies: `/`, `/a/`, `/a//b`, `/a/../b`, `..`, `./x`, `/a?b`, `/a#b`, `/a%2e`, `a\b`.
   - org/project/repo values `a/b`, `a?b`, `a#b`, `a%b`, `a\b`, `.`, `..` and `"a\u0001b"` (written as an escape in the test) give W2. Also `"my project"` is accepted for project.
   - branch values `feature/x` and `release/1.0` are accepted. `a b`, `a..b`, `/a`, `a/`, `a//b` and `a?b` give W2.
   - Nothing throws for any of these.
6. **AC-6 secrets.**
   - With a pat option and `KILO_AZDO_PAT` both set, `settings.pat` is the option value.
   - Use a unique sentinel PAT, for example `"PAT-SENTINEL-1234"`. Pass it as a valid option, as an option with surrounding spaces, as env, and wrongly typed (in an array and in an object). In every case `JSON.stringify({ missing, warnings })` does not contain the sentinel, and `JSON.stringify(settings)` does not contain it either.
   - `Object.keys(settings)` has no `pat`, and `Object.getOwnPropertyDescriptor(settings, "pat").enumerable` is false.
   - Put the same sentinel in org (an invalid value such as `"PAT-SENTINEL/1234"`) and check that the warnings do not contain it.
7. **AC-7 non-mutation and pollution.**
   - Deep-equal plus a frozen-input variant: `Object.freeze` options and env, and the call must not throw.
   - `Object.create({ KILO_AZDO_ORG: "inh" })` as the env gives org `undefined`.
   - An options object with an inherited org gives org `undefined`.
   - An accessor property `org` whose getter would throw is never invoked: use a counter, and org stays `undefined`.
   - Options from `JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1},"prototype":{"y":1},"org":"o"}')` leave `({}).polluted` `undefined`, keep `Object.getPrototypeOf(settings) === Object.prototype`, and give `settings` no own `__proto__`, `constructor` or `prototype` keys.
   - A `Proxy` whose `getOwnPropertyDescriptor` trap throws, and a revoked proxy, used as options and as env, do not throw.
8. **Env deps.**
   - `deps.env` set to `null`, `"x"` or `[]` is treated as an empty env (set `process.env.KILO_AZDO_ORG` temporarily and check it is NOT used).
   - With `deps` omitted, a temporarily set unique `process.env.KILO_AZDO_BRANCH` is used. Restore it in `finally`.
9. **Warning order.** All 8 settings invalid in both the option and the env (plus a non-object case for W0 separately) give a `warnings` array deep-equal to the exact expected list in setting order, with the option warning before the env warning.

### BE-3: update `backend/test/plugin/azdo-remote-config.smoke.test.ts` (AC-8)
- Assert `typeof __internals.resolveSettings === "function"`.
- The key list becomes `["parseJsonc","resolvePlaceholders","mergeConfig","resolveSettings"]`.
- The module export list stays `["PLUGIN_ID","SUPPORTED_KILO_RANGE","__internals","default"]`.

### BE-4: quality gate (AC-8)
- `bash scripts/ci.sh` exits 0. That covers check-fr11, `tsc --noEmit` and `node --test`.
- `backend/package.json` is unchanged and still has no `dependencies`.
- The `server` / `config` hook stays a no-op. No wiring in this item.

## Frontend tasks

None. `scope.frontend` is false and `frontend/` is intentionally absent.

## Security notes (for the Security engineer)
- **Secret handling.** The PAT only appears in `settings.pat`, which is non-enumerable and read-only. `missing` and `warnings` are built from constants. The function has no `throw`, so no error message exists. Verify there is no template interpolation of any input in the warning texts.
- **Input validation.** Only own data properties are read, through `getOwnPropertyDescriptor` inside a `try`. Getters are never invoked. Only fixed keys are read. `settings` is a fresh literal, so there is no pollution vector.
- **URL injection (F-005 dependency).** org, project and repo reject `/ \ ? # %`, control characters and `.`/`..`. Branch also rejects space, `..`, `//` and leading or trailing `/`. Path rejects empty, `.` and `..` segments. F-005 must still percent-encode every interpolated value (recorded in ADR-0006 section 5 and contract 2d). A follow-up check in the F-005 review should confirm this.
- **Denial of service.** The timeoutMs range is bounded at 2^31-1 to avoid the timer-overflow behaviour (where a huge value becomes about 1 ms). No regex with backtracking risk is needed (only `^[0-9]+$`).
- **Env source.** With `deps.env` injected but malformed, the real `process.env` is NOT consulted.

## Verification
- Documentation-only changes. The edited Markdown files were checked by grep: section headers in the contract are in order 2a..2d, 3, 4, 5, and the Version line is 0.5.0. No product code was changed, so `scripts/ci.sh` was not affected by this phase.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | docs/architecture/contracts/plugin-interface.md section 4 | The 0.4.0 informative schema gave `repo` a default of `kilo-config`. That conflicts with the F-004 AC (repo is required and listed in `missing`). | Fixed in 0.5.0: no repo default. The installer (C5) or template (C3) should write `repo` explicitly. |

## Assumptions made (no human available)
- Invalid values fall through to the next source, not straight to the default. This is consistent with AC-5 "ignored so env/default applies".
- `null` is treated as absent (silent), and empty or whitespace-only strings are silent. Only wrongly typed or invalid values warn. This avoids noise for a common way of "unsetting" a value.
- timeoutMs accepts a numeric digit string in options as well (same grammar as the env var). The upper bound 2147483647 is the technical timer limit, not a product limit.
- `pat` is non-enumerable as defence in depth for FR-9/AC-9. Tests assert `settings.pat` directly.
- The character-set validation is done in the settings helper, and F-005 must still encode. The deny-lists are restricted to characters that are never legal in Azure DevOps org/project/repo names or git branch names, so legitimate values are not rejected.
- `..` and `.` path segments are rejected (conservative), not resolved.
- Kilo passes the raw second tuple element. The helper accepts `unknown` and the `server` signature is unchanged.

## Follow-ups for the backlog
- F-005: percent-encode org/project/repo path segments and the path/branch query values, even though F-004 already validates them. PAT precedence: option > `KILO_AZDO_PAT` > `AZDO_PAT` > `AZURE_DEVOPS_EXT_PAT` > `az`.
- F-006: log `warnings` (level `warn`) and `missing` (skip the fetch when it is non-empty). Never log `settings` wholesale, even though pat is non-enumerable.
- C3 template / C5 installer: write `org`, `project` and `repo` explicitly (repo has no default).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0006/02-architect.md
summary: Designed F-004 resolveSettings (ADR-0006, contract v0.5.0): options > KILO_AZDO_* env > defaults, own-data-only guarded reads, trimmed and URL-safe validation, fixed value-free warnings, non-enumerable pat, never throws; 4 backend tasks, no frontend.
