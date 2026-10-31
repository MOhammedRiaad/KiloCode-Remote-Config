# Docs report — cycle 0018 — F-016: User and operator documentation

## Inputs read
- `factory/runs/cycle-0018/02-architect.md` (page outlines, existing-doc edits, tasks D1–D5)
- `docs/architecture/contracts/docs-check.md` (rules, section 5 required items T1–T7, E1–E5, R1–R18, forbidden terms)
- `factory/runs/cycle-0018/04-security.md` (security guidance on `-ExecutionPolicy Bypass`, `Unblock-File`, least-privilege policy permissions, `az login`, cache safety, and virtual key handling)
- `README.md`, `docs/user-guide.md`, `docs/development.md`, `factory/VISION.md`

## Pages created and modified
- `docs/engineer-setup.md` (created, D1):
  - Supported Kilo range `>=7.2.0 <8.0.0` (`SUPPORTED_KILO_RANGE`), prerequisites (`az login` or `AZDO_PAT`, Node.js 22.18+, repo checkout, Bifrost virtual key kept only in personal config or `KILO_BIFROST_KEY`).
  - macOS/Linux setup (`install.sh`, `KILO_BIFROST_KEY`, `--no-smoke`, `--path`).
  - Windows setup (`install.ps1`, single-invocation `-ExecutionPolicy Bypass`, `Unblock-File` only on scripts from a trusted repository checkout, `-NoSmoke`, expected `Rewritten by install.sh` header, and Windows profile ACL residual risk).
  - Files written, smoke test verification (`smoke azdo: pass`, `smoke bifrost: pass`, exit code 4 pointer), and updating instructions.
  - Relative links to `platform-runbook.md`, `troubleshooting.md`, and `user-guide.md`.
- `docs/platform-runbook.md` (created, D2):
  - Manual key policy statement verbatim (R18): "Bifrost virtual keys are issued and disabled manually by the platform team outside this project."
  - Phase 0 verification checklist covering assumptions A1, A2, A3 and the manual checks from `docs/development.md` (real Kilo CLI `/models` and VS Code extension model list against real Azure DevOps and Bifrost, native `.ts plugin` loading and path resolution, and that a disabled virtual key is rejected by Bifrost at request time).
  - Shared config repo assembly (`node backend/tools/assemble-shared-repo.ts`), PR validation pipeline setup (`azure-pipelines.yml`, fail-closed `KILO_ALLOWED_HOSTS`), and branch policies (`set-branch-policies.sh`, `--dry-run`, T-023 duplicate note).
  - Repository permission hardening (least-privilege restriction on "Bypass policies when completing pull requests" and "Edit policies" so ordinary contributors and the pipeline identity cannot alter or bypass the gate).
  - Workflow for changing the shared config and upgrading Kilo or the plugin.
  - Relative links to `engineer-setup.md`, `troubleshooting.md`, and `user-guide.md`.
- `docs/troubleshooting.md` (created, D3):
  - Log message overview (`azdo-remote-config`) linking to `user-guide.md#troubleshooting-log-messages`.
  - Plugin load issues: `KILO_PURE=1` and verbatim warning "CI jobs that need the shared config must not set KILO_PURE=1", unsupported Kilo version, duplicate copy in `~/.config/kilo/plugin/`.
  - Azure DevOps authentication (`az login` preferred, `auth-unavailable`, `http-401`, `http-403`, `http-404`).
  - Cache location `~/.cache/kilo-azdo/remote-config.json` (contains shared config only, no keys, safe to delete).
  - Installer exit codes 0–4, including exit code 4 (installed and kept, smoke test failed) and offline flags `--no-smoke` / `-NoSmoke`.
  - Windows installer troubleshooting, Bifrost 401 guidance, and safe issue reporting.
  - Relative links to `engineer-setup.md`, `platform-runbook.md`, and `user-guide.md`.
- `README.md` (modified, D4):
  - Linked `docs/engineer-setup.md`, `docs/platform-runbook.md`, and `docs/troubleshooting.md` in the product documentation links and linked `docs/platform-runbook.md#phase-0-verification-checklist` in "Still manual (Phase 0)".
- `docs/user-guide.md` (modified, D4):
  - Updated line 9 to remove stale "Not yet available: ... Azure Pipelines PR gate (F-008)", note that key provisioning is not part of this project, and link to `engineer-setup.md`, `platform-runbook.md`, and `troubleshooting.md`.
  - Linked "Security caveat: a PR can change its own gate" to `platform-runbook.md#restrict-repository-permissions`.
  - Fixed the Windows "Exit codes and smoke test" anchor link from `#exit-codes` to `#exit-codes-1`.
- `docs/development.md` (modified, D4):
  - Kept the `### What stays manual (Phase 0)` heading and replaced the F-016 placeholder note with a link to `platform-runbook.md#phase-0-verification-checklist`.

## Verification
Ran `node backend/tools/check-docs.mjs` from the repository root:

```text
check-docs: PASS (33 markdown files checked)
```

Exit code: `0`.

FACTORY_RESULT
status: DONE
report: factory/runs/cycle-0018/07-docs.md
summary: Created engineer-setup.md, platform-runbook.md, and troubleshooting.md; updated README.md, user-guide.md, and development.md; check-docs PASS (33 files).
