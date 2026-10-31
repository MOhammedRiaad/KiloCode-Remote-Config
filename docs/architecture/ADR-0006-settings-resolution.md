# ADR-0006: Settings resolution (options > KILO_AZDO_* env > defaults), secret-safe and URL-safe
- Status: accepted (section 4 amended by ADR-0007, cycle-0007: org, project, repo, branch and path
  must also be well-formed UTF-16, i.e. contain no lone surrogate; otherwise W2)
- Date: 2026-10-30
- Cycle / item: cycle-0006 / F-004

## Context

FR-1 / FR-8 and the settings half of FR-3: the plugin reads `org`, `project`, `repo`, `path`,
`branch`, `mode`, `pat` and `timeoutMs` from its plugin options, falls back to `KILO_AZDO_*`
environment variables, then to built-in defaults.

How the options reach the plugin: Kilo reads the tuple `["./azdo/azdo-remote-config.ts", { ... }]`
from the global `plugin` array and calls `server(input, options)` with the second element
(ADR-0001 section 5). That element can be anything a user writes in JSONC: missing, `null`, an
array, a string, a number, or an object with wrongly typed values. This ADR only decides what the
**helper** takes: the raw second tuple element, typed `unknown`.

Constraints:
- FR-11 / ADR-0001: single file, zero npm dependencies, `node:` imports only. No new import is
  needed (the `process` global is already used by ADR-0004).
- ADR-0002: helpers reach tests only through `__internals`. No named function exports.
- FR-9 / AC-9: the PAT must never appear in logs. The helper does not log (F-006 does), so its
  outputs other than `settings.pat` must never contain the PAT, nor any other value.
- FR-10: the helper must never throw. F-006 will call it before anything else in the hook.
- F-005 interpolates `org`, `project`, `repo` into the path of
  `https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items`, and `path` and
  `branch` into its query string. A value containing `/`, `?`, `#` or `%` could change which
  resource is requested.
- Out of scope here: the `AZDO_PAT` / `AZURE_DEVOPS_EXT_PAT` fallbacks and the `az` token
  (F-005), and logging the warnings (F-006). The helper is not wired into `server` / `config` yet.

## Decision

### 1. Exposure and signature

A module-local function exposed as the fourth `__internals` key:
`{ parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings }`.

```ts
type Mode = "defaults" | "enforce";                       // module-local
type RequiredSetting = "org" | "project" | "repo";        // module-local
interface Settings {                                      // module-local
  org: string | undefined;
  project: string | undefined;
  repo: string | undefined;
  path: string;
  branch: string;
  mode: Mode;
  pat: string | undefined;        // own NON-enumerable property (section 7)
  timeoutMs: number;
}
interface SettingsDeps {                                  // module-local
  env?: Readonly<Record<string, string | undefined>>;   // default: process.env, read at call time
}
interface SettingsResult {                                // module-local
  settings: Settings;
  missing: RequiredSetting[];
  warnings: string[];
}

function resolveSettings(options?: unknown, deps?: SettingsDeps): SettingsResult;
```

- Synchronous, no I/O, no logging, no global state. It never writes to `options`, `deps` or the env.
- **No type, interface or constant is exported.** The only new export surface is the
  `resolveSettings` key on `__internals`.

### 2. Reading the sources (own data properties only, never throwing)

- **Options object.** `options` is used iff it is a non-null object that is not an array
  (`typeof options === "object" && options !== null && !Array.isArray(options)`). Its prototype is
  not checked.
  - `undefined` or `null`: no options, no warning.
  - Anything else (array, string, number, boolean, function, ...): no options, plus warning W0.
- **Env.** Use `deps.env` if `deps` is a non-null object and `deps.env` is a non-null, non-array
  object. If `deps` or `deps.env` is `undefined`, use `process.env`, read at call time (not at
  module load). Any other `deps.env` value (such as `null`, a string or an array) is treated as an
  **empty env**. The helper does not fall back to the real environment when a caller clearly meant
  to inject one.
- **Reading a key** (from options, env, or `deps`) uses one guarded helper:
  `try { const d = Object.getOwnPropertyDescriptor(src, key); return d !== undefined && "value" in d ? d.value : undefined; } catch { return undefined; }`.
  - Only **own data** properties count. Inherited values (`Object.create({ KILO_AZDO_ORG: "inh" })`)
    and accessor properties are treated as absent, so a getter is never invoked.
  - A throwing Proxy trap counts as absent.
  - The object-shape checks above (`typeof`, `Array.isArray`) run inside a `try` too, so a revoked
    Proxy counts as "not an object".
- Only the eight fixed setting names and the eight fixed env names below are read. Other keys in
  `options` (including own `__proto__`, `constructor` and `prototype`) are never read, copied or
  enumerated. This makes prototype pollution through this helper impossible.

### 3. Names, precedence and defaults

