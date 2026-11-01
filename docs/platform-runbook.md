# Platform team runbook

This runbook covers operating the shared Kilo configuration repository in Azure DevOps, running the Phase 0 verification checklist, setting up the PR validation gate and branch policies, hardening repository permissions, and rolling out configuration updates.

Related guides: [Engineer setup guide](engineer-setup.md) · [Troubleshooting](troubleshooting.md) · [User guide reference](user-guide.md)

## Bifrost virtual keys

Bifrost virtual keys are issued and disabled manually by the platform team outside this project. This repository contains no tooling or scripts for managing keys. Engineers store their assigned virtual key only in their personal `~/.config/kilo/kilo.jsonc` (or pass it via `KILO_BIFROST_KEY` during installation) and never in the shared config repository. The shared config validator and PR gate reject any `apiKey` field or `sk-bf-` secret pattern in the shared configuration.

## Phase 0 verification checklist

Automated tests in this repository use a start simulator and fake network, so they do not verify real Kilo, Azure DevOps or Bifrost behavior. Run this manual Phase 0 checklist with 2–3 platform engineers before initial rollout and before adopting any new Kilo version outside `SUPPORTED_KILO_RANGE`:

- [ ] **A1 (Config hook mutation reaches providers and models)**: start Kilo with `azdo-remote-config.ts` enabled and verify that provider and model entries mutated in place inside Kilo's `config` hook reach the active provider and model list.
- [ ] **A2 (Plugin options passed to local-file plugins)**: verify that Kilo passes the plugin options tuple (`["./azdo/azdo-remote-config.ts", { org, project, repo, ... }]`) from `~/.config/kilo/kilo.jsonc` to local-file plugins. If a Kilo release does not pass tuple options to local files, configure `KILO_AZDO_ORG`, `KILO_AZDO_PROJECT` and `KILO_AZDO_REPO` via environment variables instead.
- [ ] **A3 (Bifrost OpenAI-compatible `/v1` endpoint)**: verify that the Bifrost gateway exposes an OpenAI-compatible `/v1` endpoint (including `GET /v1/models` and chat/responses inference) that works with `@ai-sdk/openai-compatible` and `Authorization: Bearer sk-bf-...`.
- [ ] **Real Kilo CLI and VS Code model list**: after running the installer against real Azure DevOps and real Bifrost, verify that both Kilo CLI `/models` and the VS Code extension model list display the Bifrost models from the shared `kilo.jsonc`.
- [ ] **Native `.ts plugin` loading and path resolution**: confirm Kilo's own loading of the `.ts plugin` from `~/.config/kilo/azdo/azdo-remote-config.ts` and its path resolution relative to `~/.config/kilo/kilo.jsonc` on macOS, Linux and Windows, and verify the plugin loads exactly once (nothing placed in `~/.config/kilo/plugin/`).
- [ ] **Disabled key enforcement**: confirm that a disabled virtual key is rejected by Bifrost at request time (HTTP 401) while other engineers' keys continue to work normally.

If you upgrade the supported Kilo version range (`SUPPORTED_KILO_RANGE` in `backend/plugin/azdo-remote-config.ts` and `kiloVersionRange` in `backend/validator/kilo-schema-subset.json`), re-run this entire Phase 0 checklist and record the change in a new ADR.

## Set up the shared config repo

This repository provides a template and assembly tool for the Azure DevOps shared config repository (referred to as `kilo-config` in examples).

1. **Assemble the repository tree** from a checkout of this repository (requires Node.js 22.18+):

   ```bash
   node backend/tools/assemble-shared-repo.ts ./kilo-config-out
   ```

   This writes 9 files into `./kilo-config-out` (`.gitattributes`, `azure-pipelines.yml`, `kilo.jsonc`, `package.json`, `set-branch-policies.sh`, `validator/validate-kilo-config.ts`, `validator/kilo-config-rules.ts`, `validator/kilo-schema-subset.json`, and `plugin/azdo-remote-config.ts`) and prints `assemble-shared-repo: wrote 9 files`.

2. **Customize `kilo.jsonc`**: replace the example `https://bifrost.yourcompany.internal/v1` `baseURL` and model entries in `kilo-config-out/kilo.jsonc` with your organization's Bifrost gateway URL and approved models. Never add an `apiKey` to this file.

