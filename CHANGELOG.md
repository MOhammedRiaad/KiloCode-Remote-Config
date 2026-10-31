# Changelog

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
