# Architect report — cycle 0014 — F-011: Bootstrap installer for Windows (install.ps1)

## Inputs read
- factory/runs/cycle-0014/01-product-owner.md (F-011, 8 ACs), factory/backlog.json
- docs/architecture/: overview.md, ADR-0001, ADR-0012, ADR-0013, contracts/installer-cli.md 1.1.0
- backend/installer/install.sh, install-helper.ts, smoke.ts (formatSmoke / NO_KEY_HINT), personal-config-edit.ts (header text)
- backend/test/installer/helpers.ts, fixtures/fake-network.ts, install-smoke.test.ts, install-sh.test.ts (structure)
- backend/tools/check-fr11.mjs, backend/package.json, scripts/ci.sh, scripts/check-lf.sh, .gitattributes, .github/workflows/ci.yml

## Work done
- Ran feasibility experiments on this Windows host with pwsh 7.6.9 and Windows PowerShell 5.1.26100
  (scratchpad only, nothing in the repo). Findings, recorded as facts 1-7 in ADR-0014:
  1. `System.Diagnostics.Process` + `StandardInput.BaseStream.Write(bytes)` delivers bytes exactly on both
     hosts (UTF-8 no BOM, NUL, CRLF inside values, `Ü` = c3 9c, no trailing newline). Exit code propagates.
  2. Child stdout/stderr not redirected = inherited handles, no PowerShell re-encoding.
  3. `Process.Start` of a `.cmd` (UseShellExecute=false) works on both; stdin passes through cmd.exe.
  4. `-File` puts every token into `$args` as strings, incl. `-Org`, `-?`, `""`; `-NoSmoke:$false` arrives as two tokens.
  5. On Windows `Get-Command -CommandType Application` returns an **extensionless** `#!/bin/sh` stub as an
     application and running it yields no exit code; without `PATHEXT` in env `.cmd` is not found.
  6. PowerShell writes host state under `<USERPROFILE>\AppData\...` regardless of LOCALAPPDATA/APPDATA.
  7. Native calls with `*>`/`2>` under EAP=Stop are unsafe on 5.1; use a function-local EAP=Continue.
- Wrote ADR-0014 (Windows bootstrap installer). Amended contract installer-cli.md 1.1.0 -> 1.2.0
  (new section 10 for install.ps1; optional `frontend` stdin record; Windows ACL note in section 6;
  section 8 updated). Updated overview.md (component table, new Windows data flow, layout), ADR-0001
  (PowerShell as optional test tool; rule 7 covers install.ps1), ADR-0012 (amended-by line), README.

### Design summary
- `backend/installer/install.ps1`: thin front end, writes nothing. No `param()` block: manual parsing of
  `$args` (case-insensitive exact names `-Org -Project -Repo -Path -Branch -Mode -NoSmoke`; help on
  `-Help`/`-h`/`-?`/`--help` scanned first). PowerShell's own binder would echo the bad parameter name and
  exit 1, so it is not used. Unknown/positional/`-Name:value`/missing value -> exit 2 with
  `install.ps1: error: unknown option or argument.` + `Run install.ps1 -Help for usage.` (never echoes).
- Merge param > `KILO_AZDO_*` env > defaults (`/kilo.jsonc`, `main`, `defaults`); empty = absent.
- Prereqs (all reported, exit 1, same fixed texts as install.sh with `install.ps1:` prefix): `node` and
  `az` via `Get-Command -CommandType Application`, on Windows only `.exe/.cmd/.bat/.com` hits count
  (`[Environment]::OSVersion.Platform -eq 'Win32NT'`, not `$IsWindows`, which 5.1 lacks). Node >= 22.18 via
  `node -p process.versions.node`; credentials: PAT var non-empty, else `az(.cmd) account show --output none`.
