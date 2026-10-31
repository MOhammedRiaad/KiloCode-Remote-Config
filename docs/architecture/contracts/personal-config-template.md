# Contract: personal config template (C3)

- Version: 1.0.0 (cycle-0010, F-009). Decision record: ADR-0011.
- File: `backend/personal-config/kilo.jsonc`
- Consumers: installers F-010 / F-011 (copy to `~/.config/kilo/kilo.jsonc`), the engineer (edits
  `apiKey`), Kilo + plugin C2 at runtime.

## 1. Exact content

The file must contain exactly this text (UTF-8 without a BOM, ending with a newline; LF in the
git index). Windows checkouts with `core.autocrlf=true` may hold CRLF in the working tree, so tests
must accept both `\n` and `\r\n` and must not assert the absence of `\r`. Comment wording may be
improved later, but it must keep the facts listed in section 2.

```jsonc
// Personal Kilo configuration template (C3, FR-16).
// Copy this file to ~/.config/kilo/kilo.jsonc (the global Kilo config directory).
// Never place it in a project directory and never commit it to a repository:
// it holds your own Bifrost virtual key (FR-17).
// Azure DevOps credentials do not belong here: use the AZDO_PAT environment
// variable or `az login` (FR-3).
{
  "$schema": "https://app.kilo.ai/config.json",
  "plugin": [
    [
      "./azdo/azdo-remote-config.ts",
      {
        "org": "contoso",
        "project": "platform",
        "repo": "kilo-config",
        "path": "/kilo.jsonc",
        "branch": "main",
        "mode": "defaults"
      }
    ]
  ],
  "provider": {
    "bifrost": {
      "options": {
        // Replace the placeholder with your own Bifrost virtual key.
        "apiKey": "sk-bf-<your-virtual-key>"
      }
    }
  }
}
```

## 2. Invariants (each pinned by a test)

| # | Invariant | AC |
|---|-----------|----|
| I1 | `__internals.parseJsonc(text)` succeeds. The root is a plain object with keys exactly `$schema`, `plugin`, `provider`. `$schema === "https://app.kilo.ai/config.json"`. | AC1 |
| I2 | The raw text contains `~/.config/kilo/kilo.jsonc` inside a `//` comment, and a comment saying the file must not be placed in a project directory (regex `/project directory/i` on a comment line). | AC1 |
| I3 | `plugin` has length 1. `plugin[0]` is `[ "./azdo/azdo-remote-config.ts", opts ]`. `Object.keys(opts).sort()` is `["branch","mode","org","path","project","repo"]` (no `pat`). Every value is a non-empty string, `path` starts with `/`, and `mode` is `defaults` or `enforce`. | AC2 |
| I4 | `__internals.resolveSettings(opts, { env: {} })` returns `missing: []`, `warnings: []`, and `settings.{org,project,repo,path,branch,mode}` equal to `opts`. | AC3 |
| I5 | `provider` keys = `["bifrost"]`, `bifrost` keys = `["options"]`, `options` keys = `["apiKey"]`. `apiKey` is a string, starts with `sk-bf-` and `SECRET_PATTERN.test(apiKey) === false`. | AC4 |
| I6 | `validateConfigText(text)` has no `secret-pattern` finding. Its only error is `api-key` at `provider.bifrost.options.apiKey`. The only warning is `plugin-ignored` at `plugin`. | AC5 |
| I7 | `validateConfigText(text.replace(placeholder, FAKE_SECRET))` has at least one `secret-pattern` finding, and no finding's `rule`/`location`/`message` contains `SECRET_TAIL`. | AC5 |
| I8 | For `mode` in `defaults` and `enforce`: after `__internals.mergeConfig(local, shared, mode)`, with `shared` = parsed `backend/shared-config/kilo.jsonc`, `apiKey` is still the placeholder, `options.baseURL` equals the shared value, `models` has `azure/gpt-5` and `azure/gpt-5-mini`, and `local.plugin` / `local.$schema` deep-equal their values before the merge. | AC6 |

## 3. Not part of the contract

- The validator CLI's verdict on this file. It is a shared-config gate and reports `api-key` as an
  error, which is correct for C1 files.
- `timeoutMs` and `pat` options. They remain valid plugin options (contract `plugin-interface.md`),
  but the template does not show them. PATs come from the environment (FR-3).
