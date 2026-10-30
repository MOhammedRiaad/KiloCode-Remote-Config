# Architect report - cycle 0002 - T-001: Project skeleton & CI

## Inputs read
- `factory/VISION.md`, `factory/runs/cycle-0002/01-product-owner.md`, `factory/backlog.json`, `factory/state.json`
- `docs/architecture/README.md`, `docs/architecture/contracts/openapi.yaml` (leftover from an unrelated product)
- `scripts/ci.sh`, `scripts/check-compose.sh`, `scripts/smoke-docker.sh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Kilo plugin docs (https://kilo.ai/docs/automate/extending/plugins) and Kilo's plugin loader source
  (https://raw.githubusercontent.com/Kilo-Org/kilocode/main/packages/opencode/src/plugin/index.ts); Kilo release tags 7.2.x-7.3.x (pkg.go.dev mirror)

## Work done
- Chose the stack (ADR-0001): TypeScript (erasable syntax only), Node >= 22.18 native type stripping for dev/test, Bun-in-Kilo at runtime, `node:test` runner, `tsc --noEmit` type-check, zero-dep FR-11 lint script, dev deps limited to `typescript` + `@types/node`, Kilo range `>=7.2.0 <8.0.0`, `backend/` layout, and exact commands.
- Fixed the plugin module shape and test seam (ADR-0002): `export default { id, server }`, no exported functions, helpers only via a `__internals` object, so the plugin loads exactly once on both of Kilo's loader paths.
- Wrote the typed plugin contract (`contracts/plugin-interface.md`). Removed the unrelated "Car Finder" `openapi.yaml`. This product has no HTTP API and no frontend.
- Wrote `overview.md` (components, runtime data flow, C2 internal structure, layout).
- Tried the toolchain in a scratch prototype on Windows/Node 24: `tsc --noEmit` passed with the tsconfig below, and `node --test "test/**/*.test.ts"` imported the `.ts` plugin and passed.

## Files changed
- `docs/architecture/ADR-0001-tech-stack.md` - new: stack, test runner, Kilo range, FR-11 constraint, layout, commands.
- `docs/architecture/ADR-0002-plugin-module-shape.md` - new: export shape / test seam.
- `docs/architecture/contracts/plugin-interface.md` - new: the BE contract.
- `docs/architecture/contracts/openapi.yaml` - deleted (unrelated leftover product contract).
- `docs/architecture/overview.md` - new.
- `docs/architecture/README.md` - contracts line updated.

## Backend tasks (Senior BE)

All paths under `backend/`. Follow ADR-0001/ADR-0002 and `contracts/plugin-interface.md`.

| # | Task | Files | Maps to AC |
|---|---|---|---|
| BE-1 | Create `package.json`: `"name": "kilo-azdo-backend"`, `"private": true`, `"version": "0.0.0"`, `"type": "module"`, `"engines": { "node": ">=22.18.0" }`, scripts `lint` = `node tools/check-fr11.mjs`, `typecheck` = `tsc --noEmit -p tsconfig.json`, `test` = `node --test "test/**/*.test.ts"`. **No `dependencies` field.** `devDependencies`: `typescript` `~5.9.3`, `@types/node` `^22.18.0`. No `build` script. Run `npm install` and **commit `package-lock.json`**. | `backend/package.json`, `backend/package-lock.json` | AC1, AC4 |
| BE-2 | Create `tsconfig.json` (validated): `target ES2022`, `module`/`moduleResolution` `NodeNext`, `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `types: ["node"]`, `skipLibCheck: true`; `include: ["plugin/**/*.ts", "test/**/*.ts"]`. | `backend/tsconfig.json` | AC1 |
| BE-3 | Create the plugin stub exactly per contract sections 1-3: exported types (`LogLevel`, `PluginInput`, `PluginOptions`, `KiloConfig`, `Hooks`, `PluginServer`), `export const PLUGIN_ID = "azdo-remote-config"`, `export const SUPPORTED_KILO_RANGE = ">=7.2.0 <8.0.0"`, `export const __internals = {}`, module-local `const AzdoRemoteConfig: PluginServer` returning `{ config: async (_config) => {} }`, and `export default { id: PLUGIN_ID, server: AzdoRemoteConfig }`. Only `node:` imports (none are needed yet). No exported functions. Short header comment pointing to ADR-0001/0002 and FR-11. No I/O, no logging of anything. | `backend/plugin/azdo-remote-config.ts` | AC3, AC6 |
| BE-4 | FR-11 lint script in plain Node ESM, zero deps. It fails with exit 1 and a clear message when: `package.json` has a non-empty `dependencies`; `plugin/` holds anything other than `azdo-remote-config.ts`; any `import ... from "<spec>"`, `export ... from "<spec>"`, `import("<spec>")` or bare `import "<spec>"` in the plugin uses a specifier that does not start with `node:`; the file contains `require(`. Prints `check-fr11: PASS` on success. Resolve paths relative to the script (`import.meta.url`) so it works from any cwd. | `backend/tools/check-fr11.mjs` | AC4 |
| BE-5 | Smoke tests (`node:test`, `node:assert/strict`). Import the default export from `../../plugin/azdo-remote-config.ts`. Fake input: `{ client: { app: { log: spy } }, directory: tmpdir, worktree: tmpdir }`. Assert: (a) `default.id === "azdo-remote-config"` and `typeof default.server === "function"`; (b) `await server(fakeInput, {})` returns an object with `typeof hooks.config === "function"`; (c) `server({}, undefined)` also resolves; (d) calling `hooks.config(cfg)` on a nested sample config (provider/models/agent/plugin keys) resolves, `cfg` is deep-equal to a `structuredClone` taken before the call, and the reference is unchanged; (e) the log spy was never called (stub does no logging); (f) every named export other than types is not a function and `__internals` has no `server` key (ADR-0002); (g) `SUPPORTED_KILO_RANGE === ">=7.2.0 <8.0.0"`. | `backend/test/plugin/azdo-remote-config.smoke.test.ts` | AC3, AC6 |
| BE-6 | Test for the lint script: run `node tools/check-fr11.mjs` via `node:child_process` `spawnSync(process.execPath, [...])` against the real tree and assert exit 0. The script's failure paths may optionally take a `--root <dir>` argument for a temp fixture tree; if added, cover the "non-empty dependencies" and "npm import" failures. | `backend/test/tools/check-fr11.test.ts` | AC4 |
| BE-7 | Verify locally: from `backend/` run `npm ci && npm run lint && npm run typecheck && npm test`, all green. Do not create `frontend/`. Do not create `validator/`, `templates/`, `installer/` or `provisioning/` yet. | - | AC1 |

