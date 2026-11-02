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

## Plugin source layout
Decision record: `docs/architecture/ADR-0021-plugin-source-layout-and-hot-path-jsdoc.md`. The plugin stays
ONE file (FR-11); it is organised inside by 15 numbered sections. The header holds a table of contents
(`//   N. Title`, three spaces) and each section starts with a banner `// ==== N. Title ====` set off by blank lines.
Search for `// ==== ` to jump between sections. Sections in order:

1. Imports, public types and plugin identity
2. Shared guards and helpers
3. JSONC parser
4. Placeholder resolver
5. Config merge
6. Settings resolution
7. Fetch foundations: types, target, URL and deadline
8. Authentication: PAT and az CLI
9. Response handling and failure classification
10. Fetch pipeline: `fetchRemoteConfig`
11. Shared config validation
12. Config cache bound to settings
13. Logging, fixed messages and hints
14. Config hook: `runConfigHook`
15. Exports: `__internals`, server and default export (always the last statement)

Adding a function: put it in the section it belongs to. Top-level `const` initialisers that read another
top-level `const` must come after it (function declarations are hoisted). Adding or renaming a section means updating the
TOC, the banner and `backend/test/plugin/source-layout.test.ts` together.

Hot paths (code that runs on every Kilo start or every credential-bearing request; the fixed list of 35 names is in the layout test)
need a `/** ... */` JSDoc block directly above the declaration, with, in order:
- one purpose sentence ending in `.`;
- `@param name - prose` and `@returns prose` (no `{Type}`);
- `Codes:` and/or `Logs:` naming the error codes or `LOG_*` constants it can produce, where applicable;
- an `Invariants:` line (for example never throws, no secret or URL in logs);
- at least one `@see` to an ADR or contract that exists (`@see ADR-NNNN section N` or `@see contracts/<file>.md section <id>`).

JSDoc rules: the body must not contain `/*` or `*/` (`tools/check-fr11.mjs` strips block comments naively; avoid glob-like text), the block
sits on its own lines, ASCII only, and no secret-like examples (write `sk-bf-<...>`, `Basic <base64>`, `https://dev.azure.com/<org>/...`).

Checks:
- `backend/test/plugin/source-layout.test.ts` (part of `npm test`) enforces the TOC and banner formats and numbering, JSDoc on every hot path,
  the comment-safety rule, ASCII, existing `@see` targets, a secret-like scan, and a fresh-process import with the same exports and `__internals` keys.
- `node backend/tools/compare-plugin-shape.mjs --base-ref <git ref>` is a manual, dev-only tool (not in `scripts/ci.sh`).
  It proves a refactor is move-and-comment only: it ignores comments and order, then compares declarations, exports, `__internals` keys and
  top-level statements against the file at that ref. Use it for any pure refactor of the plugin (for example `--base-ref HEAD`).
  Exit 0 is PASS, 1 a difference, 2 a usage error. It prints SKIP (exit 0) when git or history is unavailable. Its own tests are
  `backend/test/tools/compare-plugin-shape.test.ts`.

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
the repository. `backend/installer/install.sh` (F-010) copies this file to `~/.config/kilo/kilo.jsonc`; `backend/installer/install.ps1` (F-011) does the same on Windows.

## Installer tests and lint rule 6
The macOS/Linux installer (`backend/installer/`: `install.sh`, `install-helper.ts`,
`personal-config-edit.ts`; contract `docs/architecture/contracts/installer-cli.md`, ADR-0012) is tested
by `backend/test/installer/` (`install-sh.test.ts`, `personal-config-edit.test.ts`, `smoke.test.ts`,
`install-smoke.test.ts`, shared `helpers.ts`). They run with `npm test`; to run only these:

```bash
cd backend
node --test "test/installer/*.test.ts"
```

The script tests run the real `install.sh` with `bash` against a temporary config directory, so they
do not touch your real config. Tests that check POSIX file modes or symlinks skip themselves on
Windows (`process.platform === "win32"`); the rest run under Git Bash.
T-019 (installer hardening, contract 1.2.1, ADR-0012) added `fs-guard.test.ts` (unit tests of
`backend/installer/fs-guard.ts`, the symlink/target-type check with an injectable `lstat`) and the race
fixture `test/installer/fixtures/race-after-mkdir.ts`, which swaps a target for a symlink right after the
folders are created. Five symlink/race tests are POSIX-only: on Windows they skip with a message, so they
must be confirmed on Linux CI. Also covered: CDPATH-safe script directory, and exit 3 with the
"installer sources are missing" message when `install-helper.ts` is absent.
`npm run lint` has a sixth rule: files in `backend/installer/` may import only `node:` built-ins,
sibling `.ts` files or the plugin file.

