# Engineer setup guide

This guide walks you through installing the `azdo-remote-config` plugin and personal configuration so your Kilo CLI and VS Code extension load the shared `kilo.jsonc` from Azure DevOps at startup.

Related guides: [Platform team runbook](platform-runbook.md) · [Troubleshooting](troubleshooting.md) · [User guide reference](user-guide.md)

## Supported Kilo versions

The supported Kilo version range is `>=7.2.0 <8.0.0` (defined in `SUPPORTED_KILO_RANGE` in `backend/plugin/azdo-remote-config.ts`).

Check the version of your Kilo CLI or VS Code extension before installing. Versions outside `>=7.2.0 <8.0.0` are not supported until the platform team re-runs the [Phase 0 verification checks](platform-runbook.md#phase-0-verification-checklist).

## Prerequisites

- **Node.js 22.18 or newer** on your `PATH`.
- **Azure DevOps authentication**: sign in with `az login` (recommended, using the Azure CLI) or set `AZDO_PAT` (or `AZURE_DEVOPS_EXT_PAT` / `KILO_AZDO_PAT`) to a Personal Access Token with **Code (Read)** scope.
- **A local checkout of this repository**: run the installer directly from the checkout so it can locate the plugin and template files relative to the script.
- **Your Bifrost virtual key** (`sk-bf-...`), issued to you by the platform team. Keep your virtual key only in your personal `~/.config/kilo/kilo.jsonc` or in the `KILO_BIFROST_KEY` environment variable when running the installer—never place it in the shared config repository or inside a project directory.

## Install on macOS and Linux

From the repository root, run `install.sh` with your Azure DevOps organization, project and repository names, passing your virtual key via `KILO_BIFROST_KEY`:

```bash
KILO_BIFROST_KEY="sk-bf-<your-virtual-key>" bash backend/installer/install.sh \
  --org <org> --project <project> --repo <repo>
```

If you omit `KILO_BIFROST_KEY`, an existing key in `~/.config/kilo/kilo.jsonc` is preserved, or the placeholder `sk-bf-<your-virtual-key>` is written for you to replace before calling models. Use `--no-smoke` when running offline, and `--path` (or `KILO_AZDO_PATH`) only if your platform team instructs you to load a non-default config path.

For the full table of flags and environment fallbacks, see [Installing on macOS and Linux in the user guide](user-guide.md#installing-on-macos-and-linux-engineers).

## Install on Windows

From a PowerShell prompt at the repository root, run `install.ps1` (works in Windows PowerShell 5.1 and PowerShell 7+):

```powershell
$env:KILO_BIFROST_KEY = "sk-bf-<your-virtual-key>"
powershell -NoProfile -ExecutionPolicy Bypass -File backend\installer\install.ps1 `
  -Org <org> -Project <project> -Repo <repo>
Remove-Item Env:KILO_BIFROST_KEY
```

Windows notes:

- **Execution policy (`-ExecutionPolicy Bypass`)**: scope `-ExecutionPolicy Bypass` to the single `powershell ... -File` invocation shown above. Do **not** run `Set-ExecutionPolicy Bypass` or `Unrestricted` at the user or machine scope.
- **Downloaded or zipped archives (`Unblock-File`)**: if Windows blocks the script with a zone identifier mark, run `Unblock-File backend\installer\install.ps1` once. Only run `Unblock-File` on scripts inside a trusted checkout of this repository.
- **Offline installs**: pass `-NoSmoke` to skip the post-install network smoke test.
- **Header comment in `kilo.jsonc`**: when `install.ps1` updates an existing `kilo.jsonc`, the file header says `Rewritten by install.sh`. This is expected because both installers call the same Node helper (`install-helper.ts`).
- **Windows file permissions (residual risk)**: the Windows installer does not modify NTFS ACLs. Protection of `%USERPROFILE%\.config\kilo\kilo.jsonc` and its backups relies on the ACLs inherited from your Windows user profile directory. Avoid installing your personal key on a machine where untrusted users share your Windows account or have read access to `%USERPROFILE%`.

For the full parameter table, see [Installing on Windows in the user guide](user-guide.md#installing-on-windows-engineers).

## What gets written

The installer writes to `~/.config/kilo` on macOS/Linux (or `$XDG_CONFIG_HOME/kilo` if `XDG_CONFIG_HOME` is an absolute path) and `%USERPROFILE%\.config\kilo` on Windows:

- `azdo/azdo-remote-config.ts`: a local copy of the plugin (placed in `azdo/`, not `plugin/`, so Kilo loads it once).
- `kilo.jsonc`: your personal config holding the `./azdo/azdo-remote-config.ts` plugin entry and `provider.bifrost.options.apiKey`.
- `kilo.jsonc.bak-<timestamp>`: created before updating an existing `kilo.jsonc`. Because backups contain your previous virtual key, delete old `.bak-*` files once you have verified the updated config.

Never copy your personal `kilo.jsonc` into a project directory and never commit it to Git. See [Personal config template](user-guide.md#personal-config-template-engineers) and [Plugin settings](user-guide.md#plugin-settings) for details.

## Verify your installation

At the end of a normal run, the installer executes a smoke test and prints:

```text
smoke azdo: pass
smoke bifrost: pass
```

- If both checks print `pass` (exit code 0), start Kilo CLI and run `/models`, or open the Kilo VS Code extension model selector, and confirm that the shared Bifrost models appear.
- If the installer finishes with **exit code 4**, your files were written and kept, but the smoke test failed. Check the failure code in [Troubleshooting](troubleshooting.md#installer-exit-codes) and the [smoke test code reference](user-guide.md#smoke-test).

## Updating

- **Shared config updates**: when the platform team merges a change to `kilo.jsonc` in Azure DevOps, your Kilo picks it up automatically on its next start. You do not need to re-run the installer.
- **Plugin updates**: when a new version of `azdo-remote-config.ts` ships in this repository, pull the repository and re-run `install.sh` or `install.ps1`. The installer is idempotent: it updates the plugin file while keeping your existing key and settings.

## Next steps

If Kilo does not show the shared models or the smoke test fails, see [Troubleshooting](troubleshooting.md) or browse the full [User guide](user-guide.md).
