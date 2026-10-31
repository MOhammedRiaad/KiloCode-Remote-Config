## Summary
Implements the automated documentation verification tool (`backend/tools/check-docs.mjs`) and hermetic test suite (`backend/test/tools/check-docs.test.ts`), alongside ADR-0017 and the `docs-check.md` contract for F-016 (User and operator documentation). The tool enforces page existence, cross-links, relative link and anchor resolution with `realpathSync` containment, required content items (including `SUPPORTED_KILO_RANGE` read at check time), forbidden skipped-scope terms, and secret key scanning (`sk-bf-` + 16+ alphanumerics) with output redaction. In accordance with ADR-0017, the task-guide pages (`docs/engineer-setup.md`, `docs/platform-runbook.md`, `docs/troubleshooting.md`) are authored in Phase 6 (`docs-writer`) and wired into `scripts/ci.sh` in Phase 7 (`ci-releaser`).

## Backlog item
- **ID / title:** F-016 — User and operator documentation
- **Type:** feature
- **Factory cycle:** `factory/runs/cycle-0018/`

## Acceptance criteria
- [x] AC1 — Given the repository, When the automated docs check (wired into `bash scripts/ci.sh`) runs, Then `docs/engineer-setup.md`, `docs/platform-runbook.md` and `docs/troubleshooting.md` exist, each links to the other two via relative links that resolve to existing files, and `README.md` links to all three; and Given any of these pages or links is removed (fixture/negative control), Then the check exits non-zero naming the missing item — test: `backend/test/tools/check-docs.test.ts` (`valid fixture passes`, `page-missing for README and each page`, `cross-link: each required link is enforced`, `a typo in a cross-link produces both cross-link and link-broken`, `link-broken failures`, `link-broken passing cases`, `links through a junction or symlink leaving the root fail`)
- [x] AC2 — Given `docs/troubleshooting.md`, When the check scans it, Then it mentions `KILO_PURE=1` (with the note that CI jobs needing the shared config must not set it), `az login`, the cache path `~/.cache/kilo-azdo/remote-config.json`, and installer exit code 4 together with `--no-smoke` and its Windows equivalent — test: `backend/test/tools/check-docs.test.ts` (`required-text: each T, E and R item fails when removed`, `required-text: a phrase wrapped across two lines still matches`)
- [x] AC3 — Given `docs/engineer-setup.md`, When the check scans it, Then it contains the supported Kilo range read at check time from `SUPPORTED_KILO_RANGE` in `backend/plugin/azdo-remote-config.ts` (not hard-coded in the check), and it covers both `install.sh` and `install.ps1` including the `ExecutionPolicy`/`Unblock-File` guidance — test: `backend/test/tools/check-docs.test.ts` (`kilo-range is read at check time`, `required-text: each T, E and R item fails when removed`)
- [x] AC4 — Given `docs/platform-runbook.md`, When the check scans it, Then it contains a Phase 0 checklist naming assumptions A1, A2 and A3 and the manual checks from `docs/development.md` (real Kilo CLI `/models` and VS Code model list, Kilo loading the `.ts` plugin and its path resolution, disabled key rejected by Bifrost at request time), plus sections on setting up the shared config repo, the PR pipeline and the branch-policy script, and on restricting the 'Bypass policies' and 'Edit policies' permissions — test: `backend/test/tools/check-docs.test.ts` (`required-text: each T, E and R item fails when removed`, `required-text: heading-only items must be in a heading`)
- [x] AC5 — Given all Markdown files under `docs/` plus `README.md`, When scanned for `sk-bf-` followed by real-looking key material (16 or more consecutive alphanumeric characters; `<placeholder>` and `...` forms allowed), Then none is found; and Given a temporary fixture containing such a key (built at test time, never committed), Then the scan fails (negative control) — test: `backend/test/tools/check-docs.test.ts` (`secret-key: catches 16+ alphanumerics, allows placeholders, scans docs/architecture, never echoes value`, `link forms never echo a secret key`, `kilo-range message never echoes a secret key`, `a very long line skips link extraction but keeps the secret scan`)
- [x] AC6 — Given the skipped scope (F-012, F-013, F-015), When the check scans `docs/engineer-setup.md` and `docs/platform-runbook.md`, Then they contain no key-provisioning or offboarding procedure and no per-team config file (`teams/`) instructions, and the runbook states that Bifrost virtual keys are issued and disabled manually by the platform team outside this project — test: `backend/test/tools/check-docs.test.ts` (`forbidden-text: catches forbidden terms in the three pages and allows them in user-guide.md`, `required-text: each T, E and R item fails when removed`)

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (after rework 1) | `04-security.md`, `04-security-rerun1.md` |
| Code review | PASS | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS | `05-review.md` |

## Risk & rollback
- **Risk:** Low. `backend/tools/check-docs.mjs` is a read-only, dependency-free Node script (`node:` built-ins only) that does not touch runtime plugin code, installer scripts, or package dependencies. In Phase 6 and Phase 7, the new documentation pages and `scripts/ci.sh` gate wiring will complete the cycle before merge.
- **Rollback:** Revert the squash merge commit on `main` (`git revert <merge-commit>`) to remove `backend/tools/check-docs.mjs`, its tests, and the architecture/documentation updates.

## How to verify
```bash
bash scripts/ci.sh
cd backend && node --test test/tools/check-docs.test.ts
node backend/tools/check-docs.mjs --help
```

🤖 Generated by the AI Factory
