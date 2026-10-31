# Development

## Stack
TypeScript (strict, erasable syntax only), ES modules. Tests use `node:test`. No ESLint, no bundler,
no build step: the plugin ships as source. Decisions: `docs/architecture/ADR-0001-tech-stack.md`.

Requirements: Node.js >= 22.18 (runs `.ts` files natively). Only `backend/` exists; there is no frontend.

## Commands (run from `backend/`)

| Step | Command |
|------|---------|
| Install | `npm ci` |
| Lint (FR-11 check) | `npm run lint` |
| Type-check | `npm run typecheck` |
| Test | `npm test` |

Full gate from the repo root: `bash scripts/ci.sh` (runs the above, then validates factory JSON
metadata). It is also what GitHub Actions runs (`.github/workflows/ci.yml`).

## FR-11 constraints
- The shipped plugin is exactly one file, `backend/plugin/azdo-remote-config.ts`.
- It imports only `node:` built-ins: no npm packages, no relative imports, no `require(`.
- `backend/package.json` has no `dependencies`. Only dev dependencies `typescript` and `@types/node`
  are allowed; adding more needs a new ADR.
- `npm run lint` (`backend/tools/check-fr11.mjs`) enforces these and exits non-zero on violation.
- Use erasable TypeScript only: no `enum`, `namespace`, constructor parameter properties or decorators.
- Relative imports in non-plugin sources use the `.ts` extension.

## Tests
Files: `backend/test/**/*.test.ts`. Parser tests live in `backend/test/plugin/jsonc.test.ts` and reach `parseJsonc` through `__internals`. Placeholder tests live in `backend/test/plugin/placeholders.test.ts` and inject `env`, `homedir` and `readFile` fakes; only the default-reader cases touch the real filesystem (temp files). Merge tests live in `backend/test/plugin/merge.test.ts` and call `__internals.mergeConfig` with plain objects. Settings tests live in `backend/test/plugin/settings.test.ts` and inject `env` through `deps`; they never read the real environment. Fetch tests live in `backend/test/plugin/fetch.test.ts` and inject `fetch`, `env`, `runAz` and timer fakes. Hook tests (cache, fallback, logging, never-crash) live in `backend/test/plugin/hook.test.ts` and inject `fs`, `homedir`, `fetch`, `env` and a fake `client.app.log` through `runConfigHook`'s `deps`; they never touch the real home directory or the network. Tests must not touch the network or real Azure DevOps, `az`,
Bifrost or Kilo; use fakes.

At runtime the plugin writes only `~/.cache/kilo-azdo/remote-config.json` (see [API](api.md)); tests must always inject `homedir` and `fs`.

The plugin now imports `node:fs`, `node:os`, `node:path` and `node:child_process` (the last only to run `az` for the Entra-token fallback; allowed by FR-11; still `node:` only).

## Validator tests and lint rule 5
The validator (`backend/validator/`, contract `docs/architecture/contracts/validator-cli.md`, ADR-0010)
is tested by `backend/test/validator/` (`rules.test.ts`, `cli.test.ts`, `schema-subset.test.ts`,
`example-config.test.ts`, shared `helpers.ts`). They run with `npm test`; to run only these:

```bash
cd backend
node --test "test/validator/*.test.ts"
```

The CLI tests run the real CLI against temp files. `kiloVersionRange` in
`kilo-schema-subset.json` must equal the plugin's `SUPPORTED_KILO_RANGE` (a test enforces it).
`npm run lint` has a fifth rule: files in `backend/validator/` may import only `node:` built-ins,
sibling `.ts` files or the plugin file. The validator reuses the plugin's `parseJsonc` and
`resolvePlaceholders` through `__internals`. Usage and rules: [user guide](user-guide.md).

## Personal config template tests
The template `backend/personal-config/kilo.jsonc` (contract
`docs/architecture/contracts/personal-config-template.md`, ADR-0011) is tested by
`backend/test/personal-config/template.test.ts`. It runs with `npm test`; to run only it:

```bash
cd backend
node --test "test/personal-config/*.test.ts"
```

The tests parse the file with the plugin's `parseJsonc`, check the plugin options with
`resolveSettings`, check the placeholder against the validator's secret pattern, and merge it with
`backend/shared-config/kilo.jsonc` to confirm the local `apiKey` survives in both modes. They accept
both LF and CRLF line endings. `.gitattributes` has `*.jsonc text eol=lf`, so `.jsonc` files are LF in
the repository. `backend/installer/install.sh` (F-010) copies this file to `~/.config/kilo/kilo.jsonc`; the Windows installer (F-011) is not built yet.

## Installer tests and lint rule 6
The macOS/Linux installer (`backend/installer/`: `install.sh`, `install-helper.ts`,
`personal-config-edit.ts`; contract `docs/architecture/contracts/installer-cli.md`, ADR-0012) is tested
by `backend/test/installer/` (`install-sh.test.ts`, `personal-config-edit.test.ts`, shared
`helpers.ts`). They run with `npm test`; to run only these:

```bash
cd backend
node --test "test/installer/*.test.ts"
```

The script tests run the real `install.sh` with `bash` against a temporary config directory, so they
do not touch your real config. Tests that check POSIX file modes or symlinks skip themselves on
Windows (`process.platform === "win32"`); the rest run under Git Bash.
`npm run lint` has a sixth rule: files in `backend/installer/` may import only `node:` built-ins,
sibling `.ts` files or the plugin file.

## Layout
```
backend/plugin/azdo-remote-config.ts   the plugin
backend/validator/                     shared-config validator (CLI, rules library, schema subset)
backend/shared-config/kilo.jsonc       example shared config
backend/personal-config/kilo.jsonc     personal config template (copied to ~/.config/kilo/)
backend/installer/                     macOS/Linux bootstrap installer (install.sh + Node helper)
backend/tools/check-fr11.mjs           lint
backend/test/                          tests
```
Further folders (templates, Windows installer, provisioning) arrive with later items.