3. **Push to Azure Repos**: initialize a Git repository on branch `main` and push to your Azure DevOps repository:

   ```bash
   cd kilo-config-out
   git init -b main && git add . && git commit -m "Initial shared config"
   git remote add origin <your-azure-repos-clone-url>
   git push -u origin main
   ```

See [Setting up the shared config repo in the user guide](user-guide.md#setting-up-the-shared-config-repo-platform-engineers) for `assemble-shared-repo.ts` exit codes and details.

## Create the PR validation pipeline

1. In Azure DevOps Pipelines, create a new pipeline pointing to `azure-pipelines.yml` in your `kilo-config` repository.
2. Record the numeric build definition ID from the pipeline URL (`definitionId=<n>`).
3. Configure the pipeline variable `KILO_ALLOWED_HOSTS` with the comma-separated hostname allowlist for `provider.*.options.baseURL` (for example, `bifrost.yourcompany.internal`).
   - The pipeline runs `validate-kilo-config.ts` with `--allowed-hosts "$(KILO_ALLOWED_HOSTS)"`.
   - The gate fails closed: if `KILO_ALLOWED_HOSTS` is unset or empty, the validator exits 2 and fails the build.

## Configure branch policies

Azure Repos ignores the `pr:` trigger in `azure-pipelines.yml`; pull request validation is enforced through an Azure DevOps branch policy on `main`. Use `set-branch-policies.sh` to create the three required policies on `main` (minimum 1 approver with creator vote excluded and votes reset on push, required platform-team reviewer group, and blocking build validation).

1. Look up the repository GUID:

   ```bash
   az repos show --repository kilo-config --org https://dev.azure.com/<org> --project <project> --query id -o tsv
   ```

2. Preview the commands with `--dry-run`, then apply them:

   ```bash
   bash set-branch-policies.sh --org <org> --project <project> --repository-id <guid> \
     --reviewer-group <group-id> --build-definition-id <n> --dry-run

   bash set-branch-policies.sh --org <org> --project <project> --repository-id <guid> \
     --reviewer-group <group-id> --build-definition-id <n>
   ```

Note: `set-branch-policies.sh` is not idempotent (tracked as T-023). Re-running it creates duplicate policy entries that must be removed in the Azure DevOps branch policy UI. For the full flag and exit-code tables, see [Create the branch policies in the user guide](user-guide.md#4-create-the-branch-policies-with-set-branch-policiessh).

## Restrict repository permissions

Because `azure-pipelines.yml`, `validator/` and `plugin/` live in the same repository as `kilo.jsonc`, a pull request can modify its own validation gate in the same commit that edits `kilo.jsonc`. Apply least privilege on the `kilo-config` repository in Azure DevOps Project Settings → Repositories → Security:

- **Deny or leave Not set** both **Bypass policies when completing pull requests** and **Edit policies** for all ordinary contributors, project contributors, and the Azure Pipelines build service identity.
- Grant **Bypass policies when completing pull requests** and **Edit policies** only to a small, audited platform administrator group.
- Keep the platform team as a blocking required reviewer on `main`, and carefully inspect any pull request that touches `azure-pipelines.yml`, `set-branch-policies.sh`, `validator/**` or `plugin/**`.

## Allow-listing engineers on the Azure firewall

The installer smoke test first sends one anonymous `GET` (no credentials, no redirects) to `https://dev.azure.com/` and to the Bifrost `baseURL` origin `/`. Engineers off the VPN or not on the allow-list see `smoke network: fail azdo-blocked`, `bifrost-blocked`, `-unreachable` or `-timeout` instead of a confusing credential error.

- Add engineer public IPs (or require the VPN) in the Azure firewall for Bifrost.
- Keep the Bifrost origin `/` answering something other than HTTP 403 for allowed clients. A 403 on `/` is read as blocked and gives a false `bifrost-blocked`. Engineers can work around it with `--no-smoke`.
- Expect an anonymous `GET /` with no `Authorization` header from each install in the Bifrost WAF or access logs; it is the pre-flight, not an attack.
- Caveat: an Azure DevOps organisation IP conditional-access policy is enforced after login, so a blocked engineer sees `smoke azdo: fail http-401` or `http-403`, not `azdo-blocked`.

### Telling block types apart

The plugin makes one authenticated request to `dev.azure.com` per Kilo start and classifies the failure. Ask the engineer for the `azdo-remote-config` log lines.

| Plugin code | What it points to | Action |
|---|---|---|
| `network-unreachable` | DNS failure, refused or reset connection; private DNS often only resolves on the VPN | Engineer connects to the VPN |
| `network-blocked` | HTTP 407, or HTTP 403 with a non-JSON body: a firewall, proxy, WAF or Front Door block page | Allow the engineer's public IP on the firewall/WAF, or require the VPN |
| `network-blocked` (HTTP 470) | Azure Firewall application-rule deny, or a TLS-inspection exemption missing for the host. Community-reported, unofficial: Microsoft does not document 470. | Add an application rule allowing `dev.azure.com` and the Bifrost host, or exempt them from TLS inspection |
| `timeout` | Deadline reached; a firewall silently dropping packets looks like this | Check firewall drop rules for the engineer's IP |
| `http-401` / `http-403` | Azure DevOps answered in JSON: credential, permission or Azure DevOps organisation IP policy | Check access to the shared config repository; if the organisation restricts Azure DevOps by IP, the engineer must be on the VPN |

The Azure DevOps organisation IP conditional-access policy is not a WAF: it answers JSON 401/403 after login, so the credentials hint (which mentions the VPN) is shown rather than the network hint. Fix it in Azure DevOps and Entra policy, not in the firewall.

Known limits: a JSON 403 from a TLS-inspecting proxy reads as `http-403`; HTML sign-in pages answered with 203 are not classified.

HTTP 470 is treated as blocked everywhere. If your gateway legitimately answers 470 to the installer's anonymous probe, engineers get a false `*-blocked` and can use `--no-smoke` / `-NoSmoke`.

The installer also prints the VPN/allow-list hint, once and as the last line, when an authenticated line fails with a network-type code: azdo `network-unreachable`, `network-blocked` or `timeout`; bifrost `network`, `timeout`, `407` or `470`. Other codes (for example bifrost `401`, `403`, `404`, `500`) get no hint because they point to credentials or the gateway, not the network path.

Installer lines differ from plugin codes. `smoke azdo: skipped network-blocked` is the pre-flight verdict (the anonymous probe failed and the credential was never sent). `smoke azdo: fail network-unreachable` or `fail network-blocked` means the authenticated request failed after the probe found the host reachable. The probe goes to the origin `/` of the Bifrost `baseURL` and to `https://dev.azure.com/`, so a path-routed gateway can give a false `blocked` or `reachable` verdict. While the network is blocked, Kilo keeps using the bound cached config.

## Changing the shared config

To roll out a model, provider or setting change to all engineers:

1. Create a branch in the `kilo-config` repo and edit `kilo.jsonc`.
   - Choose merge behavior with the engineer's `mode` setting (`defaults` lets local engineer settings win on conflict; `enforce` makes shared settings win while always preserving the engineer's local `apiKey`). See [How the shared config is merged](user-guide.md#how-the-shared-config-is-merged).
   - Never include `apiKey` or any secret in `kilo.jsonc`.
2. Validate the file locally before opening a pull request:

   ```bash
   node validator/validate-kilo-config.ts --allowed-hosts bifrost.yourcompany.internal kilo.jsonc
   ```

   See [Validating the shared config](user-guide.md#validating-the-shared-config-platform-engineers) for all validator rules and exit codes.
3. Open a pull request targeting `main`, ensure the PR validation pipeline passes, obtain platform-team review, and merge.
4. Engineers receive the updated configuration automatically on their next Kilo start. If Azure DevOps is unreachable at startup, the plugin falls back to `~/.cache/kilo-azdo/remote-config.json`, but only if that cache was saved for the same `org`, `project`, `repo`, `path` and `branch` the engineer has configured.

## Upgrading Kilo or the plugin

- Keep engineer installations within the supported Kilo version range (`>=7.2.0 <8.0.0`). Before approving a newer Kilo version, run the [Phase 0 verification checklist](#phase-0-verification-checklist) above.
- When `backend/plugin/azdo-remote-config.ts` is updated, update the copy in the shared config repo and have engineers re-run the installer as described in the [Engineer setup guide](engineer-setup.md#updating).
