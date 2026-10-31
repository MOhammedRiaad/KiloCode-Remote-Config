# ADR-0015: Shared config repo (C1): repo template, assemble tool, Azure Pipelines PR gate and branch-policy script
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0015 / F-008
- Extends: ADR-0010 (validator CLI). Amends: ADR-0001 sections 3 and 7 (FR-11 lint rule 8,
  `tools/**/*.ts` in `tsconfig.json`).

## Context

FR-13 / FR-14 / AC-13: the C1 repo (`kilo-config` in Azure DevOps) must reject a PR to `main` that
adds an `apiKey`, a `sk-bf-` secret or an off-list `baseURL` host, and `main` must be protected by
blocking policies (minimum one reviewer, the platform team as required reviewer, and the PR
validation build). The F-007 validator (ADR-0010) is the gate logic. It imports
`../plugin/azdo-remote-config.ts` and needs a `package.json` with `"type": "module"` next to it.

Constraints:
- ADR-0001: Node >= 22.18 built-ins only, no runtime npm dependencies, no `npm install` anywhere in
  the gate (FR-11). Bash scripts must run on macOS (bash 3.2), Linux and Git Bash (ADR-0012).
- The factory cannot create Azure DevOps resources. It ships a **template** of C1 plus a way to
  materialise the complete repo tree, and tests run the pipeline's exact command locally.
- The plugin file, the validator, the installers and the personal template must not change.
- No real `az`, Azure DevOps or network in tests.

Facts verified against the Azure CLI `azure-devops` extension reference (learn.microsoft.com,
`az repos policy approver-count|required-reviewer|build create`, docs dated 2026-09) and the
extension source (`azext_devops/dev/repos/policy.py`, `dev/common/identities.py`):
- All three `create` commands **require** `--blocking`, `--branch`, `--enabled`, `--repository-id`
  plus: approver-count `--minimum-approver-count --creator-vote-counts --allow-downvotes
  --reset-on-source-push`; required-reviewer `--required-reviewer-ids --message`; build
  `--build-definition-id --display-name --manual-queue-only --queue-on-source-update-only
  --valid-duration`. `--org` takes an organization **URL**; `--project` a name or id.
- `--repository-id` is the repository **id** (GUID); the extension does not resolve names.
- `--required-reviewer-ids` is split on `;`; each entry is trimmed and passed to
  `resolve_identity_as_id`: a GUID is used as-is (no lookup), anything else is looked up in the
  identity service (`General` / `DirectoryAlias` search; ambiguous matches are an error).
- Build policy expiry: `--valid-duration 0` with `--queue-on-source-update-only false` means
  "expire immediately when the target branch is updated" (Pulumi azuredevops provider docs, which
  map to the same REST settings).
- Azure Pipelines YAML `pr:` triggers are **ignored for Azure Repos Git**; PR validation there is
  driven by the build-validation branch policy.

## Decision

### 1. Template sources live in `backend/shared-config/`; one manifest maps them to the C1 tree

```
backend/shared-config/            # every file here is copied to the C1 repo root
  kilo.jsonc                      # existing example (F-007, unchanged)
  azure-pipelines.yml             # NEW: PR validation pipeline
  set-branch-policies.sh          # NEW: platform-team branch-policy script (bash)
  package.json                    # NEW: {"type":"module"}, no dependencies (for the validator)
  .gitattributes                  # NEW: "* text eol=lf" (keeps .sh / .yml LF in C1 and here)
backend/tools/assemble-shared-repo.ts   # NEW: writes the complete C1 tree into an empty dir
```

The assembled C1 tree keeps `validator/` and `plugin/` at the **same relative layout as
`backend/`**, so the validator's `../plugin/azdo-remote-config.ts` import works unchanged:

```
<C1 root>/
  .gitattributes  azure-pipelines.yml  kilo.jsonc  package.json  set-branch-policies.sh
  validator/validate-kilo-config.ts  validator/kilo-config-rules.ts  validator/kilo-schema-subset.json
  plugin/azdo-remote-config.ts
  teams/<team>/kilo.jsonc          # optional, added by platform team / F-015, not by the tool
```

The assemble tool uses a **fixed constant manifest** (9 files, contract section 2), never a glob,
so nothing else from `backend/` can leak into C1. Copies are byte-identical (`copyFileSync` with
`COPYFILE_EXCL`). It refuses an existing non-empty or non-directory output path and never deletes
anything. The C1 `package.json` is a real reviewed file instead of generated text, so the bytes in
C1 are the bytes in this repo, and the byte-identity test covers it too.

