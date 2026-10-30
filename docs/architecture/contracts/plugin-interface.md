# Contract: `azdo-remote-config` plugin interface

- Version: 0.2.0 (F-001, cycle-0003; 0.1.0 was T-001, cycle-0002)
- Owner: Architect. Implemented by: `backend/plugin/azdo-remote-config.ts`.
- This product has **no HTTP API of its own** and no frontend; this typed contract replaces an
  OpenAPI document. It defines (1) what Kilo passes to the plugin, (2) what the plugin returns,
  (3) the plugin options schema, and (4) the outbound calls the plugin makes.

## 1. Types declared inside the plugin file (structural, no `@kilocode/plugin` import)

```ts
/** Kilo log levels accepted by client.app.log. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Minimal subset of the Kilo plugin input that this plugin uses. Everything else is ignored. */
export interface PluginInput {
  client?: {
    app?: {
      log?: (args: {
        body: { service: string; level: LogLevel; message: string; extra?: Record<string, unknown> };
      }) => unknown | Promise<unknown>;
    };
  };
  directory?: string;
  worktree?: string;
  [key: string]: unknown;
}

/** Raw plugin options from the `plugin` tuple; validated later by F-features (FR-1). */
export type PluginOptions = Record<string, unknown> | undefined;

/** Kilo's resolved config: an arbitrary JSON object mutated in place. */
export type KiloConfig = Record<string, unknown>;

export interface Hooks {
  config: (config: KiloConfig) => Promise<void>;
}

export type PluginServer = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;
```

## 2. Module exports (see ADR-0002)

| Export | Kind | Value / contract |
|---|---|---|
| `default` | object | `{ id: "azdo-remote-config", server: PluginServer }` |
| `PLUGIN_ID` | string const | `"azdo-remote-config"` (also the logger `service` name, FR-9) |
| `SUPPORTED_KILO_RANGE` | string const | `">=7.2.0 <8.0.0"` |
| `__internals` | plain object | Test/validator seam. `{ parseJsonc }` since F-001 (section 2a); later F-items add further pure helpers. Never has a `server` key; never itself a function. |
| types | `export type` / `export interface` | as in section 1 |

No other named exports. No named export may be a function. Helpers inside `__internals` are
module-local functions (not exported by name).

## 2a. `__internals.parseJsonc` (F-001, FR-4, ADR-0003)

```ts
function parseJsonc(text: string): unknown;
```

Access: `import { __internals } from "../../plugin/azdo-remote-config.ts"; __internals.parseJsonc(src)`.

| Aspect | Contract |
|---|---|
| Purity | No I/O, no logging, no globals mutated, deterministic. |
| Accepted syntax | Strict JSON (RFC 8259) plus: `//` line comments, `/* */` block comments (may span lines, may be at EOF without a newline), trailing commas before `}` / `]` (whitespace and comments may sit between the comma and the bracket, at any nesting depth), one optional leading BOM (U+FEFF). |
| Strings | Content between unescaped `"` is never altered: `//`, `/*`, `*/`, `,}` and `,]` inside strings are data. `\"` and `\\` escapes are honoured (a string ending in `\\` closes at the following `"`). |
| Return | The value `JSON.parse` returns for the comment/trailing-comma-free text (`unknown`; any JSON value including primitives). |
| Non-string input | Throws `TypeError` with message `Invalid JSONC: input must be a string`. |
| Unterminated string | Throws `Error`: `Invalid JSONC: unterminated string starting at line L, column C`. |
| Unterminated block comment | Throws `Error`: `Invalid JSONC: unterminated block comment starting at line L, column C`. |
| Anything else invalid (incl. empty / whitespace-only input) | Throws `Error`: `Invalid JSONC: malformed JSON`. The underlying `SyntaxError` is discarded (not set as `cause`). |
| Error message rule | Every message starts with `Invalid JSONC: ` and contains only fixed text and 1-based line / column numbers (UTF-16 code units; `\n` starts a new line, `\r\n` counts as one line break). **No substring of the input ever appears in a message.** |
| Lenient, unspecified | `[,]` and `{,}` may parse as empty containers. Callers must not rely on either outcome. |

## 3. Behaviour contract

### `server(input, options)`
- MUST resolve (never reject) for any `input` (including `{}`) and any `options`
  (including `undefined`, `null`, non-objects).
- MUST NOT perform network or filesystem I/O in T-001 (stub). Later items do the fetch here or
  lazily in `config`; either way all errors are caught (FR-10).
- Returns an object whose `config` property is a function.

### `hooks.config(config)`
- Called by Kilo once with the fully resolved config; Kilo awaits it.
- MUST resolve (never reject) for any argument.
- **T-001 stub:** a no-op. After the call, `config` is deep-equal to its state before the call
  and is the same object reference (no replacement, no added/removed keys).
- **Later (F-003):** mutates `config` in place per FR-6; never replaces the object.

## 4. Plugin options schema (FR-1) - informative, implemented by a later item

| Option | Type | Env fallback | Default |
|---|---|---|---|
| `org` | string | `KILO_AZDO_ORG` | none (required for fetch) |
| `project` | string | `KILO_AZDO_PROJECT` | none (required for fetch) |
| `repo` | string | `KILO_AZDO_REPO` | `kilo-config` |
| `path` | string | `KILO_AZDO_PATH` | `/kilo.jsonc` |
| `branch` | string | `KILO_AZDO_BRANCH` | `main` |
| `mode` | `"defaults" \| "enforce"` | `KILO_AZDO_MODE` | `defaults` |
| `pat` | string (secret) | `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT` | none -> `az` Entra token |
| `timeoutMs` | positive integer | `KILO_AZDO_TIMEOUT_MS` | `5000` |

The exact validation rules are fixed by the item that implements FR-1.

## 5. Outbound calls (informative, later items)

- **Azure DevOps Git Items API** (FR-2):
  `GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items?path={path}&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`
  with `Authorization: Basic base64(":" + pat)` or `Authorization: Bearer <entra token>` (FR-3),
  aborted after `timeoutMs` (FR-8).
- **`az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`** (FR-3)
  when no PAT is configured.
- **Cache file** `~/.cache/kilo-azdo/remote-config.json` (FR-7).
- **Logs** only via `input.client.app.log` with `service: "azdo-remote-config"`; never secret
  values (FR-9).
