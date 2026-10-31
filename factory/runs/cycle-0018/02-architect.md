# Architect report — cycle 0018 — F-016: User and operator documentation

## Inputs read
- `factory/runs/cycle-0018/01-product-owner.md`, F-016 in `factory/backlog.json` (6 ACs, user decisions on F-012/F-013/F-015)
- `factory/VISION.md` (Phase 0 assumptions A1-A3, risks incl. `KILO_PURE=1`)
- `README.md`, `docs/user-guide.md`, `docs/development.md` ("What stays manual (Phase 0)"), `docs/api.md`
- `docs/architecture/ADR-0001-tech-stack.md`, `overview.md`, `README.md`, `contracts/validator-cli.md`
- `scripts/ci.sh`, `scripts/check-lf.sh`, `.gitattributes`, `backend/package.json`, `backend/tools/`, `backend/test/tools/check-fr11.test.ts`
- `.claude/skills/factory-cycle/SKILL.md` (phase order, dispatch on `scope.*`), agent lanes in `.claude/agents/*.md`

## Work done
- **Information architecture (ADR-0017, section 1).** The three new pages are task guides.
  `docs/user-guide.md` stays the reference, and nothing is moved out of it, so existing anchors keep
  working. Tables (flags, exit codes, smoke codes, log messages) are linked, not copied. Text that
  an AC requires on a page is repeated there on purpose.
- **Docs check placement (ADR-0017, section 2).** The check is `backend/tools/check-docs.mjs`
  (senior-backend), with hermetic tests in `backend/test/tools/check-docs.test.ts`. ci-releaser
  adds one line to `scripts/ci.sh`. This placement causes no lane violation. The tool goes through
  the security and review gates, unlike a tool under `scripts/`, which would only arrive in phase 7.
  It also follows the `check-fr11.mjs` precedent.
- **Exact rules.** `contracts/docs-check.md` 1.0.0 defines the CLI, output and exit codes, the
  parsing rules (fences, inline code, GitHub slugs, normalised text), 7 rule ids, the required
  phrase/regex/heading items per page (T1-T7, E1-E5, R1-R18) and 11 test obligations.