The smoke test (F-019, `backend/installer/smoke.ts`, ADR-0013, contract section 9) is tested without real
network. `backend/test/installer/fixtures/fake-network.ts` is a test-only Node preload (`--import`) that
replaces `globalThis.fetch` with a deterministic fake. It reads a JSON scenario file named by
`KILO_TEST_FAKE_NET` (answers for `azdo` and `bifrost`, plus an optional request `log`); without a
scenario it denies every call. `smoke.test.ts` covers the smoke module; `install-smoke.test.ts` runs
`install.sh` end to end (exit codes, output lines, no leaks, installation unchanged on failure). The
other installer tests pass `--no-smoke`.
ADR-0022 (contract installer-cli.md 1.4.0, T-038): the Bifrost smoke request takes its base URL from
`provider.bifrost.options.baseURL`, else `provider.azurefoundry.options.baseURL`, and authenticates with
`x-bf-vk: <key>` instead of `Authorization: Bearer`. The fake network and the e2e fake Bifrost therefore check
the `x-bf-vk` header (the e2e fake-network scenario gains an optional lower-case `header` name, see
contract e2e-harness.md 1.1.1). Tests use placeholder keys only.
F-020 (ADR-0019, contract installer-cli.md 1.3.0 section 9.0) adds the network pre-flight to `smoke.ts`. The
fake network scenario also answers the anonymous probes of `https://dev.azure.com/` and the Bifrost
origin `/` (403/407, connection error, hang until the deadline). `smoke.test.ts` and
`install-smoke.test.ts` cover the `smoke network:` line, the `skipped network-blocked` rows, the hint
line, exit 4 and that no credential is sent to a blocked target.
F-021 (ADR-0020, contract plugin-interface.md 0.9.0 sections 2e and 2f-L) classifies plugin fetch failures.
New test blocks: `backend/test/plugin/fetch.test.ts` (F-021 AC-1 to AC-3: `network-unreachable`, `timeout`,
`network-blocked`, JSON 403 and 401, `network` catch-all), `backend/test/plugin/hook.test.ts` (F-021 AC4 to AC6:
hint lines and their order with and without a cache, no leaks), `smoke.test.ts` and `install-smoke.test.ts`
(authenticated-request failure after a passing pre-flight exits 4) and `e2e/startup.test.ts`.
T-035 (contracts installer-cli.md 1.3.2 section 9.4 and plugin-interface.md 0.9.1; ADR-0019/0020 amendment A1)
prints the network hint at most once, as the last line, also when the authenticated azdo line fails with
`network-unreachable`, `network-blocked` or `timeout`, or the authenticated bifrost line fails with `network`,
`timeout`, `407` or `470`. It also classifies HTTP 470 as blocked (installer probe `azdo-blocked` /
`bifrost-blocked`, plugin `network-blocked`). Tests: `smoke.test.ts` and `install-smoke.test.ts` (hint present or
absent per code, hint last and once, 470 probe never sends the credential) and `backend/test/plugin/fetch.test.ts`
(470 with any `Content-Type`, body unread).
Lint rule 7 (`check-fr11.mjs`, ADR-0013) forbids any file directly in `backend/installer/` from
mentioning test switches such as the fake-network preload, so product code can never enable it.

### Windows installer tests (F-011)
`install.ps1` (contract section 10, ADR-0014) is tested by `ps-helpers.ts` (shared helpers),
`install-ps1.test.ts`, `install-ps1-static.test.ts`, `install-ps1-smoke.test.ts` and
`install-helper-frontend.test.ts` (helper `frontend` record), all in `backend/test/installer/`. They run
with `npm test`, and the script tests run on both `pwsh` (PowerShell 7+) and `powershell.exe`
(Windows PowerShell 5.1). A host that is not installed is skipped with a clear message, so the suite
also passes on machines with only one of them.

## Shared config repo tests and lint rule 8
The shared config repo template (`backend/shared-config/`: `azure-pipelines.yml`,
`set-branch-policies.sh`, `package.json`, `.gitattributes`, `kilo.jsonc`) and the assemble tool
(`backend/tools/assemble-shared-repo.ts`; contract
`docs/architecture/contracts/shared-config-repo.md`, ADR-0015) are tested by
`backend/test/shared-config/` (`assemble.test.ts`, `pipeline.test.ts`, `branch-policies.test.ts`,
shared `helpers.ts`). They run with `npm test`; to run only these:

