# Architect report — cycle 0009 — F-007: Shared config repo: example kilo.jsonc and validation script

## Inputs read
- `factory/runs/cycle-0009/01-product-owner.md`, F-007 / F-008 / F-009 in `factory/backlog.json`
- `factory/VISION.md` (FR-11..FR-15, AC-13, Appendix A / B)
- `docs/architecture/ADR-0001` .. `ADR-0009`, `overview.md`, `contracts/plugin-interface.md`
- `backend/plugin/azdo-remote-config.ts` (parser, `validateShared`, `__internals`), `backend/package.json`,
  `backend/tsconfig.json`, `backend/tools/check-fr11.mjs`, `backend/test/**`, `scripts/ci.sh`,
  `.github/workflows/ci.yml` (gitleaks job)

## Work done
- Designed the C1 deliverables. There are two of them: the example shared config at
  `backend/shared-config/kilo.jsonc`, and a zero-dependency validator. The validator is split into
  a CLI (`validate-kilo-config.ts`), a pure library (`kilo-config-rules.ts`) and a vendored
  schema subset (`kilo-schema-subset.json`).
- Plugin reuse without touching the plugin. The library does
  `import { __internals, SUPPORTED_KILO_RANGE } from "../plugin/azdo-remote-config.ts"`. It uses
  `parseJsonc` as the only parser. It also uses `resolvePlaceholders` with fakes (empty env,
  constant home, stub reader) to find `{file:}` placeholders that can never resolve, so the
  grammar is not copied and nothing is read. The plugin file is not changed, and `__internals`
  keeps its 6 keys.
- Comment secret scanning without a second parser. A tree check covers keys and string values and
  reports JSON paths. A raw-text line scan reports `line N` and covers comments. The secret
  pattern is `/sk-bf-[a-z0-9]/i`, so placeholders like `sk-bf-...` and `sk-bf-<your-key>` pass.
  F-009 depends on that.
- Defined exit codes (0 / 1 / 2, with 2 taking precedence), the line-oriented output format, the
  JSON path rendering (with redaction and control-character sanitising), 13 rule ids with fixed
  messages, the schema subset format and content (type-only, pinned to `SUPPORTED_KILO_RANGE` by a
  test), and the library API used by tests and F-009.
- Extended the FR-11 lint (rule 5). Validator `.ts` files may import only `node:`, `./x.ts`
  siblings, or `../plugin/azdo-remote-config.ts`.
- Wrote ADR-0010 and the contract `contracts/validator-cli.md`. Updated `overview.md` (C1 status,
  PR-gate data flow, layout, quality gate), `README.md` (contracts list) and ADR-0001 section 3
  (lint rule 5).

## Files changed
- `docs/architecture/ADR-0010-shared-config-validator.md` — new ADR (layout, plugin reuse, secret scan, schema subset, exit codes, lint).
- `docs/architecture/contracts/validator-cli.md` — new contract (CLI grammar, exit codes, output, locations, rules, schema subset, placeholder probe, library API, example config).
- `docs/architecture/overview.md` — C1 component status, PR-gate data flow, layout, quality gate.
- `docs/architecture/ADR-0001-tech-stack.md` — section 3, FR-11 lint rule 5.
- `docs/architecture/README.md` — lists the new contract.
- `factory/runs/cycle-0009/02-architect.md` — this report.

## Design summary
```
backend/shared-config/kilo.jsonc          Appendix A + comments, no apiKey / sk-bf- / plugin / placeholders
backend/validator/validate-kilo-config.ts CLI: args -> per file stat/read -> lib -> print -> exit 0|1|2
backend/validator/kilo-config-rules.ts    lib: validateConfigBytes/Text -> Finding[] (never throws)
backend/validator/kilo-schema-subset.json data: {kiloVersionRange, source, rules:[{path,type}]}
```
The rules and their order are in contract section 5. In short:
- **Errors:** file-too-large, invalid-encoding, invalid-jsonc, root-not-object, too-deep,
  prototype-key, api-key, secret-pattern (key / value / line), schema-type, base-url-host (only
  with `--allowed-hosts`).
- **Warnings:** prototype-member-name, file-placeholder-unresolvable, plugin-ignored.

---

## Backend tasks

All paths are relative to `backend/`. Follow ADR-0001 (erasable TS, `node:` prefix, `.ts` relative
imports), ADR-0010 and `docs/architecture/contracts/validator-cli.md` (normative). **Do not edit
`plugin/azdo-remote-config.ts`.**

