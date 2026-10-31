# ADR-0001: Tech stack
- Status: accepted
- Date: 2026-10-30
- Cycle / item: cycle-0002 / T-001

## Context

The product (see `factory/VISION.md`) has no UI and no server of its own. It consists of:

- **C2** a Kilo plugin (`azdo-remote-config.ts`) that Kilo loads at startup, fetches a shared
  `kilo.jsonc` from Azure DevOps and merges it into Kilo's resolved config via the `config` hook;
- **C1** validation tooling for the shared config repo (PR gate);
- **C3** a personal config template;
- **C5** bootstrap installers (`install.ps1`, `install.sh`);
- **C6** a key-provisioning script for Bifrost virtual keys.

Constraints:

- **FR-11**: the shipped plugin is a single TypeScript file with zero npm dependencies.
- Kilo (CLI and VS Code extension) is a fork of OpenCode and loads local `.ts` plugins with
  **Bun**; the plugin must therefore run unmodified on Bun.
- The factory's quality gate runs on Linux CI (GitHub Actions, Node 22) and on Windows dev
  machines (Git Bash, Node 24).
- External systems (Azure DevOps, `az`, Bifrost, Kilo) are never called for real in tests.

## Decision

### 1. Language / runtime

| Concern | Choice |
|---|---|
| Language | **TypeScript** (strict), ES2022, ES modules (`"type": "module"`) |
| Plugin runtime (production) | **Bun as embedded in Kilo** (Kilo transpiles and loads the `.ts` file itself) |
| Dev / test runtime | **Node.js >= 22.18** (native TypeScript type stripping, no flag, no transpiler) |
| Allowed TypeScript syntax | **Erasable syntax only** (`erasableSyntaxOnly: true`): no `enum`, no `namespace`, no constructor parameter properties, no decorators. Required so Node can strip types and the same file runs on Bun and Node unchanged. |
| Imports inside source files | Relative imports use the explicit `.ts` extension (`allowImportingTsExtensions`). Built-in modules always use the `node:` prefix (`node:fs/promises`, `node:os`, `node:path`, `node:child_process`). |
| Platform APIs in the plugin | Global `fetch`, `AbortController`, `URL` and `node:` built-ins only - all available in both Bun and Node. |

Kilo's own plugin types (`@kilocode/plugin`) are **not** imported, not even type-only: the plugin
file declares the minimal structural types it needs (see `contracts/plugin-interface.md`).
This keeps the file self-contained (FR-11) and type-checkable without a Kilo dependency.

### 2. Test runner

- **`node:test` + `node:assert/strict`** (built into Node; no test-framework dependency).
- Tests are `.ts` files under `backend/test/**`, named `*.test.ts`, run with
  `node --test "test/**/*.test.ts"`.
- Fakes, not network: tests inject a fake Kilo context (`client.app.log` spy), fake `fetch`,
  fake home/cache directories (temp dirs) and fake `az` runners. No test may reach the network.

### 3. Type-checking and lint

- **Type-check**: `tsc --noEmit` with `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`,
  `verbatimModuleSyntax`, `allowImportingTsExtensions`, `module`/`moduleResolution` `NodeNext`.
- **Lint**: no ESLint (keeps the dev toolchain to two packages). Instead
  `backend/tools/check-fr11.mjs` (plain Node, zero deps) enforces the FR-11 guard rails:
  1. `backend/package.json` has no `dependencies` field or an empty one;
  2. `backend/plugin/` contains exactly one file, `azdo-remote-config.ts`;
  3. every `import`/`export ... from` specifier in that file starts with `node:`
     (no bare npm packages, no relative imports - the plugin must be a single file);
  4. the file does not contain `require(`.
  5. (since F-007, ADR-0010) every `.ts` file directly in `validator/` imports only `node:`
     built-ins, `./<name>.ts` siblings or exactly `../plugin/azdo-remote-config.ts`, and does
     not contain `require(` (skipped when `validator/` does not exist).
  6. (since F-010, ADR-0012) the same allow-list and `require(` ban for every `.ts` file directly
     in `installer/` (skipped when `installer/` does not exist). `.sh` files are not checked by
     this tool; `install.sh` must use only bash builtins plus `node` and `az` (ADR-0012).
  It exits non-zero with a clear message on any violation.
- `tsconfig.json` `include` covers `plugin/**/*.ts`, `validator/**/*.ts`, `installer/**/*.ts`
  (since F-010) and `test/**/*.ts`.

### 4. Dev dependencies (the only npm packages allowed in `backend/`)

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `~5.9.3` | `tsc --noEmit` type-check |
| `@types/node` | `^22.18.0` | Node built-in typings for type-check |

`dependencies` must stay absent. Adding any further dev dependency requires a new ADR.
`backend/package-lock.json` is committed so CI uses `npm ci`.

### 5. Supported Kilo version range

