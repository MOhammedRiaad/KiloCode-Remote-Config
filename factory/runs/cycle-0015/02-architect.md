# Architect report — cycle 0015 — F-008: Shared config repo: Azure Pipelines PR gate and branch policy setup

## Inputs read
- factory/runs/cycle-0015/01-product-owner.md (F-008, 8 ACs)
- docs/architecture: overview.md, README.md, ADR-0001, ADR-0010, ADR-0012, contracts/validator-cli.md
- backend/package.json, tsconfig.json, tools/check-fr11.mjs, shared-config/kilo.jsonc,
  test/installer/helpers.ts (findBash, stub node/az patterns), test/validator/helpers.ts,
  test/tools/check-fr11.test.ts, scripts/ci.sh, scripts/check-lf.sh, .gitattributes
- Azure CLI reference (learn.microsoft.com): `az repos policy approver-count|required-reviewer|build create`
- azure-devops-cli-extension source: `dev/repos/policy.py` (`resolveIdentityMailsToIds`, split on `;`),
  `dev/common/identities.py` (`resolve_identity_as_id`: GUID used as-is, else identity search)
- Pulumi azuredevops `BranchPolicyBuildValidation` docs (validDuration / queueOnSourceUpdateOnly semantics)

## Work done
- Designed the C1 repo template, assemble tool, PR pipeline and branch-policy script (ADR-0015) and
  wrote the precise contract (`contracts/shared-config-repo.md`) including the normative YAML, the
  9-file manifest, the exact three az argv lists, dry-run quoting rule, messages and exit codes.
- Verified the az flag names (all `create` flags listed as required in the reference are passed),
  that `--repository-id` must be a GUID, how `--required-reviewer-ids` resolves a group, and the
  build-expiry semantics (`--valid-duration 0` + `--queue-on-source-update-only false` = expire when
  main updates).
- Prototyped the pipeline's bash step against the real validator in a scratch tree: no teams dir ->
  exit 0; valid `teams/payments/kilo.jsonc` -> exit 0, both files reported; off-list host -> exit 1;
  undefined variable (literal `$(KILO_ALLOWED_HOSTS)`) -> exit 2 (fails closed). Prototyped the
  dry-run single-quote escaping idiom (bash 5.3).
- Updated overview.md (C1 row, PR-gate flow, new "Producing and protecting C1" flow, layout) and
  removed its 5 NUL bytes (they were meant to be literal `\0`) plus two lost backslashes
  (`installer\install.ps1`, `$PSScriptRoot\install-helper.ts`) - this resolves the overview part of T-021.
- Amended ADR-0001 (lint rule 8, `tools/**/*.ts` in tsconfig, layout), ADR-0010 (extended-by),
  validator-cli.md (consumer pointer), README.md (new contract).

## Design summary
- **Template** in `backend/shared-config/`: existing `kilo.jsonc` + new `azure-pipelines.yml`,
  `set-branch-policies.sh`, `package.json` (`"type": "module"`, no deps), `.gitattributes`
  (`* text eol=lf`). Every file there maps to the C1 root.
- **Assemble tool** `node backend/tools/assemble-shared-repo.ts <outdir>`: constant 9-file manifest
  (5 template files + 3 validator files + plugin, same relative layout as `backend/`),
  `copyFileSync(..., COPYFILE_EXCL)` byte copies, refuses a non-empty/non-dir outdir (exit 2), never
  deletes, prints no paths. Exit 0/1/2.
- **Pipeline**: `trigger: none`, `pr: main` (ignored by Azure Repos - the real trigger is the build
  policy), ubuntu-latest, `UseNode@1` `22.x` + in-step >= 22.18 guard, no npm; one bash step:
  `files=(kilo.jsonc)` + nullglob `teams/*/kilo.jsonc` -> `node validator/validate-kilo-config.ts
  --allowed-hosts "$KILO_ALLOWED_HOSTS" -- "${files[@]}"`. Allowed hosts = YAML variable
  `KILO_ALLOWED_HOSTS` (default `bifrost.yourcompany.internal`), always passed, fails closed.
