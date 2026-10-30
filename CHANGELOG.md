# Changelog

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
