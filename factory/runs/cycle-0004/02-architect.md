# Architect report — cycle 0004 — F-002: Plugin: {env:} and {file:} placeholder resolution

## Inputs read
- `factory/runs/cycle-0004/01-product-owner.md` (selected item, 8 ACs, assumptions)
- `factory/VISION.md` FR-5, FR-9, FR-10, FR-11, AC-8
- `docs/architecture/ADR-0001-tech-stack.md`, `ADR-0002-plugin-module-shape.md`, `ADR-0003-jsonc-parser.md`, `overview.md`, `contracts/plugin-interface.md`
- `backend/plugin/azdo-remote-config.ts`, `backend/tools/check-fr11.mjs`, `backend/package.json`, `backend/tsconfig.json`
- `backend/test/plugin/azdo-remote-config.smoke.test.ts`, `backend/test/plugin/jsonc.test.ts`
- `scripts/ci.sh`, `scripts/check-lf.sh`

## Work done

### Design summary
- **Seam.** `__internals.resolvePlaceholders(input: unknown, deps?: PlaceholderDeps): { value: unknown; unresolved: string[] }`. It is synchronous. `deps = { env?, homedir?: () => string, readFile?: (path) => string }`, with defaults `process.env` (read at call time), `os.homedir` (called lazily) and `p => readFileSync(p, "utf8")`. The helper types are module-local and **not exported**, so the only new export surface is the `resolvePlaceholders` key (AC-8). `__internals` becomes `{ parseJsonc, resolvePlaceholders }`, in that order.
- **FR-11 imports.** These are the first imports in the plugin. Each one is a `node:` built-in available in Bun and Node: `readFileSync` from `node:fs`, `homedir` from `node:os`, `isAbsolute` and `join` from `node:path`. That satisfies the check-fr11 rule "every specifier starts with `node:`". No `require(` and no dynamic import.
- **Grammar.** A placeholder matches `\{(env|file):([^{}\r\n]+)\}`. The name or path is used verbatim. Each string is scanned in a single left-to-right pass with a replace callback. Resolved values are **never re-scanned**, so injection from env into a file read is impossible, and `$` sequences in values are not interpreted.
- **env.** A name resolves only if it is an own property of `env` and its value is a non-empty string. The own-property check blocks `{env:constructor}` and `{env:__proto__}`.
- **file paths (conservative decision).** `~/x` or `~\x` becomes `join(homedir(), x)`. An absolute path is used as is. **Relative paths, bare `~` and `~user` are unresolved and the reader is never called.** The shared file is remote, so it has no meaningful base directory, and resolving against cwd would be unpredictable. The content is `trim()`med. A failure (throw, non-string result, or empty after trim) means unresolved.
- **Secret safety.** `homedir()` and `readFile()` run in `try {} catch {}` without binding the error. The error is discarded: never rethrown, never set as `cause`, never placed in the output. `unresolved` holds only `env:NAME` / `file:<path as written>`, de-duplicated in first-occurrence order.
- **Drop rules.** A string that is exactly one unresolved placeholder is dropped: an object key is omitted, an array element is removed, and a root string gives `value: undefined`. In any other string an unresolved placeholder becomes `""`.
- **Pollution-safe traversal.** The function always builds new arrays and new ordinary objects from `Object.keys(input)`. Every key is written with `Object.defineProperty` (enumerable, writable, configurable), so `__proto__`, `constructor` and `prototype` stay own data keys. The input is never mutated.
- **Depth cap.** A container at level 64 or deeper (the root is level 0) throws the fixed message `Placeholder resolution: config nested too deeply`. This also covers cyclic input. It is the only error the function may throw.
- **Not wired.** The `config` hook stays a no-op. F-006 will call the resolver, log the `unresolved` names and catch everything.

## Backend tasks

All work is in `backend/`. Follow ADR-0001 (erasable TS, `node:test`) and the files are LF-only. **Plugin-file constraints from cycle 0003:** the check-fr11 comment stripper uses a regex, so plugin code, string literals and regex literals must never contain the two-character sequences slash-star or star-slash. Do not use JSDoc block comments that open with slash-star-star; use `//` line comments for new code (the existing `/** ... */` comments may stay). Do not add raw invisible characters; write them as `\u` escapes.

### BE-1. Implement `resolvePlaceholders` in `backend/plugin/azdo-remote-config.ts` (AC-1 to AC-7)
- Add at the top of the file, after the header comment:
  `import { readFileSync } from "node:fs";`, `import { homedir } from "node:os";`, `import { isAbsolute, join } from "node:path";`