- **Policy script** (bash, builtins + az only, bash 3.2 compatible): required `--org --project
  --repository-id --reviewer-group --build-definition-id`, optional `--dry-run`, `--help`. Branch fixed
  to `main`. Three commands, each one bash array used for both printing and `az "${cmd[@]}"
  </dev/null >/dev/null 2>&1`. Org normalised to `https://dev.azure.com/<org>` (host restricted).
  Exit 0 ok / 1 az missing or az failed (stop at that call, fixed message, az output discarded) /
  2 usage (never echoes values, az never invoked).

## Backend tasks

All paths relative to `backend/`. Contract: `docs/architecture/contracts/shared-config-repo.md`
(sections referenced as C§n). ADR: `docs/architecture/ADR-0015-shared-config-repo-pipeline-and-branch-policy.md`.
Do **not** modify `plugin/azdo-remote-config.ts`, `validator/*`, `installer/*`,
`personal-config/kilo.jsonc`, `shared-config/kilo.jsonc` or `package.json` (AC8).

### BE-1 Template files (AC1, AC4)
- Create `shared-config/package.json` exactly as C§1 (no `dependencies`/`devDependencies`/`scripts`).
- Create `shared-config/.gitattributes` = `* text eol=lf\n`.
- Create `shared-config/azure-pipelines.yml` exactly as C§3 (keys, step order and script body are
  normative; LF, no tabs, no `$(` in the script body, no npm/npx/yarn/pnpm anywhere).

### BE-2 `shared-config/set-branch-policies.sh` (AC5, AC6, AC7)
- Implement C§4 exactly: `#!/usr/bin/env bash`, `set -u`, bash 3.2 compatible, only bash builtins +
  `az`; help scan first; `--flag value` form only; validation table C§4.1 (org name/URL ->
  `https://dev.azure.com/<name>`, GUID repo id, positive-int build id, text rule, no `;` in group);
  collect all usage problems, print fixed reasons (C§4.5) + usage to stderr, exit 2.
- Build the three commands as arrays in the exact argv order of C§4.2 (including `--output none`).
- Dry run: exactly three stdout lines per C§4.3 quoting rule. Verified idiom:
  `sq="'"; esc="'\\''"; case "$v" in *[!A-Za-z0-9_./:=@%+,-]*) printf "'%s'" "${v//$sq/$esc}";; *) printf '%s' "$v";; esac`.
- Real run: `command -v az` check (exit 1 fixed message), then per command
  `az "${cmd[@]}" </dev/null >/dev/null 2>&1`; success/failure messages C§4.4 verbatim; stop on first
  failure, exit 1; final done line, exit 0.
- No `eval`, `sh -c`, `bash -c`, `source`/`.`; never expand `AZURE_DEVOPS_EXT_PAT` (name only in help);
  no `--pat`/`--token` option. Usage text contents per C§4.5 (auth note, `az repos show ... --query id`,
  duplicates note).

### BE-3 `tools/assemble-shared-repo.ts` (AC2, AC3, AC4)
- Implement C§2: manifest constant (9 rows, order as listed), backend root from `import.meta.url`,
  `lstat` checks on outdir (absent or empty real directory), stat all sources before writing,
  `mkdirSync(..., {recursive:true})` for `validator/` and `plugin/`, `copyFileSync` with
  `constants.COPYFILE_EXCL`, `chmod 0o755` on `set-branch-policies.sh` when not win32.
- Fixed messages and exit codes 0/1/2 per C§2; never print the outdir or any argument; no stack
  traces (catch everything in `main`). `node:` imports only; erasable TS; runs `main()` on load.

