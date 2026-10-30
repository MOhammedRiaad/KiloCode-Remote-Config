# ADR-0002: Plugin module shape and test seam
- Status: accepted
- Date: 2026-10-30
- Cycle / item: cycle-0002 / T-001

## Context

Kilo's plugin loader (Kilo 7.x, `packages/opencode/src/plugin/index.ts`) interprets a module as:

1. **v1 module** - if the default export is `{ id, server }` with `server` a function, Kilo calls
   `server(input, options)` once and uses the returned hooks. Named exports are not scanned.
2. **Legacy** - otherwise, every named export that is a function (or an object with a `server`
   function) is called as a plugin. Non-function named constants are skipped.

Kilo then calls each hook's `config?.(cfg)` once, sequentially, awaiting it; a thrown error is
logged as "plugin config hook failed" and ignored.

We need (a) exactly-once loading (AC-12) and (b) a way for tests (and the C1 validator) to reach
pure helpers such as the JSONC parser without making them look like plugins to either loader path.

## Decision

1. The plugin file's **default export** is the v1 module object:
   ```ts
   export default { id: "azdo-remote-config", server: AzdoRemoteConfig };
   ```
   `AzdoRemoteConfig` is a module-local `const`, **not** itself exported.
2. **No named export may be a function, or an object with a `server` property.** This
   guarantees that even if a future Kilo falls back to the legacy path, nothing is loaded twice
   and no helper is invoked as a plugin.
3. Pure helpers are exposed through exactly one named constant:
   ```ts
   export const __internals = { /* parseJsonc, resolvePlaceholders, mergeConfig, ... */ };
   ```
   It is a plain object without a `server` key. Its contents are **not** a public API; only
   tests and `backend/validator/` may use it.
4. Additional named exports allowed: string/number constants (`PLUGIN_ID`,
   `SUPPORTED_KILO_RANGE`) and `export type` / `export interface` declarations (erased).
5. `server` and every hook must catch all errors internally (FR-10): the plugin never relies on
   Kilo's own catch.

## Consequences

- Exactly-once loading holds for both the v1 and the legacy loader path.
- The `id` (`azdo-remote-config`) is the stable identity Kilo uses for deduplication.
- Tests import the default export and call `server(fakeInput, options)` to get hooks.

## Alternatives considered

- **Legacy named function export only** (`export const AzdoRemoteConfig: Plugin = ...`): works,
  but any helper exported for tests would also be called as a plugin. Rejected.
- **Separate helper modules**: violates FR-11 (single file). Rejected.