| Item | Value |
|---|---|
| Supported Kilo CLI / VS Code extension range | **`>=7.2.0 <8.0.0`** |
| Plugin module shape relied upon | v1 module: `export default { id, server }`, `server(input, options) => Promise<Hooks>` (see ADR-0002) |
| Hook relied upon | `config(cfg)` - called once at startup with the fully resolved config, awaited, errors logged and ignored by Kilo |
| Plugin options | Second argument of `server`, taken from the tuple form `["./azdo/azdo-remote-config.ts", { ... }]` in the global `plugin` array |
| Logging API | `input.client.app.log({ body: { service, level, message, extra } })` |

The range is recorded in the plugin file as `export const SUPPORTED_KILO_RANGE = ">=7.2.0 <8.0.0"`
(a string constant; Kilo's loader ignores non-function named exports). Upgrading past `8.0.0`
requires re-running the Phase 0 checks (vision assumptions A1-A2) and a new ADR.

### 6. Zero-runtime-dependency single-file plugin constraint (FR-11)

- The shipped artefact is exactly **one file**: `backend/plugin/azdo-remote-config.ts`.
  The installer (C5) copies that file verbatim to `~/.config/kilo/azdo/azdo-remote-config.ts`.
- It imports nothing but `node:` built-ins; it has no relative imports and no npm imports.
- `backend/package.json` has **no `dependencies`**; only the dev dependencies listed above.
- All plugin logic (settings, JSONC parser, placeholders, merge, fetch/auth, cache, logging)
  lives in that one file. Pure helpers are exposed to tests only through the single named
  constant `__internals` (an object, never a function), per ADR-0002.
- Enforced automatically by `npm run lint` (`tools/check-fr11.mjs`) in every CI run.
- Other components (validator, installers, provisioning) are **not** bound by the single-file
  rule but are bound by the zero-runtime-dependency rule (Node built-ins / PowerShell / POSIX sh).

### 7. Layout under `backend/`

```
backend/
  package.json            # private, type: module, engines.node >=22.18, NO dependencies
  package-lock.json       # committed
  tsconfig.json           # noEmit, strict, erasableSyntaxOnly, NodeNext
  plugin/
    azdo-remote-config.ts # C2 - THE single shipped plugin file (FR-11)
  validator/              # C1 PR-gate tooling (later items: F-0xx validator)
  templates/              # C3 personal config template (later items)
  installer/              # C5 install.sh + install-helper.ts + personal-config-edit.ts (F-010, ADR-0012); install.ps1 (F-011)
  provisioning/           # C6 Bifrost key provisioning (later items)
  tools/
    check-fr11.mjs        # lint: FR-11 guard rails
  test/
    plugin/               # tests for C2 (*.test.ts)
    validator/ ...        # one test folder per component, mirroring the source tree
```

Only `plugin/`, `tools/` and `test/plugin/` are created in T-001; the other folders are created
by the items that need them.

### 8. Commands (per package)

All commands run from `backend/`. `frontend/` does not exist and is not planned (no UI).

| Step | Command | npm script |
|---|---|---|
| Install | `npm ci` (falls back to `npm install` only when no lock file exists) | - |
| Lint | `node tools/check-fr11.mjs` | `npm run lint` |
| Type-check | `tsc --noEmit -p tsconfig.json` | `npm run typecheck` |
| Test | `node --test "test/**/*.test.ts"` | `npm test` |
| Build | none - the plugin ships as source; no `build` script is defined | - |

`scripts/ci.sh` already runs `lint`, `typecheck`, `test`, `build` via `npm run --if-present`,
so these scripts plug in without changes to its Node path.

## Consequences

- No transpile/bundle step: the file under test is byte-for-byte the file that ships.
- Node >= 22.18 is required locally and in CI (GitHub Actions `node-version: 22` resolves to the
  latest 22.x, which satisfies this).
- Erasable-only TypeScript slightly restricts style (no enums) - use string-literal unions.
- No ESLint means style issues are caught only by `tsc` strictness and review; acceptable for
  a single-file product, revisit if the codebase grows.
- Kilo API drift is the main risk; mitigated by pinning the range and the Phase 0 checks.

## Alternatives considered

- **Vitest / Jest**: richer, but adds large dev-dependency trees and a transform pipeline that
  hides Bun/Node differences. Rejected: `node:test` is sufficient.
- **Bun as the test runtime**: matches production exactly, but Bun is not installed on CI
  runners or dev machines by default and is a less mainstream CI dependency. Rejected for the
  gate; the plugin is restricted to APIs common to Bun and Node instead.
- **`tsx` / `ts-node`**: unnecessary since Node 22.18 strips types natively.
- **Python for tooling**: would split the stack; the validator can reuse the plugin's JSONC
  parser only if it is TypeScript too.
- **Importing `@kilocode/plugin` types**: would add a dependency (even if dev-only) coupled to a
  fast-moving upstream; structural local types are enough.