- Add a "placeholder resolver" section after the JSONC parser that follows contract section 2b and ADR-0004 exactly:
  - module-local `interface PlaceholderDeps` and `interface PlaceholderResult` (not exported);
  - module-local constants: a global regex `/\{(env|file):([^{}\r\n]+)\}/g` used only with `String.prototype.replace` and a callback, a separate **non-global** anchored regex `/^\{(env|file):([^{}\r\n]+)\}$/` for the "whole string is one placeholder" test, and `MAX_PLACEHOLDER_DEPTH = 64`;
  - `function resolvePlaceholders(input: unknown, deps: PlaceholderDeps = {}): PlaceholderResult`. Resolve the defaults once per call. Keep a `Set<string>` or an ordered array for `unresolved`, de-duplicated. Use a recursive walker with a `depth` argument that returns either a value or a module-local `DROP` sentinel (for example a `const DROP: unique symbol = Symbol("drop")`, or a boolean flag; it must not be exported). Drop applies only when the whole string matches the anchored regex **and** that placeholder is unresolved.
  - env lookup: `Object.prototype.hasOwnProperty.call(env, name)` and `typeof v === "string" && v !== ""`.
  - file lookup: if the path starts with `~/` or `~\`, use `join(home(), path.slice(2))`; else if `isAbsolute(path)`, use `path`; else unresolved **without calling the reader**. `try { const c = readFile(target); if (typeof c === "string" && c.trim() !== "") return c.trim(); } catch {}` -> unresolved. The `catch` must have no binding.
  - containers: `Array.isArray` -> new array (skip DROP elements). Other `typeof === "object" && !== null` -> `{}` populated via `Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })` over `Object.keys(obj)`, skipping DROP. If a container is reached at `depth >= 64`, throw `new Error("Placeholder resolution: config nested too deeply")`.
  - root DROP -> `value: undefined`.
- Change `export const __internals = { parseJsonc };` to `export const __internals = { parseJsonc, resolvePlaceholders };`.
- Do **not** change the `config` hook, the default export or other exports. No logging.
- Update the header comment line "T-001 stub: no I/O, no logging." so it is accurate (e.g. "config hook is still a no-op; helpers only").

### BE-2. Tests: new `backend/test/plugin/placeholders.test.ts` (AC-1 to AC-7)
Use `node:test` and `node:assert/strict`, with injected fakes. Use a `CANARY = "SECRET-CANARY-42"` string for leak checks. Name each test with the AC it covers. Required cases:
1. AC-1: `{x:"{env:SET_VAR}"}` with `env:{SET_VAR:"abc"}` -> `value` deepEqual `{x:"abc"}`, `unresolved` deepEqual `[]`.
2. AC-2: `{x:"{env:MISSING}", y:1}`, `env:{}` -> `"x" in value === false`, `value.y === 1`, `unresolved` deepEqual `["env:MISSING"]`. Also check that an env var with value `""` and an inherited name (`{env:constructor}`, `{env:toString}`) are unresolved.
3. AC-3: `pre-{env:MISSING}-post` -> `pre--post`, and `unresolved` contains `env:MISSING`.
4. AC-4: `{x:"{file:~/secret.txt}"}` with `homedir: () => FAKE_HOME` and a spy `readFile` that records its path and returns `"  s3cret\n"` -> `x === "s3cret"`, and the recorded path equals `join(FAKE_HOME, "secret.txt")` (import `join` from `node:path` in the test). Add a second case with `~\secret.txt`. Add an absolute-path case that uses a real temp file and the **default** reader (`mkdtempSync(join(tmpdir(), ...))`, `writeFileSync`).
5. AC-5, cover each of these:
   - (a) missing absolute path with the default reader;
   - (b) a directory (the temp dir itself) with the default reader;
   - (c) a fake reader that throws `new Error(CANARY)` where CANARY is the "file contents";
   - (d) a fake `homedir` that throws `new Error(CANARY)`;
   - (e) a reader that returns a non-string or whitespace only;
   - (f) a relative path `{file:secret.txt}`: the reader spy is **never called** and the result is unresolved.
   In each case the key is dropped and `unresolved` contains `file:<path as written>`. For (c) and (d), assert that the call does not throw and that `JSON.stringify(result)` does not include CANARY.
6. AC-6: `{a:{b:["{env:SET_VAR}","{env:MISSING}","keep"]}}` -> `{a:{b:["abc","keep"]}}`. Numbers, booleans, `null`, nested empty `{}`/`[]` and strings without placeholders are unchanged. Literal non-placeholders (`{env:}`, `{foo:x}`, `{env:X`) are unchanged. A root string that is only an unresolved placeholder gives `value === undefined`.
7. AC-7:
   - (a) Non-mutation: deep-clone the input with `structuredClone` before the call and assert `deepEqual` afterwards.
   - (b) `JSON.parse('{"__proto__":{"polluted":"{env:SET_VAR}"},"constructor":{"prototype":{"p2":1}},"prototype":"{env:SET_VAR}"}')` -> `({} as any).polluted === undefined`, `Object.prototype.hasOwnProperty.call(value, "__proto__")` is true, `Object.getPrototypeOf(value) === Object.prototype`, `value.__proto__` read via `Object.getOwnPropertyDescriptor` has `polluted: "abc"`, and `({} as any).p2 === undefined`.
   - (c) `{env:A}/{env:B}` with both set -> `"a/b"`.
   - (d) No re-expansion: env `A="{env:B}"` resolves to the literal `"{env:B}"`, and env `A="{file:~/x}"` never calls the reader. An env value containing `$&` is copied literally.
   - (e) `unresolved` is de-duplicated and in order.
8. Depth cap: 64 nested arrays resolve, 65 throw an `Error` whose message equals `Placeholder resolution: config nested too deeply` exactly.

### BE-3. Update `backend/test/plugin/azdo-remote-config.smoke.test.ts` (AC-8)
- Change the `Object.keys(mod.__internals)` assertion to deepEqual `["parseJsonc", "resolvePlaceholders"]`, and assert `typeof __internals.resolvePlaceholders === "function"`.
- Add: the sorted runtime named exports `Object.keys(mod)` deepEqual `["PLUGIN_ID", "SUPPORTED_KILO_RANGE", "__internals", "default"]` (sort both sides).
- Keep all existing assertions. The config hook is still a no-op that never logs.

### BE-4. Gate (AC-8)
- `bash scripts/ci.sh` exits 0: `npm run lint` (check-fr11 PASS with the new `node:` imports), `npm run typecheck`, `npm test`.
- `backend/package.json`: no `dependencies` and no new devDependencies.
- Search the plugin file and confirm it contains neither two-character sequence (slash-star / star-slash) in new code, and has no CR bytes.

## Frontend tasks
- None. `scope.frontend` is false; there is no frontend in this product (ADR-0001).

## Security notes (for the Security engineer)
- **Secret exposure:** resolved values (API keys, file contents) exist only in `result.value`. Verify that no `catch` binds or forwards the error, that no `cause` is set, that `unresolved` holds only names and paths as written, and that there is no logging.
- **Trust boundary:** the shared config can read any env var and any `~/` or absolute file the user can read, and inject it into Kilo config. This is the intended behaviour of FR-5 and relies on the PR-gated shared repo (C1). It is accepted for this item. A possible follow-up is an optional allowlist or a `~/`-only mode (see follow-ups).
- **Injection:** single pass and no re-scan of resolved values (env -> file chaining impossible). Replace callback (no `$` interpretation). Relative paths are never read.
- **Prototype pollution:** own-property env lookup, `defineProperty` output, `Object.keys` iteration, and no writes to the input.
- **DoS:** depth cap 64 with a fixed message. There is no file size cap. A malicious path such as `/dev/zero` could make `readFileSync` hang or grow without bound. This is accepted given the trusted source and is noted as a follow-up.

## Files changed
- `docs/architecture/ADR-0004-placeholder-resolution.md`: new ADR covering signature, sync design, `node:` imports, grammar, relative-path decision, secret safety, drop rules, pollution safety and depth cap.
- `docs/architecture/contracts/plugin-interface.md`: version 0.3.0. Adds section 2b `resolvePlaceholders`, the `__internals` key list and order, the exact runtime named-export list, non-exported helper types and the allowed `node:` imports. Normalised to LF.
- `docs/architecture/overview.md`: C2 status, data flow (unresolved names logged), internal structure (imports, resolver deps). Normalised to LF.

## Verification
- Read check-fr11.mjs: the import regex accepts `import { a, b } from "node:x"`. The planned regex literals contain no slash-star or star-slash sequences.
- Checked that the contract file has no CR bytes after the edit (python byte count 0).
- No product code was changed, so `scripts/ci.sh` is unaffected by this phase.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | docs/architecture/*.md | The working tree had CRLF files (core.autocrlf=true). The edited docs are now LF. Git normalises on commit, so there is no content impact | none |

## Assumptions made (no human available)
- Relative `{file:}` paths are unresolved and never read. The remote config has no base directory, and this is the conservative choice.
- An empty env value or an empty (after trim) file counts as unresolved. This is consistent across Windows and POSIX and avoids setting empty keys.
- Both `~/` and `~\` are expanded on every OS. Bare `~` and `~user` are not expanded.
- Synchronous resolver. Startup reads are tiny, and the sync design keeps the helper simple and testable.
- Depth cap of 64 with a fixed error. Real Kilo configs are fewer than 10 levels deep.
- Helper types are not exported, so AC-8 ("only new export surface") holds strictly.

## Follow-ups for the backlog
- Optional `{file:}` hardening: a size cap or a `~/`-only allowlist option (security, low).
- C1 validator / docs: warn config authors that relative `{file:}` paths never resolve (docs, low).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0004/02-architect.md
summary: F-002 design: sync __internals.resolvePlaceholders with injectable env/homedir/readFile, node: imports, relative file paths unresolved, secret-safe and pollution-safe; ADR-0004 + contract 0.3.0; 4 backend tasks