### BE-1 Example shared config — AC1
- Create `shared-config/kilo.jsonc` as described in contract section 9:
  - VISION Appendix A content, with at least one `//` comment, one `/* */` comment and one
    trailing comma.
  - `baseURL` `https://bifrost.yourcompany.internal/v1`, with models `azure/gpt-5` and
    `azure/gpt-5-mini`.
  - No `apiKey`, no `sk-bf-` text anywhere (including comments), no `plugin`, no placeholders.
  - LF line endings.

### BE-2 Vendored schema subset — AC5
- Create `validator/kilo-schema-subset.json` with exactly the content in contract section 6.

### BE-3 Rules library `validator/kilo-config-rules.ts` — AC2, AC3, AC4 (parse and shape), AC5, AC6, AC7
- Implement the API in contract section 8 and every rule in section 5:
  - Locations follow section 4: identifier keys use `.key`, other keys use `["k"]`, keys containing
    `sk-bf-` use `[<redacted>]`, array indices use `[i]`, and the root is `(root)`.
  - Sanitise control characters and cut keys at 200 code units.
  - Messages are fixed text.
- Parse only through `__internals.parseJsonc`. Print its message only if it starts with
  `Invalid JSONC: `.
- Depth check: iterative (explicit stack), with a container at level >= 64 counting as too deep.
  On failure, skip the tree and schema rules. Use the descriptor `.value` for own keys, and never
  write to parsed objects.
- Secret pattern: `/sk-bf-[a-z0-9]/i`. Test keys and string values (tree check) **and** every raw
  line (text check, after decoding, with line breaks `\r\n`/`\n`/`\r`). The text check also runs
  after a parse failure.
- `{file:}` probe: exactly as in contract section 7. Pass `env: {}`, a constant `PROBE_HOME`, and
  `readFile: () => "probe"`.
- `base-url-host`: only when `allowedHosts` is given. Fires when the value is not a string, cannot
  be parsed as a URL, is not `https:`, has userinfo, or has a host that is not in the set.
- Schema evaluation: `*` wildcard over own keys of plain objects. A rule applies only when its
  path exists.
- `loadSchemaSubset()`: load once, validate the structure, and throw on an invalid file.
- `parseAllowedHosts()`: implement exactly the grammar in contract section 1.

### BE-4 CLI `validator/validate-kilo-config.ts` — AC1, AC4 (exit 2), AC7 (flag), AC8 (multi-file)
- Implement the argument grammar in contract section 1 (`--allowed-hosts`, `--allowed-hosts=`,
  `--`, `--help`/`-h`). Unknown options, no files, or an invalid host list give a usage error and
  exit 2.
- Per file, in order:
  1. `statSync`. A throw gives `io-error` with the code. A non-regular file gives `io-error`.
  2. If size > 1 MiB, report `file-too-large` without reading the file.
  3. Otherwise `readFileSync` (Buffer), then `validateConfigBytes`.
- Print as in contract section 3: findings, then the status line per file, then the summary line.
  The finding cap is 200, followed by a `note:` line. Findings go to stdout; io and usage errors
  go to stderr.
- Exit code is the maximum of: 2 if there was any usage, io or internal error; 1 if any file had
  errors; otherwise 0.
- Wrap the whole `main()` in try/catch. On a throw, print `validate-kilo-config: internal error`
  and exit 2. Never print a stack or `err.message`.
- `main()` runs at module top level. The CLI file exports nothing.

### BE-5 Build and lint wiring — AC8
- `tsconfig.json`: add `"validator/**/*.ts"` to `include`.
- `tools/check-fr11.mjs`: add rule 5 (ADR-0001 section 3, ADR-0010 section 6).
  - For every `*.ts` directly in `validator/` (skip if the directory is absent), every import or
    export-from specifier must be `node:*`, match `^\./[A-Za-z0-9._-]+\.ts$`, or be exactly
    `../plugin/azdo-remote-config.ts`.
  - The file must not contain `require(`.
  - Error messages name the file and the specifier.
- `package.json`: **no** new dependencies or devDependencies. `scripts/ci.sh` needs no change, since
  its `test/**/*.test.ts` glob already covers `test/validator/`.

### BE-6 Tests (all under `test/`, `node:test` + `node:assert/strict`, no network)
- **Fixtures:** write them to temp dirs (`mkdtempSync`) and clean up in `finally` / `after`.
  Gitleaks runs on the repo, so build the fake secret at runtime, for example
  `const FAKE = "sk-" + "bf-" + "AbCdEf" + "1234567890"`. Assert that output never contains
  `AbCdEf1234567890`. Use a low-entropy sentinel such as `VALUE_SENTINEL_42` for `apiKey` values.
