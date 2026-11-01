## Summary
Adds a network pre-flight to the installer smoke test (`backend/installer/smoke.ts`, shared by `install.sh` and `install.ps1`). Before any credential is used, one unauthenticated, bounded HTTPS probe is sent to `https://dev.azure.com/` and to the origin of the validated https Bifrost baseURL. If a target is blocked, unreachable or times out, its authenticated check is skipped and the credential for it (PAT, az token, virtual key) is never sent.

User scenario: Kilo/Bifrost sits behind an Azure IP firewall and the engineer is off the VPN or not allow-listed. The install now fails clearly with `smoke network: fail <target>-blocked|unreachable|timeout` (target is `azdo` or `bifrost`), prints a fixed VPN / IP allow-list hint naming the front end, exits 4, keeps the installation, and never sends credentials.

## Backlog item
- **ID / title:** F-020 - Installer smoke test: network pre-flight for Azure IP firewall / VPN before any credential is sent
- **Type:** feature (backend only, user-sourced, priority 1)
- **Factory cycle:** `factory/runs/cycle-0022/`
- **Design:** `docs/architecture/ADR-0019-installer-network-preflight.md`

## Acceptance criteria
- [x] AC1 non-403/407 probes give `smoke network: pass` as first line, checks unchanged - tests: "runSmoke network probe passes for 200, 204, 302, 401, 404, 405, 500 and 503 (AC-1)", "runSmoke happy path ..."
- [x] AC2 Bifrost 403/407 gives `fail bifrost-blocked`, no `/models` request, key never sent, hint, exit 4 - tests: "withholds the virtual key ... 403 or 407", install-smoke and ps1 "F-020 Bifrost behind the Azure IP firewall"
- [x] AC3 AzDO probe reject / hang gives `azdo-unreachable` / `azdo-timeout`, no az run, no token, never hangs - tests: "runSmoke AzDO probe reject or hang ... (AC-3)", "runSmoke probe timeout also works with an injected fake clock (AC-3)"
- [x] AC4 probes are anonymous manual-redirect GETs to an https origin with AbortSignal - test: "every probe call is an anonymous manual-redirect GET to an https origin (AC-4)"
- [x] AC5 invalid / missing baseURL or key leaves existing bifrost codes unchanged; `--no-smoke` makes no network call - tests in smoke.test.ts and install-smoke.test.ts
- [x] AC6 output uses fixed codes only, no secrets/host/body, internal error gives `fail internal` - tests: "formatted lines of a blocked probe leak no host, URL, key, body or error text (AC-6)", "formatSmoke prints fail internal for a hostile or missing report.network ..."
- [x] AC7 identical lines for install.sh and install.ps1, CI green - test: "network hint is identical for both front ends except the script name (AC-7)"; `bash scripts/ci.sh` exit 0

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (3 info notes only, npm audit 0) | `04-security.md` |
| Code review | PASS (10 of 11 mutations killed) | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS (639 tests: 629 pass, 0 fail, 10 pre-existing skips; lint, check-lf, check-docs pass) | `03-backend.md`, `05-review.md` |

## Risk & rollback
- Worst-case smoke time grows to 4 x `timeoutMs` (two probes plus two authenticated checks).
- Known limits:
  - Azure DevOps organisation-level IP conditional access still surfaces as an auth error, not a network code (dev.azure.com itself is public).
  - A Bifrost origin `/` that returns 403 to allowed clients would be a false positive (key withheld, exit 4, install kept). Workaround: `--no-smoke`.
  - Firewalls that answer with a non-403 status behave as before F-020.
- No new runtime dependencies, no new flags; plugin file, `install-helper.ts`, `install.sh`, `install.ps1` untouched.
- Rollback: revert the single squash commit.
- Follow-ups: F-021 (plugin-side classification of firewall blocks) and F-022 (docs / allow-listing runbook).

## How to verify
```
bash scripts/ci.sh
node --test backend/test/installer/smoke.test.ts backend/test/installer/install-smoke.test.ts
```
