# Security report — cycle 0015 — F-008: Shared config repo: Azure Pipelines PR gate and branch policy setup

## Inputs read
- `git diff main...HEAD` (branch `factory/F-008-shared-config-repo-azure-pipelines-pr-ga`, tree clean)
- `factory/runs/cycle-0015/02-architect.md` (security notes 1-7), `03-backend.md`
- `docs/architecture/ADR-0015-shared-config-repo-pipeline-and-branch-policy.md`
- `docs/architecture/contracts/shared-config-repo.md`
- `backend/shared-config/{azure-pipelines.yml,set-branch-policies.sh,package.json,.gitattributes}`
- `backend/tools/assemble-shared-repo.ts`, `backend/tools/check-fr11.mjs` (rule 8)
- `backend/test/shared-config/*.ts`, `backend/test/tools/check-fr11.test.ts`, `backend/test/installer/helpers.ts` (`findBash`)
- `backend/validator/*` (`parseAllowedHosts`, `--allowed-hosts` parsing) for fail-closed behaviour

## Work done
- **Secrets**: grepped the added lines for key/token/private-key patterns and for committed `.env`/`.pem`/`.key` files. The only hit is the dummy `sk-bf-AbCdEf1234567890` in AC text in `factory/backlog.json`. It was already on `main` (5 occurrences). Tests build the fake value at runtime (`"sk-" + "bf-" + ...`).
- **set-branch-policies.sh**:
  - Injection: no `eval`, `-c`, `source` or command substitution on values. Every value is a single element of a bash array passed as `az "${cmd[@]}"`.
  - Option smuggling: values that start with `-` are rejected. `;` is rejected in the reviewer group, so no extra reviewer ids can be added.
  - Org: only a bare name or a `dev.azure.com` / `*.visualstudio.com` URL is accepted, and it is always rewritten to `https://dev.azure.com/<name>`. I probed `https://evil.com/x.visualstudio.com`, `https://dev.azure.com//acme`, `https://dev.azure.com/acme?x=1` and `.../acme//`: all exit 2. `acme/` and `https://ACME.visualstudio.com/` are normalised.
  - Other checks: GUID and build-id regexes are anchored, and control characters are rejected.
  - Secrets and output: `AZURE_DEVOPS_EXT_PAT` is never expanded (the name appears only in help and fixed messages). az runs with `</dev/null >/dev/null 2>&1`. Usage errors are fixed text and never echo values.
  - Exit codes: 0 on success, 1 when az is missing or fails, 2 on usage errors.
  - Dry-run quoting: checked on bash 5.3 with `O'Brien` and `a&b\c` (the `patsub_replacement` edge case). The output is correct.
  - bash 3.2: reviewed statically, no 4.x-only constructs found. `"${problems[@]}"` is only expanded when the array is non-empty.
- **Pipeline**:
  - The step has no npm, npx, yarn, pnpm or install step. `persistCredentials: false` is set and `System.AccessToken` is not mapped.
  - The script has no `$(` or `${{` macro. `KILO_ALLOWED_HOSTS` reaches the script only through `env:` and is used quoted.
  - Fail-closed: if the variable is empty, the validator gets an empty list and exits 2 (`parseAllowedHosts` returns undefined). If it is undefined, Azure leaves the literal `$(KILO_ALLOWED_HOSTS)`, which fails `HOST_ENTRY`, so the step also fails. If it is absent from the environment, `set -u` aborts the step.
  - `nullglob` plus an array plus `--` handles a missing or empty `teams/` and team names that are odd or start with `-`.