### BE-4 Lint / type-check wiring (AC8)
- `tools/check-fr11.mjs`: rule 8 - every `.ts` file directly in `tools/` may import only `node:`
  specifiers and must not contain `require(` (skip when `tools/` absent). Reuse `checkHelperDir` with a
  node:-only allow-list (do not change rules 1-7).
- `test/tools/check-fr11.test.ts`: add cases - `tools/x.ts` with `import "./y.ts"` fails, with
  `import "left-pad"` fails, with `require(` fails, with `node:fs` passes; real repo passes.
- `tsconfig.json`: add `"tools/**/*.ts"` to `include`.

### BE-5 Tests under `test/shared-config/` (node:test, hermetic, no network, no real az)
- `helpers.ts`: `assembleTree()` (spawn `process.execPath tools/assemble-shared-repo.ts <tmp>/c1`, assert
  exit 0, return path; clean up via `t.after`/try-finally), `extractPipelineScript(yamlText)` and
  `defaultAllowedHosts(yamlText)` implementing the C§3 extraction rules, a sandbox env builder
  (`PATH=<tmp>/bin` only; on Windows also `SYSTEMROOT`, `ComSpec`, `TEMP`/`TMP`, as in
  `test/installer/helpers.ts`), a `node` wrapper writer (`#!/bin/sh` + `exec "<execPath>" "$@"`,
  forward slashes), and the recording stub `az` (below). Reuse `findBash` from
  `../installer/helpers.ts`. Build secret-shaped values at runtime (`"sk-" + "bf-" + ...`) for gitleaks.
- `assemble.test.ts` (AC4): exact relative file set == the 9 manifest targets; each target
  byte-equal (`Buffer.equals`) to its `backend/` source; `validator/` and `plugin/` layout matches;
  `package.json` parses with `type === "module"` and no `dependencies` key (or empty); non-empty
  outdir -> exit 2 and directory snapshot unchanged; outdir that is a file -> exit 2; extra positional
  / unknown option -> exit 2 without echoing the argument; `--help` -> exit 0; stdout never contains
  the outdir path.
- `pipeline.test.ts`:
  - AC1 (text): `trigger: none`; `pr` include `main`; `UseNode@1` + `version: "22.x"`; guard text
    contains `22` and `18`; no `npm install|npm ci|npm i |npx|yarn|pnpm`; exactly one `  - bash: |`;
    extracted script contains `validate-kilo-config.ts`, `--allowed-hosts`, `kilo.jsonc`,
    `teams/*/kilo.jsonc`, and no `$(`; no CR, no tab; `env` maps `KILO_ALLOWED_HOSTS`.
  - AC2 (run): write extracted script to `<tmp>/step.sh`, run `bash --noprofile --norc <step.sh>` with
    cwd = assembled tree, env sandbox + `KILO_ALLOWED_HOSTS=<YAML default>`: no `teams/` -> exit 0;
    empty `teams/` -> exit 0; add `teams/payments/kilo.jsonc` (copy of the example) -> exit 0 and
    stdout has `kilo.jsonc: valid` and `teams/payments/kilo.jsonc: valid`.
  - AC3 (run): in root `kilo.jsonc` and separately in `teams/x/kilo.jsonc`: add
    `"apiKey": "VALUE_SENTINEL_42"` -> non-zero; add a string containing the fake `sk-bf-` secret ->
    non-zero and output (stdout+stderr) has no `AbCdEf1234567890`; change baseURL host to
    `evil.example.com` -> non-zero. Also: `KILO_ALLOWED_HOSTS` empty -> non-zero (fail closed).
