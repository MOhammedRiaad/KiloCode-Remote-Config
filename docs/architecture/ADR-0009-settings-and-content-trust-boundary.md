# ADR-0009: Trust boundary for settings sources and for fetched / cached content
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0008 / F-006 (cycle-0007 security finding info 4)

## Context

The plugin sends the user's credentials (PAT, or an Entra token from `az`) to
`https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items?path={path}...`
(ADR-0007) and merges the returned file into Kilo's config (ADR-0005). The shared file can set
anything Kilo's config can set except `apiKey`, `$schema` and `plugin` (for example
`mcp` server commands, provider `baseURL`s, headers that use `{file:~/...}` placeholders).

Cycle 0007 security finding (info 4): if an **untrusted** source could choose `org`, `project`,
`repo`, `path` or `branch` (for example a project-level Kilo config committed to a repository the
engineer clones), it could point the engineer's credentials at an Azure DevOps repository it
controls. The host is fixed, so the credential never leaves `dev.azure.com`, but the content would
be attacker-chosen: it could add MCP commands the engineer later runs, or a provider `baseURL`
plus a header with `{file:~/.ssh/id_rsa}` that exfiltrates a local file. The fetched content is
therefore exactly as trustworthy as the source of the settings that selected it.

Facts about the host (ADR-0001, ADR-0002):
- Kilo passes the plugin only the **merged** second element of the plugin tuple as `options`.
  The plugin cannot tell which config layer supplied it.
- Kilo's config is layered (global `~/.config/kilo/kilo.jsonc`, then project-level files such as
  `.kilo/` in the worktree). Project-level configuration is out of scope for this product
  (VISION, non-goals). How Kilo 7.x deduplicates plugin tuples with the same id across layers
  (which options win) has not been verified.

## Decision

### 1. Settings sources (org, project, repo, path, branch, mode, pat, timeoutMs)

| Source | Status | Rationale |
|---|---|---|
| Plugin options in the user's **global** Kilo config `~/.config/kilo/kilo.jsonc` (written by the C3 template / C5 installer) | **Trusted, supported** | User-owned file in the user's home. |
| Process environment: `KILO_AZDO_*` (ADR-0006), `AZDO_PAT`, `AZURE_DEVOPS_EXT_PAT` (ADR-0007) | **Trusted, supported** | Whoever controls the environment already controls the process. |
| `az` CLI login (Entra token, credential only) | **Trusted, supported** | User's own login; `az` is started with `cwd` = home (ADR-0007). |
| Plugin options in any **project-level** Kilo config (`.kilo/` or a config file in the worktree) | **Untrusted, unsupported** | May come from a cloned repository. Must not be used to configure this plugin. Documentation and the C3 template put the tuple only in the global config. |
| The `config` argument of the hook (Kilo's resolved config) | **Never a settings source** | The plugin reads settings only from `server`'s `options` and the env, never from the config object it merges into. |
| The fetched shared config and the cache | **Never a settings source** | Settings are resolved before the fetch; top-level `plugin` is ignored by the merge (ADR-0005), so a shared file cannot change the plugin tuple or redirect itself. |

Controls inside the plugin (it cannot see the layer, so these limit the blast radius):
- Fixed host `dev.azure.com`, every value `encodeURIComponent`-encoded, settings validated
  (ADR-0006, ADR-0007), redirects never followed (`redirect: "manual"`), so credentials go only to
  Azure DevOps.
- Settings come only from `options` and the env, never from `config`, fetched or cached content.

Residual risk (accepted for now, follow-up raised): if Kilo lets a project-level config override
the global tuple's options for the same plugin id, a malicious repository could redirect the
fetch to another Azure DevOps repo readable with the user's credentials. A backlog follow-up
verifies Kilo 7.x tuple deduplication across layers and, if overriding is possible, adds a guard
(for example: org/project/repo from options must equal `KILO_AZDO_*` when those are set, or an
org allow-list in the env).

### 2. Fetched and cached content is untrusted input

Both the Items API response and `~/.cache/kilo-azdo/remote-config.json` are validated as
untrusted before they are cached or merged (ADR-0008 section 3):

1. Size cap before parsing: 1 MiB HTTP body (ADR-0007), 2 MiB cache file (ADR-0008).
2. Strict decode / JSONC parse; any parse failure -> rejected (`invalid-jsonc`).
3. Root must be a plain object (no array, string, number, boolean, `null`) -> else `invalid-shape`.
4. Nesting below 64 levels -> else `invalid-shape`.
5. Rejected content is never written to the cache and never merged; the cache fallback applies.
6. The merge sanitises again (ADR-0005): `apiKey` (any case, any depth) is never applied and a
   local `apiKey` is never replaced; `__proto__` / `constructor` / `prototype` are dropped;
   top-level `$schema` and `plugin` are ignored; prototypes are never changed.
7. Placeholders follow ADR-0004 (`{env:}` own non-empty values only; `{file:}` only `~/` or
   absolute paths, no UNC, regular files up to 1 MiB). Resolved values are never logged or
   written to disk; only placeholder names are logged, sanitised (ADR-0008 section 5).
8. Values from the content are never logged; content cannot influence log text except through
   sanitised placeholder names.

The content of the shared repository C1 is trusted **only** because it is selected by trusted
settings and protected by the C1 PR gate (validator, F-007). Features that run commands or read
files from shared content (MCP, `{file:}`) rely on that.

### 3. The cache file

The cache lives in the user's home (`~/.cache/kilo-azdo/`, directory created 0700, file 0600 on
POSIX, atomic replace, ADR-0008). Only the user (or something already running as the user) can
write it. It is still validated exactly like fetched content, because it may be corrupt, truncated
by an old version, or edited by hand.

## Consequences

- The security engineer and docs writer have a stated boundary: configure the plugin only in the
  global config or the environment.
- The plugin itself enforces everything it can see; the layer question is a documented
  assumption plus a follow-up item.
- Content validation is shared by the fetch and cache paths, so no path merges unvalidated data.

## Alternatives considered

- **Refuse to run when `input.directory` / `input.worktree` contains a Kilo config**: does not
  tell whether that config set the plugin options, and would break normal use. Rejected.
- **Require settings from the env only**: safest, but contradicts FR-1 (plugin options are the
  primary source) and the installer design. Rejected; kept as a possible guard in the follow-up.
- **Content signing for the shared file**: strong, but needs key distribution and is out of scope
  for the MVP. Rejected for now.
- **Treat the cache as trusted (no re-validation)**: saves a parse, but a corrupt file would reach
  the merge (AC-4). Rejected.
