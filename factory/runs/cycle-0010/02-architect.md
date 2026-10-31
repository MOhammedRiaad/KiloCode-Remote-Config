# Architect report — cycle 0010 — F-009: Personal config template

## Inputs read
- `factory/runs/cycle-0010/01-product-owner.md` (F-009, 7 ACs), `factory/VISION.md` (FR-3, FR-16, FR-17, Appendix B)
- `docs/architecture/overview.md`, `ADR-0001`, `ADR-0002`, `ADR-0010`, `contracts/validator-cli.md`
- `backend/plugin/azdo-remote-config.ts` (`__internals`, `resolveSettings`, `mergeConfig`)
- `backend/validator/kilo-config-rules.ts` (`validateConfigText`, `SECRET_PATTERN`), `kilo-schema-subset.json`
- `backend/tools/check-fr11.mjs`, `backend/package.json`, `backend/tsconfig.json`, `scripts/ci.sh`
- `backend/test/validator/helpers.ts`, `example-config.test.ts`

## Work done
- Design decision recorded in ADR-0011. The template goes in `backend/personal-config/kilo.jsonc`
  (the PO default). It replaces the old `backend/templates/` plan.
- Exact template text and 8 test-pinned invariants (I1-I8, mapped to AC1-AC6) are in
  `contracts/personal-config-template.md`.
- I prototyped the exact template in the scratchpad and ran it against the real code. Results:
  - `parseJsonc`: keys are `$schema`, `plugin`, `provider`.
  - `validateConfigText`: exactly `[warning plugin-ignored @plugin, error api-key @provider.bifrost.options.apiKey]`.
  - With the fake key: two `secret-pattern` findings are added (the tree path and `line N`), and no value is echoed.
  - `resolveSettings(opts, {env:{}})`: `missing: []`, `warnings: []`.
  - `mergeConfig` in defaults and enforce mode: `apiKey` is kept, and `baseURL`, `npm`, `name` and both models are added. `plugin` and `$schema` are unchanged.
  - `SECRET_PATTERN.test("sk-bf-<your-virtual-key>")` is `false`.
- FR-11 lint and build wiring need no change (ADR-0011 section 4).

### Design summary
- **File:** `backend/personal-config/kilo.jsonc`. It holds data only and nothing imports it. Installers copy it to `~/.config/kilo/kilo.jsonc`.
- **Content:** Appendix B with comments for FR-17 and FR-3. The plugin tuple has the 6 options and no `pat`. The `apiKey` placeholder is `sk-bf-<your-virtual-key>`. There are no trailing commas.
- **Tests:** these reuse the existing exports only: `__internals.parseJsonc`, `resolveSettings` and `mergeConfig`, plus `validateConfigText` and `SECRET_PATTERN`. Helpers come from `test/validator/helpers.ts`. Validator findings are filtered on the test side. The plugin file, the validator library and the CLI do not change.
- **FR-11:** `check-fr11.mjs` covers `package.json`, `plugin/` and `validator/*.ts`. The new data directory and test directory are outside its rules. `tsconfig` already includes `test/**/*.ts`. `node --test "test/**/*.test.ts"` picks up the new folder.

## Backend tasks

| # | Task | Files | ACs |
|---|------|-------|-----|
| BE-1 | Create the template with the **exact** text from `docs/architecture/contracts/personal-config-template.md` section 1. Use UTF-8 without a BOM and end with a newline. Keep the comments, including the literal `~/.config/kilo/kilo.jsonc` and the words "project directory". Do not add `pat`, `timeoutMs`, `baseURL` or models, and do not use trailing commas. | `backend/personal-config/kilo.jsonc` (new) | AC1, AC2, AC4 |
| BE-2 | Write the template tests. Imports: `__internals` from `../../plugin/azdo-remote-config.ts`; `validateConfigText` and `SECRET_PATTERN` from `../../validator/kilo-config-rules.ts`; `backendRoot`, `FAKE_SECRET` and `SECRET_TAIL` from `../validator/helpers.ts`. Read the template with `readFileSync(join(backendRoot, "personal-config", "kilo.jsonc"), "utf8")`. One test per invariant: | `backend/test/personal-config/template.test.ts` (new) | AC1-AC6 |
| | - I1/I2 (AC1): the parsed root is a plain object, its keys sorted are `["$schema","plugin","provider"]`, and it has the exact `$schema`. The raw text has a `//` comment line that contains `~/.config/kilo/kilo.jsonc`, and a comment line that matches `/project directory/i`. Use multiline regexes that tolerate `\r` and do **not** assert the absence of `\r` (Windows autocrlf). | | |
| | - I3 (AC2): `plugin` has length 1 and its entry is a 2-tuple. Element [0] is `./azdo/azdo-remote-config.ts`. The option keys sorted are `["branch","mode","org","path","project","repo"]`, `pat` is absent, every value is a non-empty string, `path` starts with `/`, and `mode` is in `{defaults, enforce}`. | | |
| | - I4 (AC3): `resolveSettings(opts, { env: {} })` gives `missing` deep-equal `[]`, `warnings` deep-equal `[]`, and the 6 settings equal the template values. | | |
| | - I5 (AC4): the exact key sets at `provider`, `provider.bifrost` and `provider.bifrost.options`. `apiKey` is a string that starts with `sk-bf-` and `SECRET_PATTERN.test(apiKey) === false`. | | |
| | - I6 (AC5): `validateConfigText(text)` has no `rule === "secret-pattern"`. The error findings are exactly `[{rule:"api-key", location:"provider.bifrost.options.apiKey"}]`, and the warnings are exactly `[{rule:"plugin-ignored", location:"plugin"}]`. | | |
| | - I7 (AC5, positive control): `text.replace(apiKey, FAKE_SECRET)` must produce at least one `secret-pattern` finding. Check that the replaced text actually differs from the original. No finding's `rule`, `location` or `message` may include `SECRET_TAIL`. Never write an `sk-bf-<alnum>` literal in the source. | | |
| | - I8 (AC6): for each of `["defaults","enforce"]`, parse the template fresh, and parse `shared-config/kilo.jsonc` with `parseJsonc`. Take a `structuredClone` of `plugin` and `$schema` before the merge, then call `mergeConfig(local, shared, mode)`. Afterwards `apiKey` must equal the placeholder, `baseURL` must equal the shared `baseURL` (read from the parsed shared file, not hard-coded twice), `models` must contain `azure/gpt-5` and `azure/gpt-5-mini`, and `plugin` and `$schema` must deep-equal the clones. | | |
| BE-3 | Verify and do not change: the plugin file and the validator files are byte-unchanged (`git diff --stat` shows only the two new files). `backend/package.json` keeps no `dependencies`. Run `bash scripts/ci.sh` (lint, typecheck and test, including the existing AC8 export-surface test and the example CLI test), then `npx tsc --noEmit` must be clean (`noUnusedLocals`, `noUncheckedIndexedAccess`: use `as Record<string, any>` like `example-config.test.ts`). | - | AC7 |

