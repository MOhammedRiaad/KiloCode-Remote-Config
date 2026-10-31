# ADR-0011: Personal config template (C3)
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0010 / F-009

## Context

FR-16 / FR-17 / VISION Appendix B: every engineer needs a personal `~/.config/kilo/kilo.jsonc`
that holds only the plugin entry (with its options) and their own Bifrost virtual key under
`provider.bifrost.options.apiKey`. The installers (F-010 / F-011) will copy a shipped template to
that location. The template must:
- parse with the plugin's own JSONC parser,
- be a complete plugin configuration on its own (contract 0.5.0: `repo` has no default),
- never contain a real secret, and stay safe for the CI gitleaks job,
- not change the plugin file, its export surface (ADR-0002, ADR-0010 section 2) or the validator's
  rules or CLI behaviour (ADR-0010).

`overview.md` previously reserved `backend/templates/` for C3. The PO proposed
`backend/personal-config/kilo.jsonc`.

## Decision

### 1. Location

`backend/personal-config/kilo.jsonc`. It sits next to `backend/shared-config/kilo.jsonc` (same
file name as the target on disk, same naming style as the C1 example). `backend/templates/` is
dropped from the planned layout. The file is data only. Nothing imports it at runtime. Installers
will read it from this path.

### 2. Content

The exact content is fixed in `contracts/personal-config-template.md`. In short:
- Line comments at the top state that the file belongs in `~/.config/kilo/kilo.jsonc` only, must
  never be placed in a project directory or committed (FR-17), and that Azure DevOps credentials
  come from environment variables or `az login`, never from this file (FR-3).
- Top-level keys, exactly: `$schema`, `plugin`, `provider`.
- `plugin`: one tuple `["./azdo/azdo-remote-config.ts", {org, project, repo, path, branch, mode}]`
  with Appendix B values (`contoso`, `platform`, `kilo-config`, `/kilo.jsonc`, `main`,
  `defaults`). No `pat` and no `timeoutMs`.
- `provider.bifrost.options.apiKey` = `"sk-bf-<your-virtual-key>"`. This placeholder does not match
  `SECRET_PATTERN` (`/sk-bf-[a-z0-9]/i`) because `<` follows `sk-bf-`. Nothing else under
  `provider`. `baseURL`, `npm`, `name` and models come from the shared config.
- UTF-8 without a BOM, LF in the git index, no trailing commas (the template should also be
  readable by tools that are stricter than Kilo). Tests must tolerate CRLF in the working tree
  (Windows `core.autocrlf=true`). The parser and the validator's line split already accept `\r\n`.

### 3. How tests check the template (no product-code change)

Tests live in `backend/test/personal-config/template.test.ts`. They import only existing exports:
- `__internals.parseJsonc`, `__internals.resolveSettings`, `__internals.mergeConfig` from
  `../../plugin/azdo-remote-config.ts`. These are the existing test seams. The plugin file is not
  touched and `__internals` keeps its 6 keys.
- `validateConfigText`, `SECRET_PATTERN` from `../../validator/kilo-config-rules.ts`.
- `backendRoot`, `FAKE_SECRET`, `SECRET_TAIL` from `../validator/helpers.ts` (the fake key is built
  at runtime, so no secret-shaped literal enters the repo).

The validator's rule set is written for the **shared** config, so the template is not expected to
pass it as a whole. The tests filter the findings. For the template, the exact finding set is
`plugin-ignored` (warning, `plugin`) and `api-key` (error, `provider.bifrost.options.apiKey`).
Any `secret-pattern` finding, or any other error, fails the test. A positive control replaces the
placeholder with `FAKE_SECRET`. It must produce `secret-pattern` findings and no finding field may
contain `SECRET_TAIL`. This proves the check is not vacuous. The validator CLI is **not** run on the
template (it would exit 1 because of `api-key`, which is correct for a shared file).

### 4. FR-11 lint and build wiring

No change. `tools/check-fr11.mjs` checks `package.json` dependencies, `plugin/` and `validator/*.ts`.
A `.jsonc` data directory is outside all its rules. `tsconfig.json` already includes `test/**/*.ts`.
`npm test` (`node --test "test/**/*.test.ts"`) picks up the new test folder. `scripts/ci.sh` and
`package.json` stay unchanged.

## Consequences

- One canonical template that installers can copy byte for byte. Its validity is pinned against the
  real parser, settings resolver and merge, so a later plugin change that breaks the template fails
  CI.
- The template contains the string `apiKey`. Tools that scan for `apiKey` (e.g. the shared-config
  gate) must not be pointed at it. The gate is only run on C1 files (F-008).
- `mode: "defaults"` is an example value. Organisations that prefer `enforce` change one line.
- If `SECRET_PATTERN` is widened later so that the placeholder matches, the template tests fail. The
  placeholder must then change together with the pattern.

## Alternatives considered

- **`backend/templates/kilo.jsonc`** (old overview plan): a generic name that would collect
  unrelated files (installer scripts have their own folder). Rejected in favour of the name that
  mirrors `shared-config/`.
- **Run the validator CLI on the template with an "allow apiKey" flag**: changes CLI behaviour,
  which the backlog forbids. Rejected.
- **Add a `personal` mode to `validateConfigText`**: changes the validator library. Rejected. Test
  side filtering is enough.
- **Placeholder `sk-bf-...`** (Appendix B literal): also does not match the pattern, but it is less
  clear to a reader that the value must be replaced. Rejected.
- **Empty `apiKey`**: does not show the `sk-bf-` key format. Rejected.
