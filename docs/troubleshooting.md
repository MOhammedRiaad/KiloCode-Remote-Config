# Troubleshooting

This guide covers common issues when installing or running the `azdo-remote-config` plugin in Kilo CLI and the Kilo VS Code extension.

Related guides: [Engineer setup guide](engineer-setup.md) · [Platform team runbook](platform-runbook.md) · [User guide reference](user-guide.md)

## Checking Kilo log messages

At startup the plugin logs fixed diagnostic messages under service `azdo-remote-config`. Log messages never include secret values, URLs, file paths or tokens. For the complete list of info, warning and error messages and their meanings, see [Troubleshooting log messages in the user guide](user-guide.md#troubleshooting-log-messages).

## Plugin does not load at all

- **`KILO_PURE=1` is set**: setting `KILO_PURE=1` tells Kilo to ignore external plugins, so `azdo-remote-config` will not run. CI jobs that need the shared config must not set KILO_PURE=1. Check whether it is set in your shell:

  ```bash
  # macOS / Linux / Git Bash
  echo "${KILO_PURE:-unset}"
  unset KILO_PURE
  ```

  ```powershell
  # Windows PowerShell
  $env:KILO_PURE
  Remove-Item Env:KILO_PURE -ErrorAction SilentlyContinue
  ```

- **Unsupported Kilo version**: check that your Kilo CLI or VS Code extension version is within the supported range documented in the [Engineer setup guide](engineer-setup.md#supported-kilo-versions).
- **Plugin placed in `~/.config/kilo/plugin/`**: Kilo automatically loads every file inside `~/.config/kilo/plugin/`. Keep `azdo-remote-config.ts` only in `~/.config/kilo/azdo/azdo-remote-config.ts` (referenced from `kilo.jsonc`) and remove any duplicate copy from `~/.config/kilo/plugin/` so it does not load twice.
- **Personal config in the wrong location**: `~/.config/kilo/kilo.jsonc` (or `%USERPROFILE%\.config\kilo\kilo.jsonc` on Windows) must live in your global config directory, never in a project folder.

## Azure DevOps authentication (`auth-unavailable`, `http-401`, `http-403`, `http-404`)

We recommend authenticating with `az login` via the Azure CLI so you do not need to manage Personal Access Tokens manually.

- **`auth-unavailable`**: neither an active `az login` session nor a valid PAT environment variable was found. Run `az login` and verify with `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`, or set `AZDO_PAT` (or `AZURE_DEVOPS_EXT_PAT` / `KILO_AZDO_PAT`) to a PAT with **Code (Read)** scope. Never pass a PAT on a command line.
- **`http-401` / `http-403`**: your Entra token or PAT was rejected or lacks permission to read the shared config repository. Re-run `az login` or replace your expired PAT, and confirm your account has read access to the Azure DevOps project and repository.
- **`http-404`**: the configured `org`, `project`, `repo`, `path` or `branch` does not exist in Azure DevOps. Check the plugin options in `~/.config/kilo/kilo.jsonc` against [Plugin settings](user-guide.md#plugin-settings).

## Plugin cannot reach Azure DevOps: network codes and hints

When Kilo starts behind the Azure IP firewall, the plugin makes one authenticated request to `dev.azure.com` and classifies a failure. After the `Remote config unavailable (<code>) ...` error line it logs one fixed warn hint.

| Code | Meaning | What to do |
|---|---|---|
| `network-unreachable` | request failed before the deadline: DNS failure, refused or reset connection, private DNS off the VPN | Connect to the corporate VPN, then restart Kilo |
| `network-blocked` | HTTP 407, or HTTP 403 with a non-JSON body (HTML firewall, WAF or Front Door block page) | Connect to the VPN or ask the platform team to allow your public IP address, then restart Kilo |
| `timeout` | deadline reached; a firewall that silently drops packets shows up as a timeout | Same as above; `KILO_AZDO_TIMEOUT_MS` (default 5000) only helps on a slow link |
| `http-401` / `http-403` | Azure DevOps answered in JSON: the credential is missing or rejected, or you lack permission | `az login` or replace your PAT; check access to the shared config repository |
| `network` | catch-all: no usable `fetch`, internal error, or a body read failure | Restart Kilo; report it if it repeats |

Exact hint lines (network codes `network-unreachable`, `network-blocked`, `timeout`):

```
Azure DevOps could not be reached from this network: connect to the corporate VPN or ask the platform team to allow your public IP address, then restart Kilo.
```

Exact hint line (`http-401`, `http-403`, `auth-unavailable`):

```
Azure DevOps credentials are missing or were rejected: run az login or replace your PAT and check your access to the shared config repository; if your organisation restricts Azure DevOps by IP address, also connect to the corporate VPN.
```

How to tell them apart: a JSON 401/403 is a credential or permission problem (or an Azure DevOps organisation IP policy). A 407 or a 403 that is not JSON is a firewall or proxy block. Limits: an organisation IP conditional-access policy answers JSON 401/403, so you see the credentials hint (it mentions the VPN); a JSON 403 from a TLS-inspecting proxy reads as `http-403`; Azure Firewall HTTP 470 and HTML sign-in pages answered with 203 are not classified.

Kilo keeps using the bound cached config while the network is blocked: with a valid cache the log order is the `using cached config` warn, the hint, then `Applied shared config`. Older versions reported a rejected request as `network`; it is now `network-unreachable`.

Run the [curl self-check](#network-blocked-azure-firewall-or-vpn) to confirm the network path. The installer's pre-flight probe goes to the origin `/` of the Bifrost `baseURL`, so path-routed gateways can give a false blocked or reachable verdict. `smoke azdo: skipped network-blocked` means the pre-flight failed and your credential was never sent; `smoke azdo: fail network-unreachable` or `fail network-blocked` means the authenticated request failed after the probe found the host reachable. See the [platform runbook](platform-runbook.md#telling-block-types-apart).

## Stale or missing shared config and cache

After every successful, validated fetch from Azure DevOps, the plugin writes the shared config to `~/.cache/kilo-azdo/remote-config.json` (under `%USERPROFILE%\.cache\kilo-azdo\remote-config.json` on Windows).

- **When the cache is used**: the cache is read only when fetching or validating the remote config from Azure DevOps fails (for example, when you are offline or Azure DevOps is unreachable), and only if it was saved for your current `org`, `project`, `repo`, `path` and `branch` (exact, case-sensitive match).
- **`cache-outdated`**: the cache was written by an older plugin version and has no settings binding, so it is not used. This happens once. Reconnect (fix whatever made the fetch fail, such as network or credentials) and restart Kilo; the next successful fetch rewrites the cache in the new format.
- **`cache-mismatch`**: the cache was saved for different settings than the ones in use now (for example you changed `org`, `project`, `repo`, `path` or `branch`, or the case differs). It is not applied. Either correct the settings to the intended values, or reconnect so a successful fetch replaces the cache. Deleting the file also works.
- **`cache-skipped`**: `org`, `project` or `repo` is missing, so the plugin did not try the cache or the network. It is logged together with a `Remote config skipped: missing required settings` warning that names the missing settings. Set them in the plugin options or `KILO_AZDO_*` variables (see [Plugin settings](user-guide.md#plugin-settings)) and restart Kilo.
- **Safe to delete**: `~/.cache/kilo-azdo/remote-config.json` stores only the shared configuration with unresolved `{env:...}` and `{file:...}` placeholders—it never contains your virtual key, your PAT or any resolved secret (the file also records which `org`, `project`, `repo`, `path` and `branch` it belongs to). If you suspect a corrupt or stale cache (`cache-invalid` or `cache-unreadable`), delete `~/.cache/kilo-azdo/remote-config.json` and restart Kilo.

## Installer exit codes

Both `install.sh` and `install.ps1` use the same exit codes (see [Installer exit codes in the user guide](user-guide.md#exit-codes-1)):

- **`0`**: installed, updated, or already up to date, and the smoke test passed (or was skipped).
- **`1`**: missing prerequisite (Node.js `< 22.18` or no Azure DevOps credentials). No files were modified.
- **`2`**: invalid flag, missing `--org` / `--project` / `--repo`, or invalid `KILO_BIFROST_KEY`. No files were modified.
- **`3`**: existing `kilo.jsonc` is invalid JSONC, has an unexpected root shape, or a target path is a symlink, or (`install.sh`) the helper file is missing. Two messages to know:
  - `install.sh: error: installer sources are missing (expected install-helper.ts next to install.sh).`: `install-helper.ts` is not next to the script, for example after downloading only `install.sh`. Run it from a full repository checkout (`bash backend/installer/install.sh ...`). `install.ps1` prints the same wording with its own name.
  - `<path> is not a regular file or directory (symlinks are not followed); update it manually.`: that path (config folder, `azdo` folder, plugin file or `kilo.jsonc`) is a symlink. Replace it with a real file or folder, or move it away, and re-run. Nothing is written through the link.
- **`4`**: **exit code 4** means the plugin and personal `kilo.jsonc` were installed and kept, but the post-install smoke test (`smoke network:`, `smoke azdo:` or `smoke bifrost:`) failed. For `smoke network: fail ...` see [Network blocked](#network-blocked-azure-firewall-or-vpn).
  - On offline machines or restricted environments without network access to Azure DevOps or Bifrost, pass `--no-smoke` to `install.sh` on macOS/Linux or `-NoSmoke` to `install.ps1` on Windows.
  - For each smoke failure code (`auth-unavailable`, `timeout`, `http-<status>`, `no-base-url`, `insecure-base-url`, etc.) and how to fix it, see the [Smoke test troubleshooting table in the user guide](user-guide.md#smoke-test).

## Network blocked: Azure firewall or VPN

Kilo and Bifrost sit behind an Azure IP firewall. The installer smoke test starts with `smoke network:` so a blocked network is not confused with a bad credential. The PAT, `az` token and virtual key are never sent to a target whose network check failed (its line reads `skipped network-blocked`).

| Code | Meaning | What to do |
|---|---|---|
| `azdo-blocked` / `bifrost-blocked` | HTTP 403 or 407 to an anonymous request | Connect to the corporate VPN, or ask the platform team to add your public IP to the Azure firewall allow-list |
| `azdo-unreachable` / `bifrost-unreachable` | connection error, DNS failure or reset (private DNS is often only visible on the VPN) | Connect to the VPN and re-run |
| `azdo-timeout` / `bifrost-timeout` | packets dropped until the deadline (`KILO_AZDO_TIMEOUT_MS`, default 5000) | Usually a firewall drop; connect to the VPN |
| `internal` | unexpected error | Re-run; report it if it repeats |

After the fix, re-run `install.sh` or `install.ps1`. The worst-case smoke test duration is four times `KILO_AZDO_TIMEOUT_MS`.

Self-check with curl (use the host of your Bifrost `baseURL`):

```
curl -sS -o /dev/null -w '%{http_code}\n' https://dev.azure.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://<bifrost-host>/
```

- HTTP 403 or 407, a timeout, `Could not resolve host` or `Connection reset`: a firewall, VPN or DNS problem. Fix the network first.
- Any other status (200, 301, 302, 401, 404): the network path is open. If `smoke bifrost: fail 401` still appears, the problem is the virtual key, see [Bifrost 401](#bifrost-401-or-virtual-key-rejected).
- If you are connected and allowed but still see `bifrost-blocked`, the Bifrost origin `/` may answer 403 to everyone. Tell the platform team and use `--no-smoke` meanwhile.
- An Azure DevOps organisation IP conditional-access policy is enforced after login, so it shows up as `smoke azdo: fail http-401` or `http-403`, not as `azdo-blocked`.

## Windows installer issues

- **Execution policy error ("running scripts is disabled on this system")**: run the script with `-ExecutionPolicy Bypass` scoped to that command only (`powershell -NoProfile -ExecutionPolicy Bypass -File backend\installer\install.ps1 ...`). Do not weaken the machine or user execution policy.
- **Blocked downloaded file**: if the repository was downloaded as a zip archive, run `Unblock-File backend\installer\install.ps1` once inside your trusted repository checkout.
- **Node `.cmd` shims and paths with `%` or spaces**: if `node` on your `PATH` resolves to a `.cmd` wrapper (common with some version managers), a `%` in the checkout path or spaces in both the shim path and helper path can break invocation. Use a standard `node.exe` installation or move the repository checkout to a path without `%` or spaces.

See [Windows troubleshooting in the user guide](user-guide.md#troubleshooting) for more details.

## Bifrost 401 or virtual key rejected

If the installer outputs `smoke bifrost: fail 401` or model requests in Kilo fail with HTTP 401:

- Check that `provider.bifrost.options.apiKey` in your personal `~/.config/kilo/kilo.jsonc` is set to your assigned `sk-bf-...` key and is not still the `sk-bf-<your-virtual-key>` placeholder.
- If the key matches what you were given, your virtual key may be expired or disabled. Contact the platform team to request a new or re-enabled virtual key.

## Asking for help

When reporting an issue to the platform team, include:

1. Your OS, Node.js version (`node --version`), and Kilo CLI or VS Code extension version.
2. The exact `azdo-remote-config` log lines from Kilo or the `smoke network:` / `smoke azdo:` / `smoke bifrost:` lines and exit code from the installer.
3. **Never** paste your `sk-bf-...` virtual key, `AZDO_PAT`, Entra access token, or the raw contents of `~/.config/kilo/kilo.jsonc` into an issue, chat message or ticket.