| Setting | Option key | Env var | Default | Required (`missing`) |
|---|---|---|---|---|
| org | `org` | `KILO_AZDO_ORG` | none (`undefined`) | yes |
| project | `project` | `KILO_AZDO_PROJECT` | none | yes |
| repo | `repo` | `KILO_AZDO_REPO` | none | yes |
| path | `path` | `KILO_AZDO_PATH` | `/kilo.jsonc` | no |
| branch | `branch` | `KILO_AZDO_BRANCH` | `main` | no |
| mode | `mode` | `KILO_AZDO_MODE` | `defaults` | no |
| pat | `pat` | `KILO_AZDO_PAT` | none (F-005 adds `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT`, then `az`) | no |
| timeoutMs | `timeoutMs` | `KILO_AZDO_TIMEOUT_MS` | `5000` | no |

Env var names are case-sensitive as written. On Windows, Node's `process.env` itself matches
names case-insensitively. That is accepted as is.

For each setting the helper looks at the sources in this order: option, then env, then default.
- **Absent** (no own data property, value `undefined` or `null`): skip silently.
- **Empty** (a string that is empty or whitespace-only after `trim()`): skip silently.
- **Invalid** (any other value that fails validation, see section 4): skip **with a warning**.
- **Valid**: take it and stop.

So an invalid option falls through to a valid env value, and an invalid env value falls through
to the default. This is the same rule for all eight settings.

`repo` has **no default** (contract 0.4.0 section 4 said `kilo-config`; this ADR supersedes it,
following the F-004 acceptance criteria). A missing repo is reported in `missing`.

`missing` lists, in the fixed order `org`, `project`, `repo`, every required setting whose final
value is `undefined`. It is a new array built from fixed string literals.

### 4. Validation and normalisation (applies to option and env values alike)

All string values are trimmed with `String.prototype.trim()` first. The trimmed value is the one
validated and returned.

**Control characters** means any UTF-16 code unit `<= 0x1F` or `=== 0x7F`.

| Setting | Accepted type(s) | Valid when (after trim) | Normalisation |
|---|---|---|---|
| org, project, repo | string | non-empty; no control characters; none of `/` `\` `?` `#` `%`; not exactly `.` or `..` | none |
| branch | string | non-empty; no control characters; no space; none of `\` `?` `#` `%`; does not contain `..` or `//`; does not start or end with `/` | none (`feature/x` stays as is) |
| path | string | non-empty; no control characters; none of `\` `?` `#` `%`; after normalisation every segment is non-empty and is not `.` or `..` | prepend `/` if the trimmed value does not start with `/` |
| mode | string | exactly `defaults` or `enforce` (case-sensitive, after trim) | none |
| pat | string | non-empty | trim only; no character-set check (it is base64-encoded by F-005, never put in a URL) |
| timeoutMs | number, or string | number: `Number.isInteger(v) && v >= 1 && v <= 2147483647`. String: trimmed value matches `^[0-9]+$` (ASCII digits only; no sign, decimal point, exponent, hex, `_` or `Infinity`) and `Number(trimmed)` lies in 1..2147483647 | string converted with `Number` |

Details:
- **Path segments.** "Segments" are the parts of the normalised path after its leading `/`,
  split on `/`. So `/a//b`, `/a/`, `/`, `/./a`, `/a/../b` and `..` (becoming `/..`) are invalid.
  `teams/a/kilo.jsonc` becomes `/teams/a/kilo.jsonc`.
  - **Decision: `..` and `.` segments are rejected, not kept or resolved.** Rejecting is the
    conservative choice. Azure DevOps paths are repo-rooted, and no legitimate config needs
    relative segments.
- **Wrong type.** For example a number for `org`, an object for `branch`, a boolean for `pat`,
  a number for `mode`, or a boolean or object for `timeoutMs`. It is invalid, so it gets a warning.
- **Upper bound for timeoutMs.** 2147483647 is the largest delay `setTimeout` (and therefore
  `AbortSignal.timeout`) honours in Node and Bun. Larger delays overflow to about 1 ms, so this is
  a technical bound, not a product limit. There is no other cap.
- **Mode.** `force`, `ENFORCE`, `Enforce` and numbers are invalid, so the helper warns and falls
  through (to `defaults` when env has no valid mode).
- A numeric-string option for `timeoutMs` (for example `"3000"`) is accepted under the same
  grammar as the env var.

### 5. URL-safety: validated here (decision for the F-005 interpolation)

**Decision: the settings helper validates character sets** (the table above). Values that could
alter the URL path or query are ignored with the fixed warning W2.