Updating C1 later (new plugin / validator version) = run the tool into a fresh dir and copy the
tree over a C1 checkout in a PR (reviewed by the platform team). Documented by the docs writer
(F-016).

### 2. Pipeline (`azure-pipelines.yml`)

- `trigger: none` (no CI-push runs), `pr: branches: include: [main]` (kept for portability and
  intent; on Azure Repos the actual trigger is the blocking build-validation policy of section 3).
- `pool: vmImage: ubuntu-latest`; `checkout: self` with `fetchDepth: 1`, `persistCredentials: false`.
- `UseNode@1` with `version: "22.x"` (latest 22.x, which is >= 22.18), plus an in-step guard that
  fails with a fixed message on Node < 22.18 (self-hosted agents with old caches).
- **No npm step at all.** The validator has zero dependencies; Node runs the `.ts` files directly.
- One `bash:` step, using only bash builtins plus `node`:
  `shopt -s nullglob`, `files=(kilo.jsonc)`, append every `teams/*/kilo.jsonc`, then
  `node validator/validate-kilo-config.ts --allowed-hosts "$KILO_ALLOWED_HOSTS" -- "${files[@]}"`.
  A missing or empty `teams/` therefore adds no argument (never a usage error); a missing root
  `kilo.jsonc` is an I/O error (exit 2) and fails the gate, which is correct.
- **Allowed hosts**: YAML pipeline variable `KILO_ALLOWED_HOSTS`, default
  `bifrost.yourcompany.internal` (the host of the example `kilo.jsonc`), mapped explicitly into the
  step's environment. The host check is **always on** in the gate (the flag is always passed).
  It fails closed: an empty or undefined variable (the literal `$(KILO_ALLOWED_HOSTS)` reaches the
  script) is a validator usage error, exit 2. Changing the list means editing the YAML in a PR,
  which the required-reviewer policy routes to the platform team. Runtime `parameters:` were not
  used: they add nothing for automatic PR runs and invite queue-time overrides.
- The script body contains no `$(` (Azure macro syntax) so Azure never rewrites it, and the test
  can run the exact text locally.

### 3. Branch-policy script (`set-branch-policies.sh`, bash)

Bash rather than Node: it only builds three argv arrays and runs `az`; platform engineers already
have bash (macOS, Linux, Git Bash). bash 3.2 compatible, **only bash builtins plus `az`** (same rule
as `install.sh`, ADR-0012), so tests can run it with `PATH` holding nothing but a stub `az`.

- Flags (all required, `--flag value` form only): `--org`, `--project`, `--repository-id`,
  `--reviewer-group`, `--build-definition-id`; optional `--dry-run`, `--help`/`-h`.
  The branch is fixed to `main` (FR-14), so there is no `--branch` flag.
- Each command is built **once** as a bash array and is either printed (dry run, shell-quoted per
  the contract) or executed as `az "${cmd[@]}" </dev/null >/dev/null 2>&1`. One source of truth
  guarantees that the dry-run text and the real argv match. No `eval`, no `sh -c`, no string
  concatenation into a command line: each value is exactly one argv element.
- Exactly three commands, in order: `approver-count create` (min 1, blocking, creator vote does not
  count, rejections block, votes reset on push), `required-reviewer create` (the supplied group,
  blocking, fixed message), `build create` (the supplied definition id, blocking, automatic queue,
  expires immediately when `main` is updated). Every command carries `--org`, `--project`,
  `--repository-id`, `--branch main`, `--branch-match-type exact`, `--enabled true`,
  `--output none`. Exact argv: contract section 4.
- Input validation (fail before any `az` call, exit 2, never echo a value): org is a name or an
  `https://dev.azure.com/<org>` / `https://<org>.visualstudio.com` URL and is normalised to
  `https://dev.azure.com/<org>`. Restricting the host keeps a typo or a hostile value from sending
  the operator's credentials to another host (same fixed-host rule as the plugin, ADR-0007).
  `--repository-id` must be a GUID (the extension does not resolve names; the help text shows
  `az repos show --repository <name> --query id -o tsv`). `--build-definition-id` must be a positive
  integer. `--project` and `--reviewer-group` are free text (1..256 chars, no control characters,
  no leading `-`), and `--reviewer-group` must not contain `;` (az would split it into several
  reviewers).
