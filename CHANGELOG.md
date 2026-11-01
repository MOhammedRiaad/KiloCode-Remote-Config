# Changelog

## [0.14.1] - 2026-11-01

### Security
- T-013: the cache is now bound to the settings that produced it (org, project, repo, path, branch) using the envelope format `kilo-azdo-cache-v1`; a cache written for other settings is never served.

### Changed
- T-013: BEHAVIOUR CHANGE: a missing org, project or repo no longer falls back to the cache.
- T-013: UPGRADE NOTE: existing caches are unusable once (`cache-outdated`) until the next successful fetch rewrites them in the new envelope.
- T-013: new codes `cache-outdated`, `cache-mismatch` and `cache-skipped`; plugin contract bumped to 0.8.0.

## [0.14.0] - 2026-10-31

### Added
- F-016: engineer setup guide (`docs/engineer-setup.md`), platform-team runbook (`docs/platform-runbook.md`), and troubleshooting guide (`docs/troubleshooting.md`).
- F-016: automated documentation check (`backend/tools/check-docs.mjs`) and hermetic test suite (`backend/test/tools/check-docs.test.ts`), wired into `scripts/ci.sh` (ADR-0017, `contracts/docs-check.md`).

### Changed
- F-016: updated `README.md`, `docs/user-guide.md`, and `docs/development.md` with cross-links to the new guides and runbook.

### Fixed
- F-016: fixed the Windows installer exit-codes anchor link (`#exit-codes-1`) and stale PR-gate availability note in `docs/user-guide.md`.

## [0.13.0] - 2026-10-31

### Added
- F-014: end-to-end simulated startup test suite.
- F-014: fake-network `auth` answer for the simulated startup.
- F-014: documentation for the end-to-end startup test.

### Changed
- Unrelated settings commit: removed attribution (co-author) settings.

## [0.12.0] - 2026-10-31

### Added
- F-008: shared config repo template and assemble tool.
- F-008: Azure Pipelines PR gate for the shared config repo.
- F-008: branch-policy setup script.
- F-008: documentation for shared config repo, PR gate and branch policy setup.

### Changed
- F-008: lint rule 8 added.

## [0.11.0] - 2026-10-31

### Added
- F-011: Windows bootstrap installer (`install.ps1`).
- F-011: helper `frontend` record for the installer.
- F-011: documentation for the Windows installer.

### Changed
- F-011: `*.ps1` files are now enforced with LF line endings (LF rule).

## [0.10.0] - 2026-10-31

### Added
- F-019: bootstrap installer smoke test for `install.sh`.
- F-019: documentation for the installer smoke test.

## [0.9.0] - 2026-10-31

### Added
- F-010: bootstrap installer for macOS/Linux (`install.sh`).
- F-010: documentation for the bootstrap installer.

## [0.8.0] - 2026-10-31

### Added
- F-009: personal config template for users of the plugin.
- F-009: documentation for the personal config template.

### Changed
- F-009: `.gitattributes` now enforces LF line endings for `*.jsonc` files.

## [0.7.0] - 2026-10-31

### Added
- F-007: example shared `kilo.jsonc` and a validation script for the shared config repo.
- F-007: documentation for the shared config validator and example config.

## [0.6.0] - 2026-10-31

### Added
- F-006: plugin cache, fallback, logging and never-crash wiring of the config hook.
- F-006: documentation for the wired config hook, cache and logging.

### Changed
- F-006: the config hook now resolves settings, fetches remote configuration, and falls back to cache without throwing.

### Fixed
- F-006: rework fixes from backend, security and review passes.

### Security
- F-006: logging never includes secrets.

## [0.5.0] - 2026-10-31

### Added
- F-005: Azure DevOps fetch and authentication via `__internals.fetchRemoteConfig` (ADR-0007, plugin contract 0.6.0), using the Items API with PAT or `az` authentication.
- F-005: user documentation for remote configuration fetch and authentication.

### Changed
- F-005: settings validation now also requires org, project, repo, branch and path to be well-formed UTF-16; lone surrogates yield W2 and fall through to the next source.
- F-005: `docs/api.md` authoritative contract reference updated to v0.6.0 and ADR-0007.

### Security
- F-005: the PAT and other secrets are never included in warnings or errors.

## [0.4.0] - 2026-10-30

### Added
- F-004: plugin settings resolution (options, env, defaults) in `__internals`, resolving each setting from plugin options first, then environment variables, then built-in defaults.
- F-004: warnings are emitted in setting order (option before env) with a leading W0 warning, and never include secret values.
- F-004: environment is read from an injectable `deps.env` at call time; a malformed `deps.env` is treated as empty rather than falling back to `process.env`.

### Security
- F-004: accessor properties on options are never invoked, prototype-polluting keys are never read or copied, and throwing or revoked proxies never throw.

## [0.3.0] - 2026-10-30

### Added
- T-008 (F-003): in-place `mergeConfig` with `defaults` and `enforce` modes (ADR-0005, contract 0.4.0).

### Security
- T-008: `apiKey` is never overwritten or applied by the merge.
- T-008: prototype-named keys are skipped and merge depth is capped.

## [0.2.0] - 2026-10-30

### Added
- F-002: `__internals.resolvePlaceholders` in the plugin, resolving `{env:VAR}` and `{file:path}` placeholders recursively and returning `{ value, unresolved }` (names only, never values). Not yet wired into the config hook (F-006).

### Security
- F-002: `{file:}` accepts absolute or `~/` paths only, rejects UNC paths, limits reads to regular files of at most 1 MiB, never re-expands resolved values, and caps nesting depth.

### Fixed
- T-005: added the missing 0.1.0 entry below.

## [0.1.0] - 2026-10-30

### Added
- F-001: Plugin JSONC parser (released as v0.1.0 in cycle 0003).

## [0.0.1] - 2026-10-30

### Added
- T-001: backend project skeleton (TypeScript, node:test, tsc) and ADR-0001 tech stack.
- `scripts/check-lf.sh` and `.gitattributes` to keep shell scripts LF-only.

### Changed
- T-001: `scripts/ci.sh` and the CI workflow now cover the backend only (typecheck, test, build).

### Fixed
- T-001: removed stale compose/Docker checks and the docker-smoke job left over from another product.