Tests that must exist: `backend/test/plugin/azdo-remote-config.smoke.test.ts` and `backend/test/tools/check-fr11.test.ts`.

## Frontend tasks (Senior FE)

None. `scope.frontend = false`. This product has no UI (ADR-0001). Skip the FE phase.

## Notes for the CI releaser (scripts/ci.sh and workflows)

The current `scripts/ci.sh` will **fail** in this repo as it stands, because it is left over from another project:
1. **`bash scripts/check-compose.sh` must be removed from `ci.sh`.** It needs `docker-compose.yml` and `.env.example`, and neither exists or will exist here. Keep its "shell scripts must be LF-only" check: move it to a new `scripts/check-lf.sh` (or inline it) and call that instead. Delete `scripts/check-compose.sh` and `scripts/smoke-docker.sh` along with the `RUN_DOCKER_SMOKE` block, since there is no Docker in this product.
2. The Node path `run_node backend` already does `npm ci` -> `lint` -> `typecheck` -> `test` -> `build --if-present`. npm echoes `> kilo-azdo-backend@0.0.0 typecheck` / `> ... test`, which is enough evidence for AC1. Adding explicit `echo "ci: backend typecheck"` style markers is fine. Keep `ran=1` so the "no packages yet" line is not printed.
3. The Python path is unused. Keeping it is harmless (it only triggers on `pyproject.toml`/`requirements.txt`), and removing it is fine too.
4. **`.github/workflows/ci.yml`:** keep `quality-gate` running `bash scripts/ci.sh` with `node-version: 22`. If you want to be strict, use `node-version: "22.x"` with `check-latest: true` so the runner gets >= 22.18. **Remove the `docker-smoke` job** because it would fail without a compose file. Keep `secret-scan` (gitleaks). Do not pass the vision's `sk-bf-` example strings through it as real secrets; they appear only in docs. `setup-python` can be dropped.
5. Optional but recommended: add a `windows-latest` matrix leg running `bash scripts/ci.sh` (Git Bash is on GH Windows runners), because the vision targets Windows engineers. If you add it, add a root `.gitattributes` with `*.sh text eol=lf` so checkouts keep LF.
6. `release.yml`: there is no build output (`backend/dist` will not exist), so packaging is a no-op. That is acceptable for now. Dropping `setup-python` is fine.
7. An optional extra guard in `ci.sh` for AC2/AC5: `grep -q 'scripts/ci.sh' .github/workflows/ci.yml` and a heading check on ADR-0001 (`## Decision` sub-sections `### 1. Language / runtime`, `### 2. Test runner`, `### 5. Supported Kilo version range`, `### 6. Zero-runtime-dependency single-file plugin constraint (FR-11)`).