- Credentials: the script accepts **no** PAT/token flag and never reads or expands
  `AZURE_DEVOPS_EXT_PAT`. `az` inherits the environment (az login or `AZURE_DEVOPS_EXT_PAT`). `az`'s
  stdout and stderr are discarded, so nothing az prints (which may include request details) is
  echoed. On failure the script prints a fixed message naming the policy and az's numeric exit
  code, stops, and exits 1. Earlier policies stay created (documented; no rollback).
- No idempotency in this slice (PO decision, T-023): re-running creates duplicate policies. The
  help text says so.

### 4. Testing approach

- `test/shared-config/assemble.test.ts`: spawns the tool into a temp dir; asserts the exact file
  set, byte identity against `backend/` sources, `package.json` (`type: module`, no
  `dependencies`), and refusal (exit 2, nothing written) for a non-empty dir or a file path.
- `test/shared-config/pipeline.test.ts`: text inspection of the YAML (no YAML parser and no new
  dev dependency). It extracts the `bash:` block by the indentation rule in the contract, writes it
  to a file, and runs it with an absolute `bash` (the `findBash` helper of the installer tests)
  in an assembled temp tree with `PATH=<tmp>/bin` holding only a `node` wrapper, and
  `KILO_ALLOWED_HOSTS` set to the YAML default.
- `test/shared-config/branch-policies.test.ts`: runs the script in child bash with `PATH=<tmp>/bin`
  holding only a recording stub `az` (NUL-separated argv, one record per call; optional failure
  on a named policy; it prints a PAT sentinel and markers to stdout and stderr to prove they are
  discarded). Injection payloads use builtins only (`$(printf x > f)`), because external commands
  are not on `PATH`.
- Static checks: LF only, `bash -n`, no `eval` / `sh -c` / `bash -c` / `source`, no
  `$AZURE_DEVOPS_EXT_PAT` expansion, no `npm` in the YAML.

### 5. Lint / build wiring

- FR-11 lint rule 8 (`tools/check-fr11.mjs`): every `.ts` file directly in `tools/` imports only
  `node:` built-ins and contains no `require(` (skipped when `tools/` has no `.ts` file).
- `tsconfig.json` `include` gains `"tools/**/*.ts"` (the assemble tool is type-checked).
- `scripts/ci.sh` needs no change (`node --test "test/**/*.test.ts"` picks up the new folder).
  ShellCheck stays optional (CI releaser may run it when present on `backend/**/*.sh`).

## Consequences

- C1 can be produced from any checkout with one command and contains exactly what the gate needs.
  The validator in C1 is byte-for-byte the tested one.
- C1 holds a copy of the plugin and validator; they drift if nobody re-assembles after a release.
  Accepted; F-016 documents the update procedure.
- The pipeline YAML, validator and plugin are part of the PR content, so a PR can weaken its own
  gate. This is inherent to Azure Pipelines YAML build validation. The mitigation is the
  required-reviewer policy (platform team on every PR to `main`, all paths). Residual risk is
  recorded for the Security engineer.
- Policy re-runs create duplicates until T-023.
- The reviewer-group value format is resolved by az, not by us: a group identity GUID is the most
  reliable value (no lookup); a display name such as `[<project>]\<group>` relies on az's identity
  search and can be ambiguous. This cannot be verified without a real organisation.

## Alternatives considered

- **Generate the C1 `package.json` inside the tool**: hidden bytes, not covered by byte-identity.
  Rejected for a real file in `shared-config/`.
- **Git submodule / npm package for the validator in C1**: needs network, registry or submodule
  credentials in the gate and an `npm install`. Rejected (FR-11, AC1).
- **Fetch the validator from this repo at pipeline time**: network plus a second trust root.
  Rejected.
- **Node `.ts` policy script**: works, but adds argv/process plumbing for a three-command task and
  `execFile` on Windows needs `az.cmd` handling (ADR-0007 complexity). Rejected for bash.
- **`--branch` flag**: FR-14 targets `main` only; fewer inputs, fewer mistakes. Can be added later.
- **Accept a repository name and resolve it with `az repos show`**: a fourth az call, extra failure
  mode and output parsing. Rejected; the help shows how to get the id.
- **Allowed hosts as a runtime `parameters:` entry or a variable group**: runtime parameters can be
  overridden at manual queue time and a variable group lives outside the reviewed repo. Rejected.
- **Skip the host check when the variable is empty**: weakens the gate silently. Rejected
  (fail closed).
- **Policy idempotency (`az repos policy list` + compare)**: out of scope (T-023).