- Helper = `Join-Path $PSScriptRoot install-helper.ts`; missing -> exit 3 fixed message.
- Hand-over: records `org, project, repo, path, branch, mode, apiKey, smoke, frontend=install.ps1`, each
  `name=value` + NUL, encoded with `UTF8Encoding($false, $true)` (no BOM, throws on lone surrogates ->
  exit 2), written to `node "<helper>"` stdin through `System.Diagnostics.Process` (stdout/stderr inherited),
  stdin closed, exit with the helper's exit code unchanged. Not `$bytes | & node` (5.1 re-encodes as ASCII
  and appends CRLF -> helper rejects), not `Start-Process` (temp file with the key), not argv/env.
- Helper change (additive, contract 1.2.0): optional `frontend` record (`install.sh` | `install.ps1`,
  absent = `install.sh`) switching **messages only**: prefix, usage hint, `-Org` labels, smoke no-key hint.
  install.sh is not modified and does not send it, so its output is byte-identical. File content never
  depends on it (header text `Rewritten by install.sh` kept) -> byte parity of kilo.jsonc across front ends.
- Windows permissions: helper does no chmod on win32; no ACL code anywhere. Files inherit the profile ACL
  (user, SYSTEM, Administrators). Windows-only warning when `XDG_CONFIG_HOME` is set. ACL hardening = follow-up.
- Script format: ASCII-only, no BOM, LF; `.gitattributes` `*.ps1 text eol=lf` (repo uses core.autocrlf=true);
  StrictMode 2.0, EAP Stop, top-level catch -> `install.ps1: error: internal error.` exit 3; output only via
  `[Console]::Out/Error.WriteLine`. PSScriptAnalyzer optional, not gated. FR-11 lint rule 7 already scans
  install.ps1 (it must not contain `KILO_TEST_` or `NODE_OPTIONS`).
- Tests: node:test spawning pwsh / powershell.exe with a from-scratch env, `.cmd`-only stubs on Windows,
  F-019 fake-network preload via `NODE_OPTIONS`; skip with a clear message without PowerShell.

## Backend tasks

Contract: docs/architecture/contracts/installer-cli.md 1.2.0 (sections 4 and 10 are new/changed);
decisions: docs/architecture/ADR-0014-windows-bootstrap-installer.md. Do NOT modify
`backend/installer/install.sh`, `backend/plugin/azdo-remote-config.ts`, `backend/personal-config/kilo.jsonc`,
`backend/test/installer/helpers.ts` behaviour used by install.sh tests (adding exports is fine), or
`backend/package.json` dependencies.

### B1. Helper: optional `frontend` record (contract 4) — supports AC-1, AC-2, AC-6, AC-8
- `backend/installer/install-helper.ts`:
  - add `"frontend"` to `OPTIONAL_RECORDS`; in `parseRecords` reject any value other than `install.sh` /
    `install.ps1` with `badHelperInput()`.
  - module-level `let frontEnd: "install.sh" | "install.ps1" = "install.sh"`, set right after
    `parseRecords` succeeds. Use it for every `install.sh: error:` / `install.sh: warning:` prefix,
    the exit-2 hint (`Run install.sh --help for usage.` vs `Run install.ps1 -Help for usage.`) and the
    `invalid value for --<name>:` label (`-Org`, `-Project`, `-Repo`, `-Path`, `-Branch`, `-Mode` for ps1).
    Bad-helper-input errors (before parse completes) keep `install.sh:`.
- `backend/installer/smoke.ts`: `formatSmoke(report, frontEnd = "install.sh")`; the no-key hint reads
  `... and re-run <frontEnd> to check your Bifrost virtual key.` Default keeps today's text (existing
  smoke unit tests unchanged).
- `personal-config-edit.ts`: unchanged (header text stays `Rewritten by install.sh`).
- Tests: `backend/test/installer/install-helper-frontend.test.ts` (spawn `process.execPath install-helper.ts`
  directly with records on stdin, temp HOME/USERPROFILE, no network, smoke off):
  - no `frontend` record -> messages exactly as before (`install.sh:` prefix, `--org` label);
  - `frontend=install.ps1` + invalid org -> stderr `install.ps1: error: invalid value for -Org: ...` and
    `Run install.ps1 -Help for usage.`, exit 2;
  - `frontend=bogus` or duplicate `frontend` -> exit 3 `install.sh: error: internal error (bad helper input)`;
  - same inputs with/without `frontend=install.ps1` -> byte-identical kilo.jsonc (fresh and update);
  - unit test in smoke.test.ts (or new file): `formatSmoke(noKeyReport, "install.ps1")` hint text.