## Security notes (for the Security engineer)
- Supply chain: the only npm packages are the dev deps `typescript` and `@types/node`, pinned through a committed lock file and installed with `npm ci`. `dependencies` must be empty, and the lint step enforces this along with the "node: imports only" rule for the shipped file.
- The stub performs no I/O, no network and no logging, so it has no secret-exposure surface yet. Check that tests contain no real-looking tokens/keys (`sk-bf-`, PATs) that could trip gitleaks or be mistaken for secrets.
- FR-10 groundwork: `server` and `config` must never reject. The smoke tests assert this for the stub.
- Future items (not this cycle): PAT/Entra token handling, `{file:}` reading arbitrary paths, cache file permissions, log redaction. These are flagged in the contract.

## Verification
- Scratch prototype (outside the repo) of the BE-1/BE-2/BE-3/BE-5 setup on Windows, Node v24.15.0, npm 11.12.1: `npm run typecheck` -> exit 0; `npm test` -> 1 pass, 0 fail.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | high | scripts/ci.sh:47 | Calls `check-compose.sh`, which requires a `docker-compose.yml`/`.env.example` that does not exist, so the gate fails. | CI releaser: remove it and keep the LF check (see notes). |
| 2 | medium | .github/workflows/ci.yml | The `docker-smoke` job targets a non-existent compose stack. | CI releaser: remove the job. |
| 3 | info | docs/architecture/contracts/openapi.yaml | Unrelated product contract. | Deleted by the architect. |
| 4 | info | README.md (root) | Probably describes the factory template or another product. | Docs writer: review in the Docs phase. |

## Assumptions made (no human available)
- Kilo range `>=7.2.0 <8.0.0`: the v1 `{id, server}` loader and the `config` hook were confirmed in Kilo's current source and docs. The 7.2.x-7.3.x tags were observed. The lower bound is conservative and must be confirmed in Phase 0 (F-016).
- Kilo transpiles local `.ts` plugins with Bun, so the plugin sticks to APIs that exist in both Bun and Node.
- Node >= 22.18 (type stripping without flags) is available on CI (`setup-node` 22 resolves to the latest 22.x) and on dev machines (observed Node 24).
- No ESLint, to keep the dev dependency surface minimal. FR-11 guard rails are enforced by a custom zero-dep script instead.

## Follow-ups for the backlog
- Possibly: a release `build` step that copies `plugin/azdo-remote-config.ts` to `backend/dist/` so `release.yml` attaches it as an artefact (fits with the installer item).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0002/02-architect.md
summary: Stack chosen (TS erasable-only, Node>=22.18 node:test, tsc, zero-dep FR-11 lint, Kilo >=7.2.0 <8.0.0); ADR-0001/0002, plugin contract, overview written; BE tasks + CI releaser notes ready.
