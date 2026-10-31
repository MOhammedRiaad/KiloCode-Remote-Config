# Contract: shared config repo (C1) template, assemble tool, PR pipeline, branch-policy script

- Version: 1.0.0 (F-008, cycle-0015). Decision record: ADR-0015 (extends ADR-0010).
- Owner: Architect. Implemented by: `backend/shared-config/*`, `backend/tools/assemble-shared-repo.ts`.
- Consumers: the platform team (creates the Azure DevOps `kilo-config` repo, pipeline and policies),
  F-015 (per-team files), F-016 (runbook), tests under `backend/test/shared-config/`.
- The validator CLI used by the pipeline is specified in `validator-cli.md` (unchanged).

## 1. Template files (`backend/shared-config/`)

All files are UTF-8, no BOM, LF only, ending with one `\n`.

| File | Content contract |
|---|---|
| `kilo.jsonc` | Unchanged (validator-cli.md section 9). |
| `azure-pipelines.yml` | Section 3. |
| `set-branch-policies.sh` | Section 4. |
| `package.json` | Exactly the JSON below (2-space indent). No `dependencies`, no `devDependencies`, no `scripts`. |
| `.gitattributes` | Exactly one line: `* text eol=lf` |

```json
{
  "name": "kilo-config",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.18.0"
  }
}
```

## 2. Assemble tool

```
node backend/tools/assemble-shared-repo.ts <outdir>
node backend/tools/assemble-shared-repo.ts --help | -h
```

Manifest (constant in the tool, exactly these 9 files, in this order; no globbing):

| # | Source (relative to `backend/`) | Target (relative to `<outdir>`) |
|---|---|---|
| 1 | `shared-config/.gitattributes` | `.gitattributes` |
| 2 | `shared-config/azure-pipelines.yml` | `azure-pipelines.yml` |
| 3 | `shared-config/kilo.jsonc` | `kilo.jsonc` |
| 4 | `shared-config/package.json` | `package.json` |
| 5 | `shared-config/set-branch-policies.sh` | `set-branch-policies.sh` |
| 6 | `validator/validate-kilo-config.ts` | `validator/validate-kilo-config.ts` |
| 7 | `validator/kilo-config-rules.ts` | `validator/kilo-config-rules.ts` |
| 8 | `validator/kilo-schema-subset.json` | `validator/kilo-schema-subset.json` |
| 9 | `plugin/azdo-remote-config.ts` | `plugin/azdo-remote-config.ts` |

Behaviour:
- `backend/` is located from `import.meta.url` (`..` of `tools/`), never from the cwd.
- `<outdir>` is resolved against the cwd. Allowed: it does not exist (created with
  `mkdir -p` semantics) or it is an **empty directory** (checked with `lstat`; a symlink is refused).
- Order: (1) parse args, (2) check `<outdir>`, (3) `stat` every source, which must be a regular
  file, (4) create `validator/` and `plugin/`, (5) copy each file with
  `copyFileSync(src, dst, constants.COPYFILE_EXCL)`, (6) on non-Windows `chmod 0o755`
  `set-branch-policies.sh` (others keep the default mode). Nothing is ever deleted; after an I/O
  failure in step 4-6 partial output may remain.
- Output (stdout, success): `assemble-shared-repo: wrote 9 files`. The output path is never printed.
- Imports: `node:` built-ins only (FR-11 lint rule 8). Erasable TypeScript; type-checked.

| Exit | Meaning | stderr (fixed text) |
|---|---|---|
| 0 | Tree written (or `--help`, usage on stdout) | - |
| 1 | A source is missing / not a regular file, or an I/O error while writing | `assemble-shared-repo: missing source file <manifest source path>` or `assemble-shared-repo: cannot write output (<CODE>)` (`CODE` = `err.code` if `/^[A-Z0-9_]+$/`, else `UNKNOWN`) |
| 2 | Usage: no argument, more than one argument, any other option starting with `-`, `<outdir>` exists and is not an empty directory | `assemble-shared-repo: usage error: <expected one output directory \| unknown option \| output directory must be empty or absent>` followed by the usage text. The offending value is never printed. |

## 3. Pipeline (`backend/shared-config/azure-pipelines.yml`)

Normative text (comments may be reworded; keys, values, step order and the script body are
normative). Two-space indentation, no tabs.