Do **not** modify `backend/plugin/**`, `backend/validator/**`, `backend/tools/check-fr11.mjs`, `backend/package.json`, `backend/tsconfig.json` or `scripts/ci.sh`.

## Frontend tasks
- None (`scope.frontend = false`, and there is no frontend in this product).

## Security notes (for the Security engineer)
- **Secrets:** the template must hold only the non-matching placeholder `sk-bf-<your-virtual-key>`. The positive control builds its fake key at runtime (`FAKE_SECRET`), so gitleaks and repo scans see no secret-shaped literal. The `generic-api-key` rule in gitleaks should not fire, because `<` breaks the token charset and `sk-bf-` alone is too short and has too little entropy.
- **No PAT field:** the template has no `pat` option. Its comments steer users to env vars or `az login` (FR-3).
- **FR-17:** the comments warn against placing the file in a project directory or committing it. Enforcing this at install time is F-010/F-011's job (installers must write only to the global directory, with user-only permissions).
- **Merge safety:** I8 confirms that the shared config can never overwrite `apiKey` or `plugin` in either mode, which matches ADR-0005 and ADR-0009 (`sanitizeShared` drops `apiKey`, and the shared file has no `plugin`).
- **Unchanged surface:** this item changes no code paths, the plugin export surface or validator rules.

## Files changed
- `docs/architecture/ADR-0011-personal-config-template.md`: new ADR (location, content, test strategy, FR-11).
- `docs/architecture/contracts/personal-config-template.md`: new contract (exact text and invariants I1-I8).
- `docs/architecture/overview.md`: C3 row, contracts list and directory layout updated.
- `docs/architecture/README.md`: the new contract listed.
- `factory/runs/cycle-0010/02-architect.md`: this report.

## Verification
- Ran a scratch prototype (outside the repo) of the template against the real `parseJsonc`, `validateConfigText`, `resolveSettings` and `mergeConfig`. All invariants I1-I8 hold. The results are listed under Work done.
- `node --test test/validator/example-config.test.ts` on this Windows checkout: the existing test
  "example config has comments, a trailing comma, no secret text and no plugin" **fails locally**
  at `assert.doesNotMatch(raw, /\r/)`. `core.autocrlf=true` gives `backend/shared-config/kilo.jsonc` CRLF in the
  working tree (the index has LF). This problem existed before this cycle. CI on Linux is not affected.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/test/validator/example-config.test.ts:42 | `/\r/` assertion fails on Windows checkouts with `core.autocrlf=true`. This means `bash scripts/ci.sh` fails locally for the BE engineer, even though it passes on Linux CI. This existed before F-009. | Orchestrator or CI releaser: add `*.jsonc text eol=lf` to `.gitattributes` and re-checkout (`git rm --cached -r backend && git checkout -- backend`, or `git add --renormalize .`). This also covers the new template. BE must not weaken the existing test. If AC7 is verified on this machine, apply the `.gitattributes` fix first. |

## Assumptions made (no human available)
- The path is `backend/personal-config/kilo.jsonc`. It mirrors `shared-config/`, and `backend/templates/` is dropped.
- The placeholder is `sk-bf-<your-virtual-key>`. It is clearer than `sk-bf-...` and does not match `SECRET_PATTERN`.
- No trailing commas in the template, so stricter JSONC tools can read it. Comments are kept because they are required (FR-17).
- Tests may import `helpers.ts` from `test/validator/`. That module has no side effects, and sharing it avoids a second fake-secret literal.

## Follow-ups for the backlog
- Add `.gitattributes` `*.jsonc text eol=lf` (finding 1). Small chore, owner: the CI releaser.
- F-010/F-011: the installers copy `backend/personal-config/kilo.jsonc` and must never overwrite an existing `~/.config/kilo/kilo.jsonc` that already holds a real key.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0010/02-architect.md
summary: F-009 design: template at backend/personal-config/kilo.jsonc (ADR-0011, contract I1-I8), test-only reuse of plugin/validator exports, no FR-11/CI change; BE-1..BE-3, no FE tasks