```bash
cd backend
node --test "test/shared-config/*.test.ts"
```

The tests never contact Azure DevOps; the branch-policy script is run with `--dry-run` or with a fake
`az`. `npm run lint` has an eighth rule: `.ts` files in `backend/tools/` may import only `node:`
built-ins and must not use `require(`. To try the tool by hand, see the
[user guide](user-guide.md#setting-up-the-shared-config-repo-platform-engineers).

## End-to-end startup tests (F-014)
`backend/test/e2e/` (`startup.test.ts`, `helpers.ts`, `fixtures/kilo-start-simulator.ts`; contract
`docs/architecture/contracts/e2e-harness.md`, ADR-0016) is a test-only suite. Each scenario runs the
real `install.sh` in a temporary HOME, then starts a child-process Kilo start simulator that imports the
installed plugin, calls its `server` and runs its `config` hook against the fake network
(`backend/test/installer/fixtures/fake-network.ts`, which gained an additive `auth` answer that
returns the given answer only when the `authorization` header matches, else 401). No real network,
Azure DevOps, Bifrost or Kilo is used.

It covers (vision acceptance criteria in brackets): fresh install then first start applies the shared
config and loads the plugin once (AC-1 and AC-12, simulated); a changed shared file is picked up without
re-running the installer (AC-2); AzDO down with a cache uses the cache (AC-3); AzDO down without a cache
keeps the local config (AC-4); `defaults` and `enforce` merge modes, with the key never replaced (AC-6,
AC-7); the installer smoke test checks the key against fake Bifrost (AC-10); and no key, PAT or credential
appears in any output, log or cache (AC-9).

Run only this suite, from `backend/`:

```bash
node --test test/e2e/startup.test.ts
```

It also runs with `npm test`. Notes:
- It needs `bash` (Git Bash on Windows; set `KILO_TEST_BASH` to point at one). Without bash every test is skipped with the message "bash not found on PATH (set KILO_TEST_BASH): end-to-end startup suite skipped".
- The simulator writes its result to a file (`--out`), not stdout, because the result holds the engineer's key. Tests never print it.
- Guard: the simulator exits 2 unless the fake-network preload is active (`globalThis.fetch.name === "fakeFetch"`) and `KILO_TEST_FAKE_NET` is set, so it cannot reach a real network. Exit 1 means the plugin threw, which is a product defect.
- Product code under `backend/installer/` must not mention these test switches (lint rule 7).

To add a scenario: add a `test(...)` with `OPTS` in `startup.test.ts`, build the fake network answers (`azdo`, `bifrost`, using `auth` where the credential matters), call `withE2eSandbox`, `runInstall` and `runStart` from `helpers.ts`, assert on the `SimResult` (`config`, `logs`, `hookCalls`), and call `assertNoLeaks` on all output.

### What stays manual (Phase 0)
These tests simulate startup; they do not prove vision AC-1. Still to be checked by hand against the
real systems in Phase 0 (see the [Phase 0 verification checklist in the platform runbook](platform-runbook.md#phase-0-verification-checklist)):
- Kilo CLI `/models` and the VS Code extension model list show the Bifrost models, with real Azure DevOps and real Bifrost.
- Kilo's own loading of the `.ts` plugin and its path resolution (the simulator imitates it from the contract, not from Kilo).
- A disabled virtual key is rejected by Bifrost at request time (AC-11); the tests only check that the key is sent.

## Layout
```
backend/plugin/azdo-remote-config.ts   the plugin
backend/validator/                     shared-config validator (CLI, rules library, schema subset)
backend/shared-config/                 shared config repo template (kilo.jsonc, azure-pipelines.yml, set-branch-policies.sh, package.json, .gitattributes)
backend/tools/assemble-shared-repo.ts  builds the shared config repo tree
backend/personal-config/kilo.jsonc     personal config template (copied to ~/.config/kilo/)
backend/installer/                     bootstrap installer (install.sh, install.ps1 + Node helper)
backend/tools/check-fr11.mjs           lint
backend/tools/compare-plugin-shape.mjs manual move-and-comment-only proof for plugin refactors
backend/test/                          tests (backend/test/e2e/ = end-to-end startup suite)
```
Further folders (templates, provisioning) arrive with later items.