- **Prototype.** I ran a prototype of the link, anchor and secret rules over today's README.md and
  docs/**. All relative links and anchors resolve. There was one secret-scan hit: the 16-character
  example key in `contracts/validator-cli.md`. I shortened it to `sk-bf-AbCd1234`, which still
  matches the validator pattern. After the fix the scan is clean.
- **Other doc updates.** ADR-0001 (tool, layout, command row), `overview.md` (C6 marked skipped,
  layout, quality gate) and `docs/architecture/README.md` (contract index) are updated.

### Design summary of the check
`node backend/tools/check-docs.mjs [--root <dir>]` exits 0 on pass, 1 when there are findings,
and 2 on a usage or internal error. Each finding is printed to stderr as
`check-docs: FAIL <file>[:<line>]: <rule>: <message>`. Rules:
- `page-missing`
- `cross-link`: each page links to the other two, and README links to all three.
- `link-broken`: every relative link and anchor in README.md and docs/**/*.md.
- `required-text`
- `kilo-range`: the range is read with a regex from `backend/plugin/azdo-remote-config.ts` and never imported.
- `secret-key`: `/sk-bf-[A-Za-z0-9]{16,}/i` over README.md and docs/**/*.md with no exclusions. The value is never printed.
- `forbidden-text`: `provision`, `offboard`, `teams/` or `teams\`, `per-team` in all three new pages.

Line endings: CRLF-tolerant. `check-lf.sh` stays as it is (it covers `scripts/*.sh`), and no `.gitattributes` change is needed. FR-11 is unaffected.

## Page outlines (docs-writer)
Each page must satisfy `contracts/docs-check.md` section 5. Put each required phrase inside one
sentence, paragraph or list item. Line wrapping is fine. Do not put a list marker, table pipe or
`_emphasis_` inside a phrase. Never write the words provision*, offboard*, `teams/` or per-team on
these three pages. The first lines of every page link to the other two pages.

### `docs/engineer-setup.md` (audience: engineers)
1. What you get (2-3 lines) and links to the [platform runbook](platform-runbook.md) and [troubleshooting](troubleshooting.md).
2. **Supported Kilo versions**: `>=7.2.0 <8.0.0`, exactly as in `SUPPORTED_KILO_RANGE` (E1). Check the version of your Kilo CLI or VS Code extension. Versions outside the range are not supported until the platform team re-runs the Phase 0 checks.
3. **Prerequisites**: Node.js 22.18+; `az login` or `AZDO_PAT` (Code Read); a checkout of this repo; your Bifrost virtual key, which the platform team gives you. No procedure for how keys are created.
4. **Install on macOS/Linux**: the `install.sh` command (E2) and `KILO_BIFROST_KEY`. Link to user-guide `#installing-on-macos-and-linux-engineers` for the flag table.
5. **Install on Windows**: the `install.ps1` command (E3) with `powershell -NoProfile -ExecutionPolicy Bypass -File ...` (E4), and `Unblock-File backend\installer\install.ps1` for downloaded or zipped files (E5). Also: `-NoSmoke`; the "Rewritten by install.sh" header in `kilo.jsonc` is expected on Windows; the installer sets no ACLs, so protection relies on your profile folder's inherited ACLs (residual risk). Link to user-guide `#installing-on-windows-engineers`.
6. **What gets written**: a short list (plugin copy, personal `kilo.jsonc`, backups that contain keys). Never copy the personal config into a project directory. Link to user-guide sections.
7. **Verify**: the `smoke azdo: pass` / `smoke bifrost: pass` lines, and exit code 4 points to troubleshooting. Then start Kilo and check that the Bifrost models are listed.
8. **Updating**: shared config changes apply at the next Kilo start without re-installing. Re-run the installer to update the plugin file.
9. Next steps: link to troubleshooting.

### `docs/platform-runbook.md` (audience: platform team)
1. Scope and links to the other two pages. A **Bifrost virtual keys** paragraph with the exact sentence (R18): "Bifrost virtual keys are issued and disabled manually by the platform team outside this project." Add that this repository contains no tooling for it, and that the PR gate rejects keys in the shared config. No steps.
2. **Phase 0 checklist** (heading contains "Phase 0", R10): checkbox list.
   - A1 (config changed in Kilo's `config` hook reaches the provider and model list), A2 (Kilo passes plugin options to local-file plugins; if not, use `KILO_AZDO_*` env vars), A3 (Bifrost exposes an OpenAI-compatible `/v1` endpoint usable with `@ai-sdk/openai-compatible`), each with how to verify (R1-R3).
   - The manual checks: real Kilo CLI `/models` and the VS Code extension model list (R4-R6) against real Azure DevOps and Bifrost; Kilo's own loading of the `.ts plugin` and its path resolution (R7, R8); "a disabled virtual key is rejected by Bifrost at request time" (R9).
   - When to re-run it: before rollout, and on every Kilo upgrade (a range change needs a new ADR).
3. **Set up the shared config repo** (heading contains "shared config repo", R11): assemble with `node backend/tools/assemble-shared-repo.ts`, push to Azure Repos, edit `kilo.jsonc`. Link to user-guide `#setting-up-the-shared-config-repo-platform-engineers` for exit codes.
4. **Create the PR pipeline** (heading contains "pipeline", R12): pipeline from `azure-pipelines.yml`, `KILO_ALLOWED_HOSTS` pipeline variable (fails closed), note the definition id.
5. **Create the branch policies** (heading contains "branch polic", R13): `set-branch-policies.sh` (R14), `--dry-run` first, repository GUID via `az repos show`. Re-running creates duplicates (T-023). Link to the user-guide flag table.
6. **Restrict permissions** (heading contains "permissions", R15): a PR can change its own gate. Limit "Bypass policies when completing pull requests" (R16) and "Edit policies" (R17) to a small trusted group. Keep the platform team as required reviewer. Review changes to `azure-pipelines.yml`, `validator/` and `plugin/` with extra care.
7. **Changing the shared config**: branch, validate locally (`node validator/validate-kilo-config.ts --allowed-hosts <hosts> kilo.jsonc`), PR, review, merge. Engineers get the change at their next Kilo start, and the cache is the fallback. Choosing `defaults` or `enforce` mode. Never put an `apiKey` in the shared config.
8. **Upgrading Kilo or the plugin**: stay within the supported range. Engineers re-run the installer for plugin updates.

### `docs/troubleshooting.md` (audience: both)
1. Links to the other two pages. Start with Kilo's log messages (service `azdo-remote-config`), and link to user-guide `#troubleshooting-log-messages` for the full table.
2. **Plugin does not load at all**: `KILO_PURE=1` disables external plugins (T1). Include the exact phrase (T2): "CI jobs that need the shared config must not set KILO_PURE=1". Show how to check `KILO_PURE` in bash and PowerShell. Kilo version outside the supported range. A plugin copy in `~/.config/kilo/plugin/` loads twice.
3. **Azure DevOps authentication**: `az login` (T3), or `AZDO_PAT` / `AZURE_DEVOPS_EXT_PAT` / `KILO_AZDO_PAT`. What `http-401`, `http-403` and `http-404` mean.
4. **Stale or missing shared config / cache**: `~/.cache/kilo-azdo/remote-config.json` (T4) (on Windows under `%USERPROFILE%`). When it is used, and that you can delete it to reset.
5. **Installer exit codes**: a short 0-4 list. Exit code 4 (T5) means installed but the smoke test failed, and the installation is kept. Offline machines: `--no-smoke` (T6) on macOS/Linux, `-NoSmoke` (T7) on Windows. Link to user-guide `#smoke-test` for the per-code table.
6. **Windows**: execution policy errors, `Unblock-File`, and `.cmd` node shims. Link to the user-guide Windows troubleshooting section.
7. **Bifrost 401 / key rejected**: the key is wrong or disabled. Contact the platform team. No procedure.
8. **Asking for help**: what to include, and never paste a key or PAT.

### Edits to existing docs (docs-writer)
- `README.md`: link all three pages, for example in the product "More:" line. Add a link to the runbook in "Still manual (Phase 0)".
- `docs/user-guide.md`:
  - Line 9 is stale ("Not yet available ... key provisioning and the Azure Pipelines PR gate (F-008)"). The PR gate shipped. State that key provisioning is not part of this project.
  - Add pointers to the three pages near the top. The "Security caveat" subsection links to the runbook permissions section.
  - The Windows "Exit codes and smoke test" link `[macOS and Linux](#exit-codes)` resolves to the **validator** "Exit codes" heading. Change it to `#exit-codes-1`.
- `docs/development.md` "What stays manual (Phase 0)": keep the heading, because its anchor is linked. Replace "for F-016 to fold into the runbook" with a link to `platform-runbook.md`.

## Backend tasks
Owner: **senior-backend**. Dispatch this even though `scope.backend` is `false`: this is tooling, not product code (ADR-0017, section 2).

| # | Task | Files | Maps to AC |
|---|---|---|---|
| B1 | Implement the docs check exactly as specified in `docs/architecture/contracts/docs-check.md` sections 1-5: CLI with `--root`/`--help`, exit codes 0/1/2, finding format, all 7 rules, required items T1-T7, E1-E5, R1-R18, CRLF tolerance, sorted output, secret value never printed. Plain ES module, `node:` imports only, no `require(`, no writes, no network, no child processes. Never import the plugin; read it as text. | create `backend/tools/check-docs.mjs` | AC1-AC6 |
| B2 | Hermetic tests: all 11 cases in contract section 6. Use temp-dir fixtures, `spawnSync(process.execPath, [script, "--root", root])`, and cleanup. The fake plugin range is `>=9.1.0 <10.0.0`. Build the fake key at runtime: no literal `sk-bf-` followed by 16 or more alphanumerics in the source. | create `backend/test/tools/check-docs.test.ts` | AC1-AC6 negative controls |
| B3 | Do **not** add the tool to `npm run lint` or `npm test` against the real repo, and do not change `plugin/`, `package.json` dependencies or `check-fr11.mjs`. | (none) | ADR-0017 |
| B4 | Verify: `cd backend && npm run lint && npm run typecheck && npm test` pass. Running `node tools/check-docs.mjs` against the real repo is **expected to fail** now (the pages do not exist yet). Record its output in your report as the baseline. It should show only `page-missing` and `cross-link` findings, plus `required-text`/`kilo-range` for absent pages if any. Any `link-broken` or `secret-key` finding is a defect in the tool or in existing docs. Report it. | - | - |

## Frontend tasks
None. `frontend/` does not exist and is not planned (ADR-0001). Do not dispatch senior-frontend.

## Docs tasks (docs-writer, phase 6)
| # | Task | Files | Maps to AC |
|---|---|---|---|
| D1 | Write `docs/engineer-setup.md` following the outline above. | create | AC1, AC3, AC5, AC6 |
| D2 | Write `docs/platform-runbook.md` following the outline above, including the R18 sentence verbatim. | create | AC1, AC4, AC5, AC6 |
| D3 | Write `docs/troubleshooting.md` following the outline above, including the T2 sentence verbatim. | create | AC1, AC2, AC5, AC6 |
| D4 | Make the edits to existing docs listed above (README links to all three, user-guide fixes, development.md pointer). | modify `README.md`, `docs/user-guide.md`, `docs/development.md` | AC1 |
| D5 | Run `node backend/tools/check-docs.mjs` from the repo root and reach exit 0 before reporting PASS. If it flags something you believe is a check bug, report it. Do not work around it with odd wording. | - | all |

## CI / release tasks (ci-releaser, phase 7 prepare)
| # | Task | Files |
|---|---|---|
| C1 | In `scripts/ci.sh`, add `node backend/tools/check-docs.mjs` after `bash scripts/check-lf.sh`. Guard it with `[ -f backend/tools/check-docs.mjs ]` only if needed for robustness; it exists after this cycle. Keep the file LF-only. | modify `scripts/ci.sh` |
| C2 | No change to `check-lf.sh` or `.gitattributes` is required (ADR-0017, section 4). | - |

## Security notes (for the security engineer)
- **Secret scan scope.** README.md and every `*.md` under docs/, recursive, including `docs/architecture/`. Nothing is excluded. Check that the tool never echoes the matched value (stdout and stderr), and that the test builds its key at runtime so gitleaks and the repo do not hold a key-like literal.
- **Path handling.** Link targets must not escape `--root`: after `path.resolve`, the path relative to the root must not start with `..` and must not be absolute. Absolute targets are rejected. Symlinks are skipped (`lstat`), not followed, so a planted link cannot lead to reads outside the tree or loop forever.
- **Read-only.** No writes, network or subprocesses. The plugin is read as text and never imported or executed. That matters because importing would run module code.
- **ReDoS.** All regexes are linear: no nested quantifiers over overlapping classes. Inputs are repo files.
- **Content.** The pages must not show real keys or PATs. Examples use `sk-bf-...` / `sk-bf-<your-virtual-key>`. The runbook keeps the permission-hardening advice and must not weaken it. The pages contain no key provisioning or offboarding procedure (user decision).

## Files changed
- `docs/architecture/ADR-0017-docs-information-architecture-and-check.md`: new ADR (IA, placement, rules, line endings).
- `docs/architecture/contracts/docs-check.md`: new contract 1.0.0 (CLI, parsing, rules, required items, test obligations).
- `docs/architecture/contracts/validator-cli.md`: shortened the 16-character example key so the new secret scan passes. Same meaning.
- `docs/architecture/ADR-0001-tech-stack.md`: lint section note, layout entry and command row for `check-docs.mjs`.
- `docs/architecture/overview.md`: header, contracts list, C6 marked skipped, directory layout, quality gate.
- `docs/architecture/README.md`: contract index.
- `factory/runs/cycle-0018/02-architect.md`: this report.

## Verification
- Prototype scan (scratch script, not committed) of the link, anchor and `sk-bf-` rules over README.md and the 30 `*.md` files under docs/:
  - Before the fix: 0 broken links or anchors, and 1 key hit in `contracts/validator-cli.md:107`.
  - After the fix: 0 problems.
- `git diff --stat` shows small diffs only. Git warned about CRLF conversion for the edited `.md` files, which is harmless.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | docs/architecture/contracts/validator-cli.md:107 | The example key had 16 alphanumerics and would fail the AC-5 scan. | Fixed in this phase. |
| 2 | low | docs/user-guide.md:540 | `[macOS and Linux](#exit-codes)` points to the validator's "Exit codes" heading, not the installer's (`#exit-codes-1`). | docs-writer D4 |
| 3 | low | docs/user-guide.md:9 | Stale: says the Azure Pipelines PR gate (F-008) is not yet available. | docs-writer D4 |
| 4 | info | factory/backlog.json (F-016 scope) | `scope.backend=false`, but this design needs senior-backend for the tool. | Orchestrator dispatches senior-backend for the Backend tasks. |

## Assumptions made (no human available)
- The check lives in `backend/tools/`, not `scripts/`. This option has no lane violations, and it is the only one where the code passes through the security and review gates before the PR.
- Fixed required phrases (T2, R9, R18) replace semantic checks such as "mentions CI near KILO_PURE", so the check is deterministic.
- The forbidden-term scan covers all three new pages, not only the two named in AC-6. This is more conservative, and troubleshooting has no need for these words. Existing reference docs are not scanned for these terms, because they correctly describe the shipped validator (`teams/*/kilo.jsonc`) and the generic `path` setting.
- The link check covers every relative link in README.md and docs/**/*.md (today all of them resolve), not only the new pages.
- Nothing moves out of user-guide.md, so anchors stay stable.
- GitHub remote-mode and PR flow is factory content. The root README already covers it, and the product pages leave it out.

## Follow-ups for the backlog
- (chore, priority 4) Consider moving the platform sections of `docs/user-guide.md` (validator usage, shared config repo setup) into `docs/platform-runbook.md`, with redirect stubs, to remove the remaining duplication.
- (chore, priority 5) Extend `check-docs` so that every `>=X.Y.Z <A.B.C` range in README.md and docs/*.md equals `SUPPORTED_KILO_RANGE` (user-guide.md and README also state it).
- (chore, priority 5) Optional `.gitattributes` rule `*.md text eol=lf` to stop CRLF warnings on Windows checkouts.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0018/02-architect.md
summary: F-016 design: task-guide pages over the user-guide reference, docs gate backend/tools/check-docs.mjs (senior-backend, hermetic tests) wired into scripts/ci.sh by ci-releaser; ADR-0017 + contracts/docs-check.md.