F-005 must **still** encode every interpolated value: path segments with `encodeURIComponent`, and
query values through `URLSearchParams` or `encodeURIComponent`. This is defence in depth, because
the deny-list does not cover characters such as space, `&`, `+`, `=`, `;`, `:` or `@`, which are
legal in Azure DevOps project or repo names or in file names.
- The denied characters are never legal in Azure DevOps org, project or repo names, or in git
  branch names (`\`, `?`, `#`, `%`, control characters, space in branches, `..` in branches).
  So rejecting them loses nothing real.

### 6. Warnings (fixed texts)

Every warning is built only from the fixed templates below. The `<src>` part is built only from the
constant setting name and the constant env name, never from input:
- for an option: `plugin option <name>`
- for an env var: `environment variable <ENV> (<name>)`

Here `<name>` is the camelCase setting name (`org`, ..., `timeoutMs`) and `<ENV>` is its env var
from section 3.

| Id | When | Exact text |
|---|---|---|
| W0 | `options` is not undefined, null or a non-array object | `Ignored plugin options: expected an object.` |
| W1 | org, project, repo, path, branch or pat value is not a string | `Ignored <src>: expected a string.` |
| W2 | org, project, repo, path or branch string fails the section 4 rules | `Ignored <src>: contains characters or segments that are not allowed.` |
| W3 | invalid mode (any type) | `Ignored <src>: expected "defaults" or "enforce".` |
| W4 | invalid timeoutMs (any type) | `Ignored <src>: expected a whole number of milliseconds from 1 to 2147483647.` |

Examples:
- `Ignored plugin option mode: expected "defaults" or "enforce".`
- `Ignored environment variable KILO_AZDO_TIMEOUT_MS (timeoutMs): expected a whole number of milliseconds from 1 to 2147483647.`

Order: W0 first (if any). Then the settings in the fixed order org, project, repo, path, branch,
mode, pat, timeoutMs. Within each setting the option warning comes before the env warning. The env
is only consulted when the option did not yield a valid value. So an option and an env warning for
the same setting appear together only when both are invalid. There is at most one warning per
setting and source. Absent and empty values never warn.

### 7. Secret safety and the returned objects

- `settings` is a fresh ordinary object (prototype `Object.prototype`). Its keys are created in the
  fixed order org, project, repo, path, branch, mode, pat, timeoutMs. Nothing from `options` is
  spread or copied into it.
- **`pat` is defined with `Object.defineProperty(settings, "pat", { value, enumerable: false, writable: false, configurable: false })`**
  even when the value is `undefined`. So `settings.pat` and `"pat" in settings` work, while
  `Object.keys`, `JSON.stringify`, object spread and `util.inspect` (default options) do not reveal
  it. This defends against a future `log(settings)` (FR-9 / AC-9).
  - Consequence: `assert.deepStrictEqual(settings, {...})` ignores `pat`, so tests must assert
    `settings.pat` directly.
- `warnings` and `missing` contain only the fixed strings from sections 3 and 6. No input value
  (pat or otherwise) ever appears in them.
- The function contains no `throw`, and every read of untrusted input is guarded (section 2), so
  no error, and therefore no error message, can carry a value.

### 8. Not wired yet

F-006 calls `resolveSettings(options)` from `server` or `config`. If `missing` is non-empty it
skips the fetch, and it logs `warnings` and `missing` through `client.app.log` at level `warn`.
F-005 consumes `settings` (and adds the PAT fallbacks).

## Consequences

- Settings handling is deterministic and fully unit-testable with an injected env.
- Misconfiguration is reported by setting name only. Users get "which setting" but never "what
  value", which is acceptable for a secret-bearing config.
- Rejecting `..` and `.` path segments and URL-structural characters may reject an exotic but legal
  value. The warning names the setting, so the user can fix it.
- Callers that log or serialise `settings` cannot leak the PAT by accident. Code that needs the PAT
  reads `settings.pat` explicitly.

## Alternatives considered

- **Leave character-set validation to F-005 (encode only).** Encoding alone prevents injection,
  but it silently requests a different resource (for example `org = "a/b"` becomes `a%2Fb`, which
  gives a confusing 404). Validating here gives a precise warning that names the setting.
  Rejected as the only layer; F-005 still encodes.
- **Invalid value goes straight to the default** (skipping env). This is inconsistent with
  "ignored, so env or default applies" for wrong types, and it is harder to explain. Rejected.
- **Case-insensitive mode** (`ENFORCE` accepted). The acceptance criteria require it to be
  invalid, and `defaults` is the conservative fallback. Rejected.
- **Throw on invalid settings.** This violates FR-10. Rejected.
- **Enumerable `pat`.** Simpler for deep-equality tests, but one stray `log(settings)` leaks the
  secret. Rejected.
- **Resolve `..` segments** (`/a/../b` becomes `/b`). Hides user mistakes and adds code for no
  real use case. Rejected; such paths are rejected instead.
- **Warn on empty strings.** An empty `KILO_AZDO_*` variable is a common way to "unset" a value,
  so warning on it would be noise. Rejected.