- `branch-policies.test.ts` (run the **source** `shared-config/set-branch-policies.sh` and also once
  from the assembled tree): stub `az` = `#!/bin/sh` that appends `printf '%s\0' "$@"` then `\n` to
  `<tmp>/az.log`, prints `AZ_STDOUT_MARKER $AZURE_DEVOPS_EXT_PAT` to stdout and `AZ_STDERR_MARKER` to
  stderr, and exits 7 when `[ "$3" = "$FAKE_AZ_FAIL" ]`, else 0. Every test sets
  `AZURE_DEVOPS_EXT_PAT=PAT_SENTINEL_9f3` and asserts it appears in no stdout/stderr.
  - AC5: `--dry-run` with valid inputs -> exit 0, no az.log, stdout exactly 3 lines equal to
    `"az " + expectedArgv.map(shQuote).join(" ")` (test-side quote function per C§4.3), with
    approver-count `--minimum-approver-count 1 --blocking true`, required-reviewer naming the group,
    build naming the id with `--blocking true`, all with `--branch main`, repo, org, project.
    Org forms `acme`, `https://dev.azure.com/acme/`, `https://acme.visualstudio.com` all normalise.
  - AC6: real run -> exit 0, az.log has exactly 3 records equal to the expected argv arrays; markers
    not in output; values `x; printf pwned > p1`, `$(printf pwned > p2)`, `` `printf pwned > p3` ``,
    `O'Brien` (project / reviewer-group) are recorded literally and no `p1`/`p2`/`p3` file exists in
    the cwd (tmp); `FAKE_AZ_FAIL=approver-count|required-reviewer|build` -> exit 1, az.log has 1/2/3
    records (stops), stderr is the fixed failure line naming that policy, no marker in output.
    No stub on PATH -> exit 1 with the az-not-found message.
  - AC7: each required flag missing, empty value, value starting with `-`, duplicate flag, unknown
    option `--pat VALUE_SENTINEL_42`, `--token=VALUE_SENTINEL_42`, `--org=acme`, positional
    `VALUE_SENTINEL_42`, invalid org (`http://dev.azure.com/acme`, `https://evil.example.com/acme`),
    non-GUID repo id, build id `0`/`12a`, group with `;`, value with a control character -> exit 2,
    usage text on stderr, the sentinel/offending value never in output, no az.log. `--help` -> exit 0.
  - Static: file has no CR; `bash -n` passes; no `\beval\b`, `sh -c`, `bash -c`, `^\s*(source|\.)\s`;
    no `$AZURE_DEVOPS_EXT_PAT` / `${AZURE_DEVOPS_EXT_PAT`.
- LF test: every file in `shared-config/` has no CR byte.

### BE-6 Verification
- `cd backend && npm run lint && npm run typecheck && npm test`, then `bash scripts/ci.sh` -> exit 0.
- `git diff --stat main -- backend/plugin backend/validator backend/installer backend/personal-config backend/package.json backend/shared-config/kilo.jsonc` is empty.

## Frontend tasks
- None. F-008 is backend only; `frontend/` does not exist (ADR-0001).

## Security notes (for the Security engineer)
1. **Self-modifying gate**: the PR build runs the PR's own `azure-pipelines.yml`, validator and plugin.
   A PR can weaken its own check. Mitigation is policy, not code: blocking required-reviewer
   (platform team, all paths) + approver-count with creator vote not counting. Residual: az does not
   expose `creatorVoteCounts` for the required-reviewer policy, so a platform-team author's own vote
   may satisfy the group requirement (needs real-org verification; candidate follow-up).
2. **Credential routing**: `--org` restricted to dev.azure.com / *.visualstudio.com and normalised, so
   az never sends the operator's PAT/token to another host. No PAT/token flag; env passes to az only;
   the script never expands `AZURE_DEVOPS_EXT_PAT`; az stdout/stderr discarded.
3. **Injection**: every value is a single argv element from an array; no eval/`-c`; control chars
   rejected (no terminal escape injection in dry-run output); values starting with `-` rejected (no
   az option smuggling); `;` rejected in the group (no extra reviewers).
4. **Usage errors** never echo values or unknown arguments (e.g. `--pat <token>` typed by mistake).
5. **Pipeline**: no npm (no supply chain), `persistCredentials: false`, no secrets used, no `$(` macros
   in the script, allowed-hosts check always on and fail-closed; validator never prints values
   (ADR-0010). Info: a PR could add a symlinked `teams/x/kilo.jsonc`; the validator follows it on the
   agent but prints only rule ids/fixed messages - negligible exposure.