```yaml
# Azure Pipelines PR gate for the shared Kilo config repo (kilo-config).
# Contract: docs/architecture/contracts/shared-config-repo.md (ADR-0015).
# Azure Repos Git ignores the pr: block; the PR trigger is the blocking build-validation
# policy on main created by set-branch-policies.sh.

trigger: none

pr:
  branches:
    include:
      - main

pool:
  vmImage: ubuntu-latest

variables:
  # Comma-separated host names allowed in provider.*.options.baseURL (your Bifrost host).
  KILO_ALLOWED_HOSTS: bifrost.yourcompany.internal

steps:
  - checkout: self
    fetchDepth: 1
    persistCredentials: false

  - task: UseNode@1
    displayName: Use Node.js 22.x (22.18 or later)
    inputs:
      version: "22.x"

  - bash: |
      set -euo pipefail
      node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 18)) { console.error("kilo-config gate: Node.js 22.18 or later is required"); process.exit(1); }'
      shopt -s nullglob
      files=(kilo.jsonc)
      for f in teams/*/kilo.jsonc; do files+=("$f"); done
      node validator/validate-kilo-config.ts --allowed-hosts "$KILO_ALLOWED_HOSTS" -- "${files[@]}"
    displayName: Validate kilo.jsonc and teams/*/kilo.jsonc
    env:
      KILO_ALLOWED_HOSTS: $(KILO_ALLOWED_HOSTS)
```

Rules the tests rely on:
- Exactly one line `trigger: none`; a `pr:` block whose `include` list contains `main`.
- Exactly one `UseNode@1` task with `version: "22.x"`; the script guard enforces >= 22.18.
- The file contains none of `npm install`, `npm ci`, `npm i `, `npx`, `yarn`, `pnpm`.
- **Script extraction rule**: the script is the lines after the single line that equals
  `  - bash: |`, up to (not including) the first following line that is non-empty and has fewer
  than 6 leading spaces; the first 6 characters of each line are removed. The extracted script
  contains `validate-kilo-config.ts`, `--allowed-hosts`, `kilo.jsonc` and `teams/*/kilo.jsonc`,
  and contains no `$(`.
- **Default hosts rule**: exactly one line matches `^  KILO_ALLOWED_HOSTS: ([a-z0-9.,-]+)$`;
  group 1 is the default value.
- The script uses only bash builtins plus `node` (runs with `PATH` = a dir holding only `node`).

Exit behaviour of the step: `0` when the validator exits 0; otherwise non-zero (validator `1`
for findings, `2` for usage/I/O, guard `1` for old Node), which fails the job and therefore the
blocking build policy.

## 4. Branch-policy script (`backend/shared-config/set-branch-policies.sh`)

```
bash set-branch-policies.sh --org <org> --project <project> --repository-id <guid>
                            --reviewer-group <group> --build-definition-id <n> [--dry-run]
bash set-branch-policies.sh --help | -h
```

Implementation constraints: `#!/usr/bin/env bash`, `set -u`, bash 3.2 compatible (no `${x,,}`,
no associative arrays, no `mapfile`), **only bash builtins plus `az`**; no `eval`, no `sh -c` /
`bash -c`, no `source` / `.`; never expands `AZURE_DEVOPS_EXT_PAT` (the name may appear in help
text only); each command is a bash array used both for printing and executing.

### 4.1 Arguments

- Help scan first: if any argument is exactly `--help` or `-h`, print usage to stdout, exit 0.
- Only the separate form `--flag value` is accepted (`--org=x` is an unknown option).
- A value is "missing" if it is absent, empty or starts with `-`.

| Flag | Required | Validation (failure = usage error, exit 2) | Used as |
|---|---|---|---|
| `--org` | yes | Org name `^[A-Za-z0-9]([A-Za-z0-9-]{0,48}[A-Za-z0-9])?$`, or `https://dev.azure.com/<name>` or `https://<name>.visualstudio.com`, each with an optional trailing `/` | `--org https://dev.azure.com/<name>` (always normalised) |
| `--project` | yes | Text rule | `--project <value>` |
| `--repository-id` | yes | GUID `^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$` | `--repository-id <value>` |
| `--reviewer-group` | yes | Text rule, and contains no `;` | `--required-reviewer-ids <value>` |
| `--build-definition-id` | yes | `^[1-9][0-9]{0,9}$` | `--build-definition-id <value>` |
| `--dry-run` | no | takes no value | print instead of execute |