### B2. `backend/installer/install.ps1` (new) — AC-1..AC-7
Implement exactly contract section 10 / ADR-0014 sections 2-9. Checklist:
- First lines: comment header (ASCII), `Set-StrictMode -Version 2.0`, `$ErrorActionPreference = 'Stop'`,
  `$PSNativeCommandUseErrorActionPreference = $false`. Whole body inside `try { ... } catch {
  [Console]::Error.WriteLine('install.ps1: error: internal error.'); exit 3 }` (make sure `exit` inside try
  is not swallowed; `exit` is not an exception in PowerShell, so it is fine).
- No `param(`, no `[CmdletBinding`, no `$IsWindows`, no `Invoke-Expression`/`iex`, no `Invoke-WebRequest`
  / `Invoke-RestMethod` / `irm` / `iwr`, no `Start-Process`, no `Set-Content` / `Add-Content` / `Out-File`
  / `New-Item` / `Remove-Item` / `Copy-Item` / `Set-Acl`, no `icacls`, no `Write-Host` / `Write-Error`.
  Must not contain the strings `KILO_TEST_` or `NODE_OPTIONS` (lint rule 7).
- Help scan over `$args` (only `[string]` elements compared, `-ieq`), usage text exactly contract 10.3,
  printed line by line with `[Console]::Out.WriteLine`; exit 0 before anything else.
- Parser per contract 10.1 (index loop; value-taking names need `i+1 < $args.Count`; value conversion:
  `[string]` as is, `$null` -> '', number (`-is [ValueType]` and not bool/char... simplest: `[int]`,
  `[long]`, `[double]`, `[decimal]`) -> `[Convert]::ToString(v, [Globalization.CultureInfo]::InvariantCulture)`,
  anything else -> usage error).
- Missing org/project/repo: one stderr line each (`missing required input -Org (or KILO_AZDO_ORG).`), then
  the hint, exit 2. NUL check of all values and `KILO_BIFROST_KEY` -> exit 2.
- Prereqs as contract 10.2 step 4, all reported, exit 1. Native calls in a helper function with local
  `$ErrorActionPreference = 'Continue'`; `& $az account show --output none *> $null`; node version
  `& $node -p process.versions.node 2>$null`.
- Helper lookup (step 5), Windows XDG warning (step 6), records + `System.Diagnostics.Process` hand-over
  (step 7, ADR-0014 section 5 pseudo-code: `FileName` = resolved node path, `Arguments` = `'"' + helper + '"'`,
  `UseShellExecute=$false`, `RedirectStandardInput=$true`, others false; write bytes, catch
  `System.IO.IOException`, close stdin in `finally`, `WaitForExit()`, `exit $p.ExitCode`).
  Optionally `[Array]::Clear($bytes, 0, $bytes.Length)` after writing.
- File: ASCII only, no BOM, LF only. Write it with LF; run `git add --renormalize` is not needed once B3 lands.

### B3. `.gitattributes` (root file) — AC-8
- Add `*.ps1 text eol=lf`. (Root file outside backend/: the orchestrator should let the backend engineer
  make this one-line change in this cycle, or hand it to the CI releaser before tests are committed; the
  static test B7 relies on it on Windows checkouts with core.autocrlf=true.)

### B4. `backend/test/installer/ps-helpers.ts` (new, test-only)
- `findPowerShellHosts(): { primary?: Host; extra: Host[] }` per ADR-0014 section 11 (`KILO_TEST_PWSH`
  override; scan `process.env.PATH` for `pwsh`/`pwsh.exe`; on Windows also
  `<SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe`). Primary = pwsh if found, else powershell.exe;
  `extra` = powershell.exe on Windows when pwsh is primary.
- `PS_SKIP = "PowerShell (pwsh or powershell.exe) not found: install.ps1 tests skipped"`; when no host, the
  test files register tests with `{ skip: PS_SKIP }` and `console.log(PS_SKIP)` once.