- **Running the CLI:** use
  `spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" })`. Do not assert that
  stderr is empty (Node may print an ExperimentalWarning). Do assert there is no stack trace
  (`!/\n\s+at /.test(stdout + stderr)`).

| File | Must cover |
|---|---|
| `test/validator/example-config.test.ts` | **AC1:** the CLI on `shared-config/kilo.jsonc` exits 0, stdout matches `valid` with no warnings, and the same holds with `--allowed-hosts bifrost.yourcompany.internal`. `parseJsonc` of the file gives a string `provider.bifrost.options.baseURL`, `models` keys exactly `azure/gpt-5` and `azure/gpt-5-mini`, and a deep scan finds no key whose lowercase is `apikey`. **AC8:** the plugin's export surface is unchanged (`Object.keys(mod).sort()` and `Object.keys(__internals)` as in the plugin contract). |
| `test/validator/cli.test.ts` | **AC2:** `apiKey` at top level, at `provider.bifrost.options.apiKey`, inside an array element (`list[0].apiKey`) and as `APIKEY`. Each exits 1, names the path, and does not contain the sentinel. **AC3:** the fake secret as a nested value, inside a longer string, in an array, in a `//` comment and in a `/* */` comment. Each exits 1, names the path (or `line N` for comments), and never contains `AbCdEf1234567890`. **AC4:** an unterminated string, an unterminated block comment, malformed JSON, and roots of type array, string, number and `null`. Each exits 1, names the file and rule `invalid-jsonc` / `root-not-object`, and has no stack. No args gives exit 2 with a usage message. A missing path gives exit 2 with `io-error`. Also: an unknown option, `--allowed-hosts` without a value, and an invalid host each exit 2, and `--help` exits 0. **AC6:** `{file:rel/x}`, `{file:~}`, `{file:~user/x}`, `{file://host/share/x}` and `{file:\\\\host\\s}` give exit 0 and exactly one `file-placeholder-unresolvable` warning per placeholder, at its path. `{file:~/x}`, `{file:/abs/x}` and `{env:VAR}` give no warning. **AC7:** `__proto__`, `constructor` and `prototype` at depth give exit 1 naming the path. `hasOwnProperty` and `toString` give exit 0 with a warning at the path. With `--allowed-hosts bifrost.yourcompany.internal`, an `http:` URL, an unparseable value, another host, and userinfo each give exit 1 at `provider.<id>.options.baseURL`, while the allowed https host passes. The same files without the flag have no `base-url-host`. A top-level `plugin` gives a warning. **AC8:** one valid and one invalid file give exit 1, with a status line for each file plus the summary. A missing file next to an invalid one gives exit 2 with both files reported. |
| `test/validator/rules.test.ts` | Library unit tests: `formatLocation` (identifier keys, `["azure/gpt-5"]`, `[i]`, redaction, control characters, 200-code-unit cut). `validateConfigText` never throws, for example on `""`, a lone BOM, or 65 nested arrays (`too-deep`) versus 64 levels (allowed, the same boundary as the plugin). `Object.prototype` is unchanged after validating `{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}}}` (`({}).polluted === undefined`, and the `Object.prototype` own-names list is unchanged). A JSON-escaped secret (`sk-bf-...`) is caught by the tree check. `sk-bf-...` and `sk-bf-<your-key>` are not flagged. No finding's `message` or `location` contains any input value. `parseAllowedHosts` covers valid, empty, invalid, mixed-case and whitespace input. `validateConfigBytes` covers over-1-MiB input (`file-too-large`) and invalid UTF-8 (`invalid-encoding`). The secret text scan still runs after `invalid-jsonc`. |
| `test/validator/schema-subset.test.ts` | **AC5:** `validator/kilo-schema-subset.json` exists and `kiloVersionRange === SUPPORTED_KILO_RANGE` from the plugin. `loadSchemaSubset()` succeeds and every rule is well-formed. Violations, each exiting 1 (CLI) or giving `schema-type` (library) at the exact path: `provider: []`, `provider: "x"`, `provider.bifrost: 1`, `provider.bifrost.options: "x"`, `provider.bifrost.models: []`, `model: 5`. Unknown keys, and missing keys, give no error. |
| `test/tools/check-fr11.test.ts` (extend) | The real tree still passes. A fixture with `validator/x.ts` importing `lodash` fails. Importing `../plugin/other.ts` fails. Importing `../../x.ts` fails. `require(` in the validator fails. `./y.ts` and `node:fs` pass. A fixture without `validator/` passes (the existing cases stay unchanged). |

