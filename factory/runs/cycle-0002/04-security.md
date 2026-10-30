# Security report — cycle 0002 — T-001: Project skeleton & CI

## Inputs read
- `git diff main...HEAD` (excluding `factory/`): `backend/.gitignore`, `backend/package.json`,
  `backend/package-lock.json`, `backend/tsconfig.json`, `backend/plugin/azdo-remote-config.ts`,
  `backend/tools/check-fr11.mjs`, `backend/test/**`, `docs/architecture/**` (ADR-0001, ADR-0002,
  plugin-interface contract, overview; deleted `contracts/openapi.yaml`).
- `factory/runs/cycle-0002/02-architect.md` (Security notes section).
- `git status`: working tree clean on `factory/T-001-project-skeleton-ci`.

## Work done
- **Secrets:** grepped the diff for keys, tokens, passwords, private keys, `sk-`, `ghp_`, `AKIA`. The
  only hits are prose in architecture docs (PAT/Entra token handling descriptions) and removed
  example values in the deleted unrelated `openapi.yaml`. No real secrets. Test fixtures use
  `https://example.invalid/v1`. No `.env`, `.pem`, `.key` or `.npmrc` files are tracked.
- **Supply chain / FR-11:** `package.json` is `private: true` with no `dependencies` field. The only
  devDependencies are `typescript ~5.9.3` and `@types/node ^22.18.0`. The lock file (v3) pins exactly
  3 packages (`typescript 5.9.3`, `@types/node 22.20.5`, `undici-types 6.21.0`), all resolved from
  `registry.npmjs.org` with sha512 integrity. None of them has install scripts. `node_modules/` is
  gitignored.
- **Plugin stub:** no I/O, network, logging, eval or dynamic code. `server`/`config` hooks cannot
  reject. Nothing is exposed.
- **Lint tool (`tools/check-fr11.mjs`):** local dev script, plain Node ESM with only `node:` imports.
  `--root` is a CLI argument used by the developer or CI (not an untrusted input boundary). JSON
  parse errors are caught and reported as FAIL with exit 1, so it fails closed. It contains no
  shell, exec or network calls. I probed it for evasion (see finding 1).
- **Tests:** `spawnSync(process.execPath, [script, ...args])` uses no shell, so no command injection.
  Temp fixtures are created with `mkdtempSync` and removed in `finally`.
- Injection, AuthN/AuthZ, XSS/CSRF/CORS, headers: not applicable this cycle (no server, no HTTP, no UI).

## Files changed
- `factory/runs/cycle-0002/04-security.md` — this report (no source edits).

## Verification
- `npm audit --omit=dev --audit-level=high` (backend) -> 0 vulnerabilities, exit 0.
- `npm audit --audit-level=high` (including dev) -> 0 vulnerabilities, exit 0.
- `npm run lint` -> `check-fr11: PASS`. `tsc --noEmit` -> exit 0. `npm test` -> 15/15 pass.
- I ran evasion probes against `check-fr11.mjs --root <scratch fixture>`. All 4 returned PASS but
  should have failed:
  1. ``export default await import(`lodash`);`` (template-literal specifier)
  2. `import { createRequire } from "node:module"; const r = createRequire(import.meta.url); r("lodash")`
  3. `const a = "/*"; import x from "lodash"; const b = "*/";` (the comment stripper eats a real import)
  4. `const s = "lodash"; await import(s);` (non-literal specifier)

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/tools/check-fr11.mjs:17-27,54 | The FR-11 guard uses regex and can be bypassed. It misses template-literal and non-literal `import(...)` specifiers and `node:module` `createRequire`. `stripComments` can also delete a real import that sits between `"/*"` and `"*/"` string literals. The guard's goal is to catch accidental runtime dependencies (code review is the backstop), and the static, string-literal dynamic and `require(` forms are covered, so this is low. | Backlog: (a) treat any `import(` whose argument is not a `"node:..."`/`'node:...'` string literal as a failure (covers backticks and variables); (b) reject `createRequire` and `process.binding`/`module.require` tokens; (c) strip comments only outside string/template literals, or use `typescript` (already a dev dep) `ts.preProcessFile`/AST to list imports reliably. Add fixtures for probes 1-4. |
| 2 | info | backend/package.json:15-16 | `@types/node` uses a caret range and `typescript` uses a tilde range. This is acceptable because `npm ci` enforces the committed lock file, but `npm install` can drift. | Optional: keep using `npm ci` everywhere (CI already planned). No action required. |

## Assumptions made (no human available)
- I treated `check-fr11.mjs` as a developer guard rail against mistakes, not as a security boundary
  against a malicious contributor, so its bypasses are rated low.
- `scripts/ci.sh` and `.github/workflows/` are out of scope this cycle (handled later by the ci-releaser), per the orchestrator.

## Follow-ups for the backlog
- Harden the FR-11 lint against the evasions in finding 1 (route to senior-backend, `backend/tools/check-fr11.mjs`).
- Future cycles (from the contract): PAT/Entra token redaction in logs, `{file:}` path handling,
  cache-file permissions, and fetch timeouts/TLS. These need security review when they are implemented.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0002/04-security.md
summary: No secrets, 0 audit vulns, zero runtime deps, lock file pinned with integrity hashes; 1 low (FR-11 lint regex bypasses) + 1 info for the backlog.