- **Self-modifying gate**:
  - The documented mitigation (blocking required-reviewer on all paths, plus approver-count where the creator's vote does not count and votes reset on push) is accurate.
  - Running the validator from the target branch is **not** an effective cheap fix. Build validation reads the YAML from the PR's merge ref, so the PR can delete that fetch step. It would also need a repo token, which reverses `persistCredentials: false`.
  - The real stronger control is costly: an `extends:` template in a separately protected repo, enforced with a "Required template" check on a protected resource (for example a self-hosted pool) and pipeline permissions that block other pools. This is a backlog item, not a gate blocker.
- **Assemble tool**:
  - Fixed 9-file manifest with no globbing. The output dir is checked with `lstat`, so a symlink, a file or a non-empty directory is refused with exit 2.
  - Copies use `COPYFILE_EXCL`, nothing is deleted, no paths are printed, and the I/O error code is sanitised (`/^[A-Z0-9_]+$/`).
  - The backend root is found from `import.meta.url`. A test checks the copies are byte-identical.
- **FR-11 rule 8**: `tools/*.ts` may import only `node:` modules and may not use `require(`. Tests cover a relative import, a bare package, `../plugin` and `require`.
- **Test hermeticity**:
  - Every bash run uses `PATH=<tmp>/bin`, which holds only stub `node`/`az` or nothing, and `HOME=<tmp>/home`. On Windows only SYSTEMROOT, ComSpec, TEMP and TMP are added. Real az, the network and the real home are never reached.
  - The az-less runs (dry run, "a missing az") have no az anywhere on PATH, so the F-019 lesson holds: nothing real is spawned.
  - The stub az prints the PAT sentinel and stdout/stderr markers, and the tests assert none of them reach the output.

## Files changed
- `factory/runs/cycle-0015/04-security.md` — this report (no source changes).

## Verification
- `node --test "test/shared-config/*.test.ts"` → 59 tests, 58 pass, 1 skipped (POSIX chmod on Windows), 0 fail.
- `node --test test/tools/check-fr11.test.ts` → pass. `node tools/check-fr11.mjs` → `check-fr11: PASS`.
- `npm audit --omit=dev --audit-level=high` (backend) → found 0 vulnerabilities.
- Manual probes of `set-branch-policies.sh` with `PATH=/nonexistent`: the org cases listed above, `--project @/etc/passwd` (accepted, see finding 1), no arguments (exit 2, fixed messages), and az missing (exit 1, fixed message).
- ShellCheck is not installed locally; not run.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/shared-config/set-branch-policies.sh:107-115 | The text rule accepts values that start with `@`. Azure CLI treats `@<path>` argument values as "load from file", so `--project @~/.ssh/id_rsa` or `--reviewer-group @file` would read a local file and send its contents to dev.azure.com as a project name or reviewer id. Only the operator supplies these inputs (no trust boundary is crossed), so the impact is limited to an operator's own mistake. | Backlog: make `text_ok` reject a leading `@` as well as `-`. Add a usage-error test, and add it to contract section 4.1. |
| 2 | low | backend/shared-config/set-branch-policies.sh:166 | Expiry semantics of `--valid-duration 0 --queue-on-source-update-only false` are unverified. ADR-0015 cites Pulumi as "expire immediately when main is updated", but provider docs describe `validDuration 0` as "build does not expire" in some versions. If so, a PR validated against an older `main` (for example before the allow-list was tightened) can complete without re-validation. The required reviewer still applies. | Backlog (F-016 / T-023): check in a real org (policy JSON after creation) and pick the settings that mean "Immediately when main is updated". Update the contract and tests. |
| 3 | info | docs/architecture/ADR-0015 (Consequences) | A PR can change its own gate (pipeline YAML, validator). The documented mitigation through the required-reviewer policy is accurate. Running the validator from the target branch would not be effective, because the YAML comes from the PR. | Backlog: F-016 runbook should restrict "Bypass policies" / "Edit policies" permissions on `kilo-config`. Optional later hardening: an `extends` template in a protected repo with a Required-template check. |
| 4 | info | set-branch-policies.sh:165 | az cannot set `creatorVoteCounts` on the required-reviewer policy. If an author's own vote counts there, a platform-team author plus any other contributor's approval satisfies both policies (architect note 1). | Backlog: check in a real org and, if needed, set `creatorVoteCounts=false` through REST / `az devops invoke`. |
| 5 | info | factory/backlog.json | The dummy `sk-bf-AbCdEf1234567890` appears in AC text. It was already on main, is not a real secret, and gitleaks has passed on main so far. | None. |

## Assumptions made (no human available)
- No bash 3.2 binary is available here. Compatibility was judged by static review and the existing bash 5.3 run.
- Azure CLI's `@file` argument expansion is taken from known azure-cli core behaviour. It was not run, because tests and probes must never call a real az.

## Follow-ups for the backlog
- Reject a leading `@` in `--project` / `--reviewer-group` (finding 1).
- Verify the build-policy expiry settings in a real org (finding 2).
- F-016 runbook: lock down bypass and edit-policy permissions, and verify the required-reviewer creator vote (findings 3, 4).
- Optionally run ShellCheck on `backend/**/*.sh` in CI when it is available.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0015/04-security.md
summary: F-008 passes the security gate. No critical, high or medium findings; 2 low and 3 info findings go to the backlog (leading-@ az file expansion, unverified build-expiry semantics, gate self-modification and creator-vote policy residuals).