- `withPsSandbox(fn)`: temp root with `home/`, `bin/`, `t/`, `ps-state/`, `xdg/`; writes the node stub.
- `stubNodePs(sb, reportedVersion?)`, `stubAzPs(sb, "ok" | "fail", token?)`: Windows -> `node.cmd` /
  `az.cmd` ONLY (CRLF, `@echo off`, append `echo(%*` to `<root>\node-argv.log` / `<root>\az.log`,
  `if "%~1"=="-p"` version branch, then `"<process.execPath>" %*` as last line so its exit code propagates);
  POSIX -> executable `#!/bin/sh` scripts that `printf '%s\n' "$*" >> log` then `exec`. az stub behaviour
  identical to `stubAz` in helpers.ts (account show ok/fail; get-access-token prints token or fails).
- `runInstallPs(sb, host, args, extraEnv, { smoke?, scenario? })`: from-scratch env per ADR-0014 section 11
  (PATH=bin only, HOME, USERPROFILE (Windows), SYSTEMROOT, WINDIR, ComSpec, PATHEXT, TEMP/TMP, LOCALAPPDATA/
  APPDATA and XDG_CACHE_HOME/XDG_DATA_HOME under ps-state, POWERSHELL_TELEMETRY_OPTOUT=1,
  POWERSHELL_UPDATECHECK=Off, DOTNET_CLI_TELEMETRY_OPTOUT=1, NODE_OPTIONS=--import=<fakeNetworkUrl>,
  KILO_TEST_FAKE_NET=<root>/net.json). Adds `-NoSmoke` unless `smoke: true`. Args:
  `["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File", <abs install.ps1>, ...]`,
  `encoding: "utf8"`, `timeout: 60000`. Return stdout/stderr with `\r\n` normalised to `\n` plus raw.
