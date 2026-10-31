# Contract: shared config validator (`validate-kilo-config`)

- Version: 1.0.0 (F-007, cycle-0009). Decision record: ADR-0010.
- Owner: Architect. Implemented by: `backend/validator/validate-kilo-config.ts` (CLI),
  `backend/validator/kilo-config-rules.ts` (library), `backend/validator/kilo-schema-subset.json`
  (data). Example input: `backend/shared-config/kilo.jsonc`.
- Consumers: Azure Pipelines PR gate in the C1 repo (F-008; exact command line and C1 layout in
  `shared-config-repo.md`), personal template check (F-009), tests.

## 1. Command line

```
node backend/validator/validate-kilo-config.ts [--allowed-hosts <list>] [--] <file> [<file>...]
node backend/validator/validate-kilo-config.ts --help
```

| Argument | Contract |
|---|---|
| `<file>` | Path to a JSONC file, relative to the current working directory or absolute. At least one is required. Files are processed in argument order. The same file given twice is processed twice. |
| `--allowed-hosts <list>` / `--allowed-hosts=<list>` | Comma-separated host names. Each entry is trimmed and lower-cased, and empty entries are dropped. Every remaining entry must match `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`. If the value is missing, an entry is invalid, or the set is empty after parsing, that is a usage error. The flag may be repeated, and the sets are united. It may appear before or after file arguments, but not after `--`. |
| `--` | Every following argument is a file, even if it starts with `-`. |
| `--help` / `-h` | Prints the usage text to stdout and exits `0` (files are ignored). |
| Any other argument starting with `-` (before `--`) | Usage error (this includes `-`, because stdin is not supported). |

## 2. Exit codes

| Code | Meaning |
|---|---|
| `0` | Every file was read and has **no errors**. Warnings are allowed. |
| `1` | Every file was read, and at least one file has at least one error. |
| `2` | A usage error (no file, unknown option, bad `--allowed-hosts`), an I/O error on **any** file, or an internal error (including an invalid `kilo-schema-subset.json`). It takes precedence over `1`. On I/O errors every other file is still validated and reported. |

## 3. Output

Everything is UTF-8 text with `\n` line endings. Every printed file name is the argument exactly
as given, with control characters (UTF-16 code units `<= 0x1F`, `0x7F`, `0x80..0x9F`) replaced by `?`.

stdout, per file, in order:
```
<file>: <severity> <rule-id> at <location>: <message>      # 0..200 lines, see section 5
<file>: note: <k> more findings not shown                   # only if more than 200 findings
<file>: valid                                               # no errors, no warnings
<file>: valid (<w> warnings)                                # no errors, w >= 1
<file>: invalid (<e> errors, <w> warnings)                  # e >= 1
```
After all files, on stdout:
```
validate-kilo-config: <n> files checked: <v> valid, <i> invalid, <u> unreadable.
```
stderr:
```
<file>: io-error: <cannot read file (<CODE>) | not a regular file>    # CODE = err.code if /^[A-Z0-9_]+$/, else UNKNOWN
validate-kilo-config: usage error: <fixed reason>                     # followed by the usage text
validate-kilo-config: internal error                                  # no message, no stack
```
- `<severity>` is `error` or `warning`. The singular and plural wording of the counts is not
  normative, so tests match with regexes.
- The order of findings within a file is deterministic but not normative.
- **No value from the file is ever printed.** That covers string values, `apiKey` values, URLs and
  placeholder paths. Only file names, rule ids, locations, fixed messages and counts appear.
  `invalid-jsonc` messages are the parser's own messages, which by contract contain only fixed
  text and line/column numbers (plugin contract section 2a).
- No stack traces. The CLI catches every error. Node's own `ExperimentalWarning` lines on stderr
  are not controlled by the CLI.

## 4. Locations (JSON paths)

| Case | Rendering |
|---|---|
| Whole file / root | `(root)` |
| Line in the raw text | `line <N>` (1-based. `\r\n`, `\n` and `\r` each end a line, the same as the parser) |
| Object key that matches `^[A-Za-z_$][A-Za-z0-9_$]*$` | `.key`, without the leading dot when it is the first segment. Example: `provider.bifrost.options.apiKey` |
| Any other key | `["<key>"]` using `JSON.stringify(sanitised key)`. Example: `provider.bifrost.models["azure/gpt-5"]` |
| Key containing `sk-bf-` (case-insensitive) | `[<redacted>]` |
| Array index | `[<i>]`. Example: `instructions[2]`, `list[0].apiKey` |

Sanitising a key means replacing control characters as in section 3 and cutting the key to 200
UTF-16 code units, then appending `...` if anything was cut.

## 5. Rules

