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
Files: `backend/test/**/*.test.ts`. Tests must not touch the network or real Azure DevOps, `az`,
Bifrost or Kilo; use fakes.

## Layout
```
backend/plugin/azdo-remote-config.ts   the plugin
backend/tools/check-fr11.mjs           lint
backend/test/                          tests
```
Further folders (validator, templates, installer, provisioning) arrive with later items.