- `assertNoInstallerFootprint(sb)`: `<home>/.config/kilo` absent; `<home>/.config`, if present, holds only
  `powershell`. (PowerShell's own AppData / .cache state is allowed - ADR-0014 fact 6.)
- Reuse `snapshot`, `backups`, `readNetLog`, `requests`, `expectedItemsUrl`, `runInstall`, `findBash` from
  helpers.ts.

### B5. `backend/test/installer/install-ps1.test.ts` (new) — AC-1..AC-5, AC-7
Full suite on the primary host; tests marked [5.1] also run on `extra` hosts.
- AC-1 [5.1] fresh install, `-NoSmoke`, KEY + AZDO_PAT: exit 0; plugin copy byte-equal to
  backend/plugin/azdo-remote-config.ts; kilo.jsonc byte-equal to the install.sh output for the same inputs in
  a second sandbox (`runInstall` + `findBash`; if bash is not found, the helper run directly with the same
  records and no `frontend` record); parsed config has one tuple
  `["./azdo/azdo-remote-config.ts", {org, project, repo, path:"/kilo.jsonc", branch:"main", mode:"defaults"}]`
  and apiKey = KEY. Also XDG case: `XDG_CONFIG_HOME=<tmp>/xdg` -> files under `<xdg>/kilo`; on Windows stderr
  contains the XDG warning, exit 0.
- AC-2 env-only inputs (all six `KILO_AZDO_*`) used; parameter beats env per setting; case-insensitive names
  (`-org`, `-PROJECT`). [5.1] usage errors: missing each of org/project/repo (message names `-Org (or
  KILO_AZDO_ORG)` etc.), `-ApiKey <canary>`, `-Key <canary>`, `-Pat <canary>`, `--org acme`, `-Or acme`,
  positional `<canary>`, `-Org:acme`, `-Org` as last arg -> exit 2, `Run install.ps1 -Help for usage.`,
  canary never in stdout/stderr, no installer footprint, node-argv.log absent (no node run). A usage error
  wins over missing node (no node stub -> still exit 2). `-Help` (and `-h`, `-?`) -> exit 0, stdout starts
  with `Usage: install.ps1`, no node / az call.
- AC-3 update: seed commented config with `model`, `provider.other`, `provider.bifrost.options.headers`,
  apiKey `sk-bf-existing`, `my-other-plugin`, outdated azdo entry; KILO_BIFROST_KEY unset -> other keys
  deep-equal, `my-other-plugin` kept, exactly one azdo entry with supplied options, apiKey unchanged, one
  backup byte-identical to the original; updated kilo.jsonc byte-equal to the install.sh result for the
  same seed (twin sandbox).
- AC-4 no `plugin/` or `plugins/` dir created; azdo-remote-config referenced exactly once; second run with
  same inputs exits 0, `snapshot(configDir)` unchanged, no new backup (fresh start and update start).
- AC-5 prerequisites (exit 1, fixed fix texts, no installer footprint): no az + no PAT; az stub
  `account show` fails; no node; node stub reporting `22.17.0`; both node and credentials failing -> both
  lines. No az + AZDO_PAT set -> passes (az.log absent). [5.1] one of these.
- Windows only: an extensionless `node` file placed in bin before `node.cmd` is ignored (install succeeds).
- AC-7 (non-smoke paths) with KEY `sk-bf-AbCdEf1234567890` and AZDO_PAT sentinel: success, usage-error,
  prerequisite-failure runs -> neither value (nor `AbCdEf1234567890`) in stdout/stderr, node-argv.log, az.log;
  node-argv.log lines are only `-p process.versions.node` and the quoted helper path.
- `helper missing` is not tested by moving files (do not touch the repo tree); optional: copy install.ps1
  alone into a temp dir and run it there -> exit 3 with the fixed message.

### B6. `backend/test/installer/install-ps1-smoke.test.ts` (new) — AC-6, AC-7
Reuse the okScenario / 401 scenario shape and shared config from install-smoke.test.ts.
- [5.1] smoke on, succeeding fakes: exit 0, stdout ends `smoke azdo: pass\nsmoke bifrost: pass\nDone.\n`,
  exactly one Bifrost request with `authorization: Bearer <KEY>`, `loaded` marker present.
- [5.1] Bifrost 401: stdout `smoke bifrost: fail 401`, stderr
  `install.ps1: error: smoke test failed; the installation was kept.`, exit 4, `snapshot(configDir)` equal
  to the success run.
- `-NoSmoke`: no request in the net log, no `smoke` line.
- No key (KILO_BIFROST_KEY unset): `smoke bifrost: skipped no-key` and hint containing `re-run install.ps1`.
- AC-7 smoke-failure path: KEY / PAT / Basic credential not in output or argv logs.

### B7. `backend/test/installer/install-ps1-static.test.ts` (new, runs without PowerShell) — AC-8
- install.ps1 bytes: no BOM, every byte in 0x20-0x7E or 0x0A (no CR, no tab, no non-ASCII).
- No `param(` / `[CmdletBinding` / `$IsWindows` / banned cmdlets of B2 (case-insensitive, word-boundary).
- Contains no `KILO_TEST_` / `NODE_OPTIONS` (belt and braces for lint rule 7).
- contracts/installer-cli.md mentions `install.ps1`, `-Org`, `-NoSmoke`, `KILO_BIFROST_KEY` and exit code 4
  in section 10 (path `../docs/architecture/contracts/installer-cli.md` from backend/).

### B8. Verification — AC-8
- `bash scripts/ci.sh` exits 0 (lint incl. rule 7 over install.ps1, typecheck incl. new test .ts files,
  all tests). Report how many install.ps1 tests ran per host or were skipped.
- `git diff --stat main -- backend/installer/install.sh backend/plugin backend/personal-config backend/package.json`
  is empty (package-lock untouched too).

## Frontend tasks
- None. F-011 is backend only; `frontend/` does not exist (ADR-0001).

## Security notes (for the Security engineer)
- Secrets: KILO_BIFROST_KEY is read from env by install.ps1 and written only to the helper's stdin pipe
  (in memory, never a temp file, never argv, never printed); PAT vars are only tested for non-emptiness by
  install.ps1. Verify node-argv.log / az.log and outputs in B5/B6.
- No echo of argument text on usage errors (canary tests); no PowerShell error records / stack traces
  reach the user (top-level catch, `[Console]` writes only).
- Command resolution: `Get-Command` follows PATH like any shell; on Windows extensionless hits are ignored
  to avoid launching non-executables. PATH hijack is the same trust level as install.sh (user's own PATH).
- `Process.Start` of a `.cmd` (az / node shims) goes through cmd.exe; the only argument passed is the
  quoted helper path (no user data), so batch-argument injection (BatBadBut class) does not apply.
  `az` gets a constant argument list.
- Windows file protection relies on inherited profile ACLs; no chmod/ACL code. XDG_CONFIG_HOME warning on
  Windows. Explicit ACL hardening proposed as a follow-up.
- `irm | iex` installs are unsupported by design ($PSScriptRoot empty -> exit 3); docs (F-016) must
  recommend `-ExecutionPolicy Bypass -File` for a reviewed checkout rather than piping from the web.
- The `frontend` record only changes message text; it cannot change paths, files or exit codes.
- Test seam unchanged: NODE_OPTIONS preload is passed by tests through PowerShell to node; product code
  never mentions it (lint rule 7 now also covers install.ps1).

## Files changed
- `docs/architecture/ADR-0014-windows-bootstrap-installer.md` — new ADR (design, experiments, tests).
- `docs/architecture/contracts/installer-cli.md` — 1.1.0 -> 1.2.0: header, `frontend` record (section 4),
  Windows ACL note (section 6), section 8, new section 10 (install.ps1 parameters, env, order, exit codes,
  usage text, output, file format).
- `docs/architecture/overview.md` — component C5 status, Windows install data flow, layout.
- `docs/architecture/ADR-0001-tech-stack.md` — PowerShell as optional test tool; rule 7 covers install.ps1.
- `docs/architecture/ADR-0012-posix-bootstrap-installer.md` — amended-by ADR-0014.
- `docs/architecture/README.md` — contract pointer.
- `factory/runs/cycle-0014/02-architect.md` — this report.

## Verification
- PowerShell experiments (scratchpad, both hosts): byte-exact stdin, exit code propagation, `.cmd` launch,
  `$args` behaviour, Get-Command extensionless behaviour, host state location — results as listed above.
- No product code changed by the architect; `bash scripts/ci.sh` not affected by doc-only changes.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Manual `$args` parsing instead of `param()` — only way to guarantee exit 2 and no echo on both hosts.
- `frontend` stdin record added to the helper (messages only) — Windows users should see `install.ps1`
  in messages; install.sh untouched and byte-identical in output.
- Personal-config header keeps `Rewritten by install.sh` — preserves byte parity and install.sh output;
  cosmetic, flagged for F-016 docs.
- No ACL code; inherited profile ACL documented, Windows warning when XDG_CONFIG_HOME is set — PO allowed
  documenting the helper's behaviour; explicit ACLs carry account/localisation risk.
- `.gitattributes` edit assigned to the backend engineer (one line, root file) — needed for LF checkout of
  install.ps1 on Windows with autocrlf; orchestrator may route it to the CI releaser instead.
- "Nothing created under the temp profile" is checked as "no installer footprint" (`.config/kilo` absent),
  because PowerShell itself writes host state under the profile (verified).
- Linux CI exercises pwsh 7 on Linux only; Windows PowerShell 5.1 is exercised on Windows dev machines.

## Follow-ups for the backlog
- Windows ACL hardening for the personal config (optional explicit user-only ACL, or a helper check that
  warns when the config dir grants read access to other principals).
- Windows CI job (windows-latest) running scripts/ci.sh so 5.1 and Windows pwsh paths are gated in CI.
- Optional: CI flag making a missing PowerShell on Linux CI a failure instead of a skip.
- F-016 docs: Windows install command line, ExecutionPolicy / Unblock-File, header text note, exit codes.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0014/02-architect.md
summary: install.ps1 designed as a $args-parsing PowerShell 5.1/7 front end piping UTF-8 NUL records to install-helper.ts via System.Diagnostics.Process; contract 1.2.0 (+frontend record), ADR-0014, 8 backend tasks.