6. **Assemble tool**: fixed manifest (no glob leakage), COPYFILE_EXCL, refuses non-empty dirs and
   symlinks, never deletes, prints no paths.
7. gitleaks: tests must build `sk-bf-` values at runtime.

## Files changed
- `docs/architecture/ADR-0015-shared-config-repo-pipeline-and-branch-policy.md` — new ADR.
- `docs/architecture/contracts/shared-config-repo.md` — new contract (template, assemble tool, pipeline, policy script).
- `docs/architecture/overview.md` — C1 row, PR-gate flow, C1 production/protection flow, layout; NUL bytes and two lost backslashes fixed.
- `docs/architecture/ADR-0001-tech-stack.md` — FR-11 lint rule 8, tsconfig include, layout.
- `docs/architecture/ADR-0010-shared-config-validator.md` — extended-by note.
- `docs/architecture/contracts/validator-cli.md` — consumer pointer.
- `docs/architecture/README.md` — new contract listed.
- `factory/runs/cycle-0015/02-architect.md` — this report.

## Verification
- Scratch prototype (scratchpad, not committed) of the pipeline step with the real validator:
  exit 0 (no teams), 0 (valid team file, both reported), 1 (off-list host), 2 (unset variable).
- Dry-run quoting idiom checked on bash 5.3 (`O'Brien` -> `'O'\''Brien'`, `$(id)` -> `'$(id)'`).
- overview.md: no NUL bytes after the fix (Node byte scan).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | ADR-0015 §3 | Reviewer-group value resolution is done by az (GUID recommended, display-name lookup may be ambiguous); not verifiable without a real org | Docs (F-016) explain how to obtain the group identity id |
| 2 | info | ADR-0015 Consequences | PR content can modify its own pipeline/validator | Relies on required-reviewer policy; see security note 1 |

## Assumptions made (no human available)
- No `--branch` flag although the orchestrator brief listed "branch": the PO ACs and FR-14 fix the
  branch to `main`; fewer inputs, fewer mistakes. Can be added later without breaking the contract.
- `--repository-id` must be a GUID (az does not resolve names); the PO's "id or name" is satisfied by
  documenting `az repos show --repository <name> --query id -o tsv` in the usage text.
- Flag is named `--build-definition-id` (matches az and the ACs) rather than `--pipeline-definition-id`.
- Policy options beyond the ACs chosen conservatively: creator vote does not count, rejections block
  (`--allow-downvotes false`), votes reset on push, build expires immediately when main updates,
  automatic queue.
- Default allowed host `bifrost.yourcompany.internal` matches the example config; platform team
  replaces it via a reviewed PR.
- `UseNode@1` `version: "22.x"` satisfies "Node 22.18 or later" (latest 22.x) and is backed by an
  in-step guard.
- Fixing the NUL bytes in overview.md is within the Architect's lane; the rest of T-021 (contract
  10.1 wording) is untouched.

## Follow-ups for the backlog
- T-023 (exists): policy idempotency.
- New (suggested, low): verify in a real org whether a platform-team author's own approval satisfies
  the required-reviewer group policy; if so, document or add a REST-based `creatorVoteCounts` setting.
- New (suggested, low): CI releaser - run ShellCheck on `backend/**/*.sh` when present and extend
  `scripts/check-lf.sh` to `backend/**/*.sh` and `*.yml`.
- T-021: overview.md NUL part done; contract 10.1 wording remains.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0015/02-architect.md
summary: F-008 design: C1 template in backend/shared-config + assemble tool (9-file byte-identical manifest), Azure Pipelines PR gate (no npm, fail-closed allowed hosts), bash branch-policy script with exact az argv; ADR-0015 + contracts/shared-config-repo.md; backend-only task list.
