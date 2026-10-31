# ADR-0010: Shared config validator CLI (C1 PR gate tooling)
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0009 / F-007

## Context

FR-12 / FR-13 / AC-13: the shared config repo (C1) holds `/kilo.jsonc` (and optional
`/teams/<team>/kilo.jsonc`, FR-15). Before a change reaches `main`, a PR gate must parse the
JSONC, check it against Kilo's config schema, reject any `apiKey` field and reject secret
patterns such as `sk-bf-`. The gate itself is wired into Azure Pipelines by F-008; F-009 reuses the
secret check for the personal template. Earlier security reviews (cycle 0005) asked for warnings
on `{file:}` placeholders that can never resolve, on prototype-named keys and on top-level
`plugin`, plus an optional `baseURL` host allowlist.

Constraints:
- ADR-0001: Node >= 22.18 built-ins only, TypeScript with erasable syntax, no runtime
  dependencies, no new dev dependencies without an ADR. Validator source lives in
  `backend/validator/`, tests in `backend/test/validator/`.
- The validator must parse **exactly** what the plugin parses, so it must reuse the plugin's JSONC
  parser rather than ship a second copy (backlog F-007).
- FR-11 / ADR-0002: the plugin stays one file and its export surface must not change
  (`PLUGIN_ID`, `SUPPORTED_KILO_RANGE`, `__internals` with its 6 keys, `default`).
- The validator runs in CI on untrusted PR content. It must never echo secret values and must
  never resolve placeholders against the CI machine's environment or filesystem.

## Decision

### 1. Layout

```
backend/
  shared-config/kilo.jsonc            # example shared config (Appendix A + comments), the C1 /kilo.jsonc
  validator/
    validate-kilo-config.ts           # CLI entry: args, file I/O, output, exit code (runs main on load)
    kilo-config-rules.ts              # pure library: validateConfigText(), rules, path formatting
    kilo-schema-subset.json           # vendored Kilo config schema subset (data only)
  test/validator/*.test.ts            # unit tests (library) + child-process tests (CLI)
```

Two files instead of one so that tests and F-009 can import the rules without triggering the CLI's
top-level `main()` (Node 22.18 has no `import.meta.main`).

Run: `node backend/validator/validate-kilo-config.ts [--allowed-hosts h1,h2] <file>...`
(from any working directory; `backend/package.json` has `"type": "module"`).

### 2. Reusing the plugin's code without changing the plugin

The library imports the plugin module by relative path:

```ts
import { __internals, SUPPORTED_KILO_RANGE } from "../plugin/azdo-remote-config.ts";
```

- `__internals.parseJsonc` is the only parser. Its error messages already contain only fixed text
  and line/column numbers (ADR-0003), so they may be printed as-is.
- `__internals.resolvePlaceholders` is reused to decide whether a `{file:}` placeholder can ever
  resolve, with **injected fakes only**: `env: {}`, `homedir: () => PROBE_HOME` (a constant
  absolute path), `readFile: () => "probe"`. Any `file:` entry left in `unresolved` is a
  placeholder that never resolves on any machine (relative, bare `~`, `~user`, UNC / `//host`).
  No file is read and no environment variable is read, and the placeholder grammar is not copied.
- The plugin file is **not modified**. `__internals` keeps exactly its 6 keys; the existing
  smoke test that pins the export surface stays green. Importing the plugin has no side effects
  (it only defines functions and constants; all I/O happens in the `config` hook).
- No other plugin internals are needed: depth checking, the `apiKey` rule and the prototype-key
  list are simple enough to express in the validator, and their semantics are pinned to the
  plugin's by tests (same `toLowerCase() === "apikey"` rule, same three prototype keys, same
  64-level depth limit as `validateShared`).

When F-008 copies the validator into the C1 repo it must copy `validator/` **and**
`plugin/azdo-remote-config.ts` with the same relative layout (plus a `package.json` with
`"type": "module"`).

### 3. Secret scanning in values **and** comments

The parser blanks comments, so comment text is not visible in the parsed tree. Instead of a
second scanner, two independent checks run:
1. **Tree check**: every string value and every object key in the parsed tree is tested; a hit is
   reported at its JSON path.
2. **Text check**: the raw file text is split into lines (`\r\n`, `\n`, `\r`, matching the parser's
   line numbering) and every line that matches is reported as `line N`.

A secret inside a string value is therefore reported twice (path and line). That is accepted:
it is conservative, and the text check also covers comments, while the tree check also covers
JSON escape sequences such as `sk\u002dbf-...` that the text check cannot see.