Text rule: 1..256 characters, no control character (`[[:cntrl:]]`), does not start with `-`.
Any other argument starting with `-` is an unknown option; any other argument is an unexpected
argument; a flag given twice is an error.

### 4.2 The three commands (normative argv, in this order)

`<ORG>` = normalised org URL, `<P>` project, `<R>` repository id, `<G>` reviewer group,
`<N>` build definition id.

```
az repos policy approver-count create --org <ORG> --project <P> --repository-id <R> --branch main --branch-match-type exact --enabled true --blocking true --minimum-approver-count 1 --creator-vote-counts false --allow-downvotes false --reset-on-source-push true --output none
az repos policy required-reviewer create --org <ORG> --project <P> --repository-id <R> --branch main --branch-match-type exact --enabled true --blocking true --required-reviewer-ids <G> --message "Platform team review is required for shared Kilo config changes." --output none
az repos policy build create --org <ORG> --project <P> --repository-id <R> --branch main --branch-match-type exact --enabled true --blocking true --build-definition-id <N> --display-name "kilo-config PR validation" --manual-queue-only false --queue-on-source-update-only false --valid-duration 0 --output none
```

(The two quoted strings above are each one argv element.)

`<G>` is passed verbatim; az resolves it (`resolve_identity_as_id`): a group identity GUID is
used without lookup (recommended); a display name such as `[<project>]\<group>` is searched in the
identity service and must match exactly one identity.

### 4.3 Dry run (`--dry-run`)

- Validation as above (usage errors still exit 2). `az` is neither looked up nor invoked.
- stdout is **exactly three lines**, one per command, in order: the word `az`, then each argv
  element separated by one space. Quoting rule per element: if it consists only of characters in
  `A-Z a-z 0-9 _ . / : = @ % + , -` it is printed as-is; otherwise it is wrapped in single quotes
  with every `'` written as `'\''`. Each line is therefore a valid POSIX shell command that
  reproduces the argv exactly.
- Exit 0. Nothing on stderr.

### 4.4 Real run

1. If `az` is not found (`command -v az` fails): stderr
   `set-branch-policies: az was not found on PATH (install the Azure CLI and its azure-devops extension)`, exit 1.
2. For each command in order: run `az "${cmd[@]}" </dev/null >/dev/null 2>&1`.
   - Success: stdout `set-branch-policies: created <policy> policy on main`.
   - Failure (az exit code `c != 0`): stderr
     `set-branch-policies: failed to create the <policy> policy (az exit <c>); later policies were not created. Check az login or AZURE_DEVOPS_EXT_PAT, the ids and your permissions; run with --dry-run to see the commands.`
     and exit 1 immediately. Already created policies are kept.
   `<policy>` is `approver-count`, `required-reviewer` or `build`.
3. After all three: stdout `set-branch-policies: done (3 policies created; re-running creates duplicate policies)`, exit 0.

### 4.5 Usage errors (exit 2, stderr, az never invoked)

`set-branch-policies: usage error: <reason>` lines (one per problem; the order is not normative),
then the usage text. Reasons (fixed text, the offending value or argument is **never** printed):

| Reason |
|---|
| `unknown option` |
| `unexpected argument` |
| `<flag> requires a value` |
| `<flag> given more than once` |
| `missing required option <flag>` |
| `invalid value for --org (expected an organization name or https://dev.azure.com/<org>)` |
| `invalid value for --repository-id (expected the repository GUID)` |
| `invalid value for --build-definition-id (expected a positive integer)` |
| `invalid value for <--project or --reviewer-group>` |

The usage text lists the flags, states that authentication uses `az login` or the
`AZURE_DEVOPS_EXT_PAT` environment variable and that no token argument exists, shows
`az repos show --repository <name> --query id -o tsv` for the repository id, and states that
re-running creates duplicate policies.

### 4.6 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (dry run printed, or all three policies created), or `--help` |
| 1 | `az` not found, or an `az` call failed (the run stopped at that call) |
| 2 | Usage error (az never invoked) |

### 4.7 Output guarantees

- No environment variable value is ever printed. `az`'s stdout and stderr are never printed.
- Values appear only in dry-run lines (they are the operator's own validated inputs, free of
  control characters).
