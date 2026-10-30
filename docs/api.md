# API reference

This product has no HTTP API. It is a Kilo plugin.

## Plugin interface (current: stub)

File: `backend/plugin/azdo-remote-config.ts`. Default export, Kilo v1 plugin module shape:

```ts
export default { id: "azdo-remote-config", server }
// server(input, options?) => Promise<{ config(config) => Promise<void> }>
```

- `config` hook: receives Kilo's resolved config; in the current stub it does nothing.
- Named exports: `PLUGIN_ID` (`"azdo-remote-config"`), `SUPPORTED_KILO_RANGE` (`">=7.2.0 <8.0.0"`)
  and `__internals` (empty test seam).
- The plugin settings (`org`, `project`, `repo`, `path`, `branch`, `mode`, `pat`, `timeoutMs`) are
  not read yet.

Authoritative contract: `docs/architecture/contracts/plugin-interface.md` and ADR-0002.