Pattern: `/sk-bf-[a-z0-9]/i`, which is `sk-bf-` (any case) followed by at least one ASCII
letter or digit. This catches every real Bifrost virtual key. Placeholders such as `sk-bf-...` or
`sk-bf-<your-key>` do not match, which F-009's template relies on. The matched text is never
printed.

### 4. Vendored schema subset

`backend/validator/kilo-schema-subset.json` is a data-only file with the fields `kiloVersionRange`,
`source` and `rules`, where each rule is `{ path, type }`. It is a hand-picked **type-only** subset of
Kilo's config schema (`https://app.kilo.ai/config.json`, Kilo `>=7.2.0 <8.0.0`). It covers only the
keys this product writes or depends on. Path segments are separated by `.`, and `*` matches every
own key of a plain object. A rule applies only when its path exists. The check never reports
missing keys or unknown keys, because the subset must never reject a valid Kilo config.
`kiloVersionRange` must equal the plugin's `SUPPORTED_KILO_RANGE`. A test enforces this, so
raising the supported range forces someone to re-check the subset. The full upstream schema is
not vendored: it is large, changes often, and would need a JSON Schema engine (a dependency or a
lot of code).

### 5. Exit codes and output

- `0`: every file is valid (warnings allowed). `1`: at least one file has an error. `2`: a usage
  error, an I/O error on any file, or an internal error. `2` takes precedence over `1`. All files
  are still processed and reported.
- Line-oriented plain text, one finding per line:
  `<file>: <error|warning> <rule-id> at <location>: <fixed message>`. After each file comes a
  status line (`<file>: valid` / `<file>: invalid (...)`), and the run ends with a summary line.
  Findings go to stdout. Usage, I/O and internal errors go to stderr.
- Messages are fixed text per rule. Values are never printed, and nor are URLs or placeholder
  paths. A path segment whose key contains `sk-bf-` is shown as `[<redacted>]`. Control
  characters in file names and keys become `?`.
- No stack traces: `main()` catches everything and prints a fixed internal-error line.

Full rule table and grammar: `contracts/validator-cli.md`.

### 6. FR-11 lint extension

`tools/check-fr11.mjs` gets a fifth rule: every `.ts` file directly in `validator/` may import only
`node:` built-ins, `./<name>.ts` siblings, or exactly `../plugin/azdo-remote-config.ts`. It also
must not contain `require(`. This keeps the validator zero-dependency and stops it from growing a
second plugin copy. The rule is skipped when `validator/` does not exist, so existing fixtures keep
passing. ADR-0001 section 3 is amended accordingly.

### 7. Build / test wiring

- `backend/tsconfig.json` `include` gains `"validator/**/*.ts"`.
- Tests under `backend/test/validator/` are already covered by `node --test "test/**/*.test.ts"`,
  so `scripts/ci.sh` needs no change. `package.json` gets no new dependencies.

## Consequences

- One parser serves both the plugin and the gate. A file that passes the gate parses identically
  in the plugin.
- The validator depends on the plugin file's relative location. F-008 has to copy both files.
- The schema check is shallow on purpose (types of a few known keys). Deeper Kilo schema errors
  are still found only by Kilo at startup. This is acceptable because the plugin never crashes
  Kilo (FR-10).
- Platform note: `isAbsolute` is platform dependent. `{file:C:\x}` is reported as never resolving
  when the gate runs on Linux. This is correct for Linux and macOS engineers, so the warning
  stays.
- The CI gitleaks job scans test sources. Tests build fake `sk-bf-` values at runtime (string
  concatenation) and use low-entropy sentinels for `apiKey` values.

## Alternatives considered

- **Add helpers to `__internals`** (for example a comment-aware scanner): this would change the
  export surface, which AC8 forbids, and it ships validator-only code inside the plugin. Rejected.
- **A second JSONC scanner in the validator**: the two parsers could drift apart, and the backlog
  forbids it. Rejected. The validator only splits raw text into lines for the secret check, and
  splitting lines is not parsing.
- **Ajv plus the full upstream JSON Schema**: needs a runtime dependency and network or vendoring
  of a large, fast-moving file. Rejected.
- **A single CLI file with a "main only when run directly" check**: this needs
  `import.meta.main` (Node >= 24.2) or fragile `process.argv[1]` comparisons. Rejected in favour of
  the two-file split.
- **JSON output format**: not needed by F-008 (it uses the exit code) and harder to read in
  pipeline logs. It can be added later behind a flag.