Processing order for one file: read (I/O), size, encoding, parse, root shape, depth, then the tree
rules (one depth-first walk: object keys in `Object.keys` order, arrays by index, all rules for a
node before its children), then the schema rules, and the text secret scan always last. A failure
at size, encoding or parse stops all later rules **except** the text secret scan, which runs on any
decoded text. A root-shape or depth failure skips the tree rules and the schema rules.

| Rule id | Severity | Location | Fires when | Message (fixed) |
|---|---|---|---|---|
| `file-too-large` | error | `(root)` | File size > 1 048 576 bytes (the plugin's fetch cap). The file is not read. | `file is larger than 1 MiB` |
| `invalid-encoding` | error | `(root)` | Bytes are not valid UTF-8 (`TextDecoder("utf-8", { fatal: true })`). | `file is not valid UTF-8` |
| `invalid-jsonc` | error | `(root)` | `__internals.parseJsonc` throws. | The thrown message if it starts with `Invalid JSONC: `, otherwise `Invalid JSONC: malformed JSON` |
| `root-not-object` | error | `(root)` | Root is not a plain object (array, string, number, boolean, `null`). | `root must be a JSON object` |
| `too-deep` | error | `(root)` | A container sits at level >= 64 (root = level 0). This is the same limit as the plugin's `validateShared`. The check is iterative. | `config is nested too deeply (64 levels or more)` |
| `prototype-key` | error | key path | Own key exactly `__proto__`, `constructor` or `prototype`, at any depth. | `key is not allowed (the plugin drops it)` |
| `api-key` | error | key path | Own key with `key.toLowerCase() === "apikey"`, at any depth (inside arrays too). | `apiKey must never be in the shared config` |
| `secret-pattern` | error | key path | A **key** matches the secret pattern. | `key matches a secret pattern` |
| `secret-pattern` | error | value path | A **string value** matches the secret pattern. | `value matches a secret pattern` |
| `secret-pattern` | error | `line N` | A raw text line matches the secret pattern. One finding per matching line, which covers comments. | `text matches a secret pattern` |
| `schema-type` | error | concrete path | A path in the vendored subset exists, but its value has the wrong type (section 6). | `expected <type>` |
| `base-url-host` | error | `provider.<id>.options.baseURL` | Only with `--allowed-hosts`. Fires for every own `baseURL` under `provider.*.options` (plain objects only) when the value is not a string, `new URL(value)` throws, the protocol is not `https:`, the username or password is non-empty, or the `hostname` is not in the set. | `baseURL must be an https URL on an allowed host` |
| `prototype-member-name` | warning | key path | Own key exactly one of `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString`, `valueOf`. | `key shadows an Object.prototype member` |
| `file-placeholder-unresolvable` | warning | value path | A string value holds a `{file:PATH}` placeholder that can never resolve (section 7). One finding per distinct unresolvable placeholder per string. | `{file:} placeholder will never resolve (use ~/ or an absolute path)` |
| `plugin-ignored` | warning | `plugin` | The root has an own key `plugin`. | `top-level plugin is ignored by the merge` |

Secret pattern: `/sk-bf-[a-z0-9]/i`. Rule names, keys and messages never contain the matched
text. For example, `sk-bf-...` and `sk-bf-<your-key>` do **not** match, and `sk-bf-AbCd1234`
does. (The example was shortened in F-016 so that docs never contain 16+ key-like characters
after `sk-bf-`; see `docs-check.md`.)

Walking: key values are read with `Object.getOwnPropertyDescriptor(obj, key)?.value`. The walk
writes to nothing, and `Object.prototype` is never modified.

## 6. Vendored schema subset (`backend/validator/kilo-schema-subset.json`)

```json
{
  "$comment": "Type-only subset of Kilo's config schema used by the F-007 validator. See ADR-0010.",
  "kiloVersionRange": ">=7.2.0 <8.0.0",
  "source": "https://app.kilo.ai/config.json",
  "rules": [
    { "path": "$schema", "type": "string" },
    { "path": "model", "type": "string" },
    { "path": "small_model", "type": "string" },
    { "path": "provider", "type": "object" },
    { "path": "provider.*", "type": "object" },
    { "path": "provider.*.npm", "type": "string" },
    { "path": "provider.*.name", "type": "string" },
    { "path": "provider.*.options", "type": "object" },
    { "path": "provider.*.options.baseURL", "type": "string" },
    { "path": "provider.*.models", "type": "object" },
    { "path": "provider.*.models.*", "type": "object" },
    { "path": "agent", "type": "object" },
    { "path": "agent.*", "type": "object" },
    { "path": "mcp", "type": "object" },
    { "path": "mcp.*", "type": "object" },
    { "path": "instructions", "type": "array" },
    { "path": "disabled_providers", "type": "array" },
    { "path": "enabled_providers", "type": "array" }
  ]
}
```

| Aspect | Contract |
|---|---|
| Types | `object` = non-null, non-array object. `array` = `Array.isArray`. `string`, `number`, `boolean` = `typeof`. |
| Paths | Segments separated by `.`. A `*` segment matches every own key of the value when that value is a plain object, and matches nothing otherwise. Literal segments match an own key only. |
| Semantics | A rule applies only to concrete paths that exist. Missing keys and unknown keys are never errors. When a parent is the wrong type, its own rule reports it and the child rules find nothing. |
| Loader | `loadSchemaSubset()` reads the file next to the library (`new URL("./kilo-schema-subset.json", import.meta.url)`) with `JSON.parse`. It throws if the root is not an object, `kiloVersionRange` or `source` is not a non-empty string, `rules` is not an array, or a rule has a non-empty-string `path` with a `type` outside the five types. The CLI maps a throw to `internal error`, exit 2. |
| Pinning | `kiloVersionRange` **must equal** the plugin's `SUPPORTED_KILO_RANGE` (enforced by a test). |

## 7. `{file:}` placeholder probe

For each string value that contains `{file:`:
```ts
__internals.resolvePlaceholders(value, {
  env: {},
  homedir: () => PROBE_HOME,          // constant absolute path, e.g. "/probe-home"; never touched
  readFile: () => "probe",            // never reads the filesystem
}).unresolved.filter((e) => e.startsWith("file:"))
```
Each entry gives one `file-placeholder-unresolvable` warning at the value's path. With the plugin's
grammar (plugin contract section 2b) this flags relative paths, bare `~`, `~user/...` and UNC-like
paths (the first two characters are `/` or `\`). `{file:~/x}`, `{file:~\x}`, absolute paths
(`isAbsolute` on the host running the validator) and `{env:...}` are never flagged. The validator
never reads env vars or files on behalf of the config.

## 8. Library API (`backend/validator/kilo-config-rules.ts`)

```ts
export type Severity = "error" | "warning";
export type RuleId =
  | "file-too-large" | "invalid-encoding" | "invalid-jsonc" | "root-not-object" | "too-deep"
  | "prototype-key" | "api-key" | "secret-pattern" | "schema-type" | "base-url-host"
  | "prototype-member-name" | "file-placeholder-unresolvable" | "plugin-ignored";
export interface Finding { severity: Severity; rule: RuleId; location: string; message: string }
export type SchemaType = "object" | "array" | "string" | "number" | "boolean";
export interface SchemaRule { path: string; type: SchemaType }
export interface SchemaSubset { kiloVersionRange: string; source: string; rules: readonly SchemaRule[] }
export interface ValidateOptions {
  allowedHosts?: ReadonlySet<string>;   // undefined -> base-url-host never runs
  schema?: SchemaSubset;                // default: loadSchemaSubset() (loaded once, cached)
}

export const MAX_FILE_BYTES = 1048576;
export const MAX_DEPTH = 64;
export const MAX_PRINTED_FINDINGS = 200;
export const SECRET_PATTERN: RegExp;    // /sk-bf-[a-z0-9]/i (no g flag)

export function loadSchemaSubset(): SchemaSubset;                         // throws on an invalid file
export function validateConfigText(text: string, options?: ValidateOptions): Finding[];
export function validateConfigBytes(bytes: Uint8Array, options?: ValidateOptions): Finding[]; // size + encoding, then validateConfigText
export function parseAllowedHosts(list: string): Set<string> | undefined; // undefined = invalid
export function formatLocation(segments: readonly (string | number)[]): string;
```

- `validateConfigText` and `validateConfigBytes` never throw for any string or byte input (an
  unexpected internal error propagates only from `loadSchemaSubset`). They are pure: no I/O apart
  from the one-time schema load, no logging, no global state.
- `Finding.message` and `Finding.location` follow sections 4 and 5, so they never contain values.
- This module is **not** the plugin: ADR-0002's export rules do not apply, and functions may be
  exported.

## 9. Example shared config (`backend/shared-config/kilo.jsonc`)

This is VISION Appendix A with explanatory `//` and `/* */` comments: `$schema`, `provider.bifrost`
with `npm`, `name`, `options.baseURL = "https://bifrost.yourcompany.internal/v1"` and
`models` `azure/gpt-5` and `azure/gpt-5-mini` (empty objects). It has no `apiKey`, no `sk-bf-`
text (not even in comments), no `plugin` and no placeholders. It must validate with exit 0, with
and without `--allowed-hosts bifrost.yourcompany.internal`, and give zero warnings.