**Done when** `bash scripts/ci.sh` exits 0 (lint, typecheck, test).

## Frontend tasks

None. `scope.frontend` is false, and there is no frontend in this product (ADR-0001).

---

## Security notes (for the Security engineer)
- **Untrusted input.** The validator processes PR content in CI.
  - It never resolves placeholders against the real environment or filesystem (the probe uses
    fakes only).
  - It never executes anything, has no network access, and reads only the named files plus its
    own schema.
  - Size is capped at 1 MiB before reading. UTF-8 is strict. Depth is capped at 64 and checked
    iteratively.
- **No secret echo.**
  - Fixed messages only. No values, URLs or placeholder paths in output.
  - Keys that contain `sk-bf-` are redacted in paths.
  - Parser messages are value-free by contract (ADR-0003).
  - No stack traces or `err.message` from I/O. Only `err.code` is printed, and only if it matches
    `^[A-Z0-9_]+$`.
- **Output injection.** Control characters in file names and keys are replaced, so a crafted key
  cannot forge log lines or ANSI sequences in pipeline logs.
- **Prototype pollution.** The validator only reads parsed data, through own-descriptor values, and
  never writes to it. A test pins that `Object.prototype` is unchanged.
- **Gate strength.**
  - `apiKey` is matched case-insensitively, and the secret pattern is case-insensitive.
  - The comment scan is line-based over the raw text, so it is independent of the parser.
  - Known limit: a secret split across a JSON escape inside a comment (comments have no escapes,
    so this is not applicable) or encoded some other way (base64) is not detected. FR-13 only asks
    for the `sk-bf-` pattern.
- **Host allowlist.** It is opt-in. F-008 should pass `--allowed-hosts <company bifrost host>` in
  the pipeline. Userinfo in `baseURL` is rejected when the flag is set.
- **Supply chain.** No new dependencies. FR-11 lint rule 5 prevents npm imports in `validator/`.
  The plugin file is untouched, and its export surface is pinned by tests.

## Verification
- Design-only cycle phase; no product code changed.
- Checked that the existing smoke test pins the export surface (`azdo-remote-config.smoke.test.ts`
  lines 90 and 101), so the "unchanged surface" part of AC8 is already guarded.
- Checked that `scripts/ci.sh` runs `npm test` with the glob `test/**/*.test.ts`, which covers
  `test/validator/` with no change to ci.sh.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- **Example config at `backend/shared-config/kilo.jsonc`** — this is the PO's suggestion and keeps
  everything under `backend/`. F-008 copies it as the C1 repo's `/kilo.jsonc`.
- **Two validator source files (lib + CLI)** — tests and F-009 can then import the rules without
  running `main()`. `import.meta.main` is not available on Node 22.18.
- **Secret pattern `/sk-bf-[a-z0-9]/i`** — this catches real keys and lets obvious placeholders
  through, which F-009 AC4 needs.
- **Secrets in string values are reported twice (path and line)** — this is the price of not
  writing a second scanner. It is conservative and documented.
- **Schema subset is type-only, with no required or unknown-key checks** — a subset must never
  reject a valid Kilo config. The keys chosen are ones whose types are stable across OpenCode and
  Kilo 7.x.
- **Files over 1 MiB and invalid UTF-8 are validation errors (exit 1), not I/O errors** — they are
  properties of the content, and the plugin would refuse them too.
- **Too deep (>= 64) is an error** — the plugin's `validateShared` rejects such files, so they
  would never apply.
- **I/O errors (exit 2) take precedence over validation errors (exit 1)** — the gate must not report
  "only validation failed" when a file could not be checked at all.

## Follow-ups for the backlog
- **F-008:** copy `validator/`, `plugin/azdo-remote-config.ts` and a `package.json` with
  `"type": "module"` into the C1 repo with the same relative layout. Pass
  `--allowed-hosts <bifrost host>` in `azure-pipelines.yml`.
- **F-009:** use a template placeholder that does not match `/sk-bf-[a-z0-9]/i` (for example
  `sk-bf-<your-virtual-key>`). Check it with `validateConfigText(...)` filtered to
  `rule === "secret-pattern"`, because the template legitimately contains `apiKey`.
- **Docs writer:** add validator usage to `docs/development.md` / `docs/user-guide.md`.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0009/02-architect.md
summary: F-007 design — example shared kilo.jsonc + zero-dep validator (CLI + lib + vendored schema subset) reusing __internals.parseJsonc/resolvePlaceholders without touching the plugin; ADR-0010, contract validator-cli.md, 6 BE tasks
