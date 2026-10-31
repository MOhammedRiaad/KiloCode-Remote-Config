# ADR-0014: Windows bootstrap installer (`install.ps1`) as a thin front end over the install helper
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0014 / F-011
- Amends: ADR-0012 (installer), ADR-0013 (smoke test), contract `installer-cli.md` 1.1.0 -> 1.2.0

## Context

FR-18 asks for an `install.ps1` for Windows with the same behaviour as `install.sh` (F-010) and
its smoke test (F-019). The PO fixed the shape (cycle 0014): a thin PowerShell front end that
parses parameters, applies env / defaults, checks prerequisites and then feeds the existing
`install-helper.ts` through the stdin protocol of contract section 4. All file work, personal
config editing, backups and the smoke test stay in the helper. Constraints:

- Runs unmodified on **Windows PowerShell 5.1** (in-box, .NET Framework) and **PowerShell 7+**
  (`pwsh`, .NET), no module installs, no Pester.
- The virtual key comes only from `KILO_BIFROST_KEY` and travels on stdin only; no secret in
  argv, output or a file written by the front end.
- Zero runtime npm deps (FR-11); `install.sh` behaviour must not change.
- Tests run under `node:test` on Linux CI (`ubuntu-latest` ships `pwsh`) and Windows dev machines
  (both `pwsh` and `powershell.exe`), with a temp profile, stub `node` / `az`, and the F-019 fake
  network.

Experiments run by the architect on this cycle's Windows host (pwsh 7.6.9 and Windows
PowerShell 5.1.26100) established the facts the decisions below rely on:

1. `System.Diagnostics.Process` with `RedirectStandardInput = $true` and bytes written to
   `StandardInput.BaseStream` delivers the bytes **exactly** to the child on both hosts (UTF-8
   without BOM, NUL bytes, CR/LF inside values, non-ASCII, no trailing newline).
2. With stdout / stderr **not** redirected, the child writes straight to the inherited handles:
   PowerShell does not re-encode the helper's output.
3. `Process.Start` with `UseShellExecute = $false` launches a `.cmd` file (the `az.cmd` / test
   `node.cmd` case) on both hosts; stdin passes through `cmd.exe` to the real `node.exe`.
4. `-File` passes every argument to `$args` as a string, including `-Org`, `-?`, empty strings
   and `-NoSmoke:$false` (split into two tokens by both hosts).
5. On Windows, `Get-Command -CommandType Application` returns an **extensionless** file (e.g. the
   `#!/bin/sh` stubs the `install.sh` tests write) as an application, and running it does not
   execute it (no exit code). Without `PATHEXT` in the environment `.cmd` files are not found.
6. PowerShell creates its own host state under `<USERPROFILE>\AppData\...` (known-folder API;
   `LOCALAPPDATA` / `APPDATA` env values are ignored) and, on Linux, under `$XDG_CACHE_HOME` /
   `~/.cache`. This is not installer output.
7. Native-command calls with `2>`/`*>` redirection under `$ErrorActionPreference = 'Stop'` can
   throw on 5.1; a function-local `$ErrorActionPreference = 'Continue'` avoids it.

## Decision

### 1. Split (unchanged from ADR-0012)

`backend/installer/install.ps1` is a front end only: no file writes, no network, no JSON
handling, no ACL calls. It uses PowerShell language features, `Get-Command`, `Join-Path`,
`Test-Path`, `[Console]`, `[System.Text.UTF8Encoding]` and `[System.Diagnostics.Process]` only,
plus the external commands `node` and `az`. All file work stays in `install-helper.ts`
(unchanged rules: ADR-0012 sections 4-6, ADR-0013).

### 2. Parameter parsing: manual, over `$args`, no `param()` block

PowerShell's own parameter binding prints the offending parameter name (`A parameter cannot be
found that matches parameter name 'ApiKey'`), exits 1 and allows prefix abbreviations. That
breaks the contract (exit 2, never echo the argument). So the script has **no `param()` block
and no `[CmdletBinding()]`** and parses `$args` itself:

- Names are matched **case-insensitively and exactly** (no abbreviations): `-Org`, `-Project`,
  `-Repo`, `-Path`, `-Branch`, `-Mode` take the next argument as value (even if it looks like a
  parameter, as in `install.sh`); `-NoSmoke` takes no value. Last occurrence wins.
- Help: any argument equal (case-insensitive) to `-Help`, `-h`, `-?` or `--help` prints usage to
  stdout and exits 0, scanned before anything else (like `install.sh`).
- Everything else is a usage error (exit 2, fixed text, argument never echoed): unknown names
  (`-ApiKey`, `-Key`, `-Pat`, `--org`), `-Name:value` forms, positional arguments, a value-taking
  parameter in last position, and (in-process `&` calls only) a value that is an array or a
  non-string object other than a number (numbers are converted with the invariant culture).
- There is no parameter for the key or a PAT.

### 3. Prerequisites

Same rules and fixed messages as `install.sh` (contract section 3), prefix `install.ps1:`.

- Command lookup: `Get-Command -Name <n> -CommandType Application -ErrorAction SilentlyContinue`,
  first result in PATH order. **On Windows** (`[System.Environment]::OSVersion.Platform -eq
  'Win32NT'`; `$IsWindows` does not exist on 5.1) only results whose extension is `.exe`, `.cmd`,
  `.bat` or `.com` count (fact 5). The real Azure CLI is `az.cmd`; real Node is `node.exe`.
- Node: `& <node> -p process.versions.node`, first output line trimmed, parsed with
  `^(\d+)\.(\d+)(\.|$)`; >= 22.18 passes. The reported version is printed only if it matches
  `^[0-9A-Za-z.+-]{1,32}$`, else `unknown`.
- Credentials: any of `AZDO_PAT` / `AZURE_DEVOPS_EXT_PAT` / `KILO_AZDO_PAT` non-empty -> pass, `az`
  not run. Else `az` must resolve and `& <az> account show --output none *> $null` must leave
  `$LASTEXITCODE` 0.
- Native calls run inside a function with a local `$ErrorActionPreference = 'Continue'` (fact 7).
  The script sets `$PSNativeCommandUseErrorActionPreference = $false` (7.3+; harmless on 5.1).

### 4. Locating the helper

`Join-Path $PSScriptRoot 'install-helper.ts'`. If `$PSScriptRoot` is empty (script text run via
`-Command`, `iex`) or the file is not a leaf, exit 3 with
`install.ps1: error: installer sources are missing (expected install-helper.ts next to install.ps1).`
Running the script from a pipe (`irm ... | iex`) is therefore not supported, by design. A helper
path containing `"` (impossible on Windows) is refused with the same message.

### 5. Handing over to the helper: `System.Diagnostics.Process`, bytes on stdin

```
records = org, project, repo, path, branch, mode, apiKey (= $env:KILO_BIFROST_KEY or ''),
          smoke (on | off), frontend (= install.ps1)
text    = concat(record + [char]0 for each record)
bytes   = (New-Object System.Text.UTF8Encoding($false, $true)).GetBytes(text)   # no BOM, throw on lone surrogates
psi     = ProcessStartInfo: FileName = <resolved node path>, Arguments = '"' + helper + '"',
          UseShellExecute = $false, RedirectStandardInput = $true,
          RedirectStandardOutput = $false, RedirectStandardError = $false
p = [System.Diagnostics.Process]::Start(psi)
try { p.StandardInput.BaseStream.Write(bytes, 0, bytes.Length); Flush() } catch [System.IO.IOException] { }  # child exited early
finally { p.StandardInput.Close() }
p.WaitForExit(); exit p.ExitCode
```

Rejected alternatives (see below): piping a string or `byte[]` to `& node` (5.1 encodes with
`$OutputEncoding`, ASCII by default, and appends CRLF, which the helper rejects as "data after the
last NUL"; raw byte piping exists only in 7.4+), `Start-Process -RedirectStandardInput` (needs a
temp file holding the key), passing values as arguments or environment (argv exposure, and
`KILO_*` env is not read by the helper by contract).

A value or key containing a NUL character (only possible for in-process calls) is a usage error,
as is text that is not valid Unicode (`UTF8Encoding` throws). The helper's exit code is
returned unchanged (as in `install.sh`).

### 6. Helper protocol amendment: optional `frontend` record (contract 1.2.0)

The helper prints `install.sh: ...`, `Run install.sh --help for usage.`, `--<name>` and
`re-run install.sh`, which would be wrong for Windows users. New optional record `frontend`, at
most once, value exactly `install.sh` or `install.ps1`; absent = `install.sh`. With
`install.ps1` the helper uses the prefix `install.ps1:`, `Run install.ps1 -Help for usage.`,
parameter labels `-Org`, `-Project`, `-Repo`, `-Path`, `-Branch`, `-Mode` in
`invalid value for ...` messages and `re-run install.ps1` in the smoke hint. Errors raised before
the records are fully parsed (bad helper input) keep the `install.sh:` prefix.

`install.sh` does not send the record and is not modified, so its output is byte-identical to
1.1.0. **File contents never depend on `frontend`**: the update header comment keeps the text
`Rewritten by install.sh` so that `install.ps1` and `install.sh` produce byte-identical personal
configs for the same inputs (AC-1/AC-3 parity). The cosmetic mismatch for Windows users is
accepted and noted for F-016 docs.

### 7. Output and encoding

The front end prints only fixed ASCII text through `[Console]::Out.WriteLine` /
`[Console]::Error.WriteLine` (no `Write-Host`, `Write-Error`, `Write-Output` or pipeline output, so
no PowerShell error records, colours or decorations reach the user). Line ending is the
platform's (`CRLF` on Windows); the helper's own lines are LF. Tests normalise CRLF. A top-level
`try { ... } catch { [Console]::Error.WriteLine('install.ps1: error: internal error.'); exit 3 }`
guarantees no stack trace or exception text is ever printed.

### 8. Windows file permissions (documented, no ACL code)

On `win32` the helper performs no `chmod` (ADR-0012 section 6) and `install.ps1` sets no ACLs.
New files and directories inherit the ACL of their parent. Under the default profile
`%USERPROFILE%\.config\kilo` that is: the user, `SYSTEM` and `Administrators` (full control), which
is the Windows equivalent of `0600` plus root. Risk: when `XDG_CONFIG_HOME` points outside the
profile (e.g. a shared drive) the personal config, which holds the virtual key, inherits that
folder's ACL. Mitigation in this cycle: on Windows, when `XDG_CONFIG_HOME` is non-empty,
`install.ps1` prints the fixed warning
`install.ps1: warning: XDG_CONFIG_HOME is set: make sure only your account can read that folder, because kilo.jsonc holds your Bifrost virtual key.`
before handing over (it does not change the exit code). Explicit ACL hardening (`icacls` /
`Set-Acl`, or a Node check of the effective ACL) is a backlog follow-up, not part of F-011.

### 9. Script file format

- **ASCII only, no BOM, LF line endings.** ASCII sidesteps the 5.1 rule that BOM-less scripts are
  read in the ANSI code page; both hosts accept LF. `.gitattributes` gains `*.ps1 text eol=lf`
  (this repo is checked out with `core.autocrlf=true` on Windows).
- `Set-StrictMode -Version 2.0`, `$ErrorActionPreference = 'Stop'` at the top.
- No `Invoke-Expression` / `iex`, no web cmdlets, no `Start-Process`, no file-writing cmdlets
  (`Set-Content`, `Add-Content`, `Out-File`, `New-Item`, `Remove-Item`, `Copy-Item`, `Set-Acl`), no
  `icacls`, no `param(` / `[CmdletBinding`, no `$IsWindows`. Enforced by a static test.
- FR-11 lint rule 7 (no `KILO_TEST_` / `NODE_OPTIONS` text in `installer/`) applies to `install.ps1`
  automatically (it scans every file directly in `installer/`). No new lint rule.
- PSScriptAnalyzer is optional for local use and not part of the gate (needs a module install).

### 10. Supported hosts

Windows 10/11 with Windows PowerShell 5.1 or PowerShell 7+. The script also runs under `pwsh` on
Linux / macOS (that is how Linux CI tests it) but `install.sh` remains the documented installer
there. Engineers run it as
`powershell -NoProfile -ExecutionPolicy Bypass -File .\backend\installer\install.ps1 -Org ... `
(the default `RemoteSigned` policy blocks unsigned downloaded scripts; `Unblock-File` is the
alternative). Documented by F-016.

### 11. Testing approach

- New `backend/test/installer/ps-helpers.ts`. PowerShell discovery: `KILO_TEST_PWSH` (absolute
  path) overrides; else `pwsh` / `pwsh.exe` found by scanning `process.env.PATH`; on Windows also
  `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` if it exists. None found -> every
  install.ps1 test is registered with `{ skip: "PowerShell (pwsh or powershell.exe) not found: install.ps1 tests skipped" }`
  and the message is also printed once with `console.log` (so the skip is visible in CI logs).
- Hosts: the **full** suite runs on the primary host (`pwsh` if present, else `powershell.exe`).
  On Windows, when both exist, a parity subset also runs on `powershell.exe` (5.1).
- Spawn: `spawnSync(<absolute host path>, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy",
  "Bypass", "-File", <install.ps1>, ...args], { env, encoding: "utf8", timeout: 60000 })`.
  (`-ExecutionPolicy` is ignored on non-Windows pwsh; harmless.)
- Env is built from scratch (never inherits `process.env`): `PATH=<tmp>/bin`, `HOME=<tmp>/home`,
  `NODE_OPTIONS=--import=<fake-network URL>`, `KILO_TEST_FAKE_NET=<tmp>/net.json`,
  `POWERSHELL_TELEMETRY_OPTOUT=1`, `POWERSHELL_UPDATECHECK=Off`, `DOTNET_CLI_TELEMETRY_OPTOUT=1`,
  `XDG_CACHE_HOME` / `XDG_DATA_HOME` = `<tmp>/ps-state/...` (never `XDG_CONFIG_HOME` unless the test
  is about it). On Windows also `USERPROFILE=<tmp>/home`, `SYSTEMROOT`, `WINDIR`, `ComSpec`,
  `PATHEXT=.COM;.EXE;.BAT;.CMD`, `TEMP`/`TMP=<tmp>/t`, `LOCALAPPDATA` / `APPDATA` under `<tmp>/ps-state`.
- Stubs in `<tmp>/bin`, separate from the `install.sh` helpers: on Windows **only** `node.cmd`
  and `az.cmd` (no extensionless files, fact 5), on POSIX executable `#!/bin/sh` `node` / `az`.
  Each stub appends its argv to `<tmp>/node-argv.log` / `<tmp>/az.log`; the node stub can report
  a fixed version for `-p`, otherwise forwards to `process.execPath`.
- "Nothing created" means: `<home>/.config/kilo` does not exist and `<home>/.config` holds nothing
  but (Linux pwsh) `powershell`. PowerShell's own host state (fact 6) is not installer output.
- Parity: `install.ps1` output is compared byte-for-byte with `install.sh` (existing `runInstall`
  from `helpers.ts`, `findBash()`) in a second sandbox with the same inputs; when bash is not
  available, with the helper run directly (`node install-helper.ts` fed the same records without a
  `frontend` record).
- No network (fake-network preload denies everything without a scenario), no real `az`, no real
  home, no Kilo.

## Consequences

- One implementation of FR-20/FR-22/FR-23; Windows parity holds by construction and is proved by
  byte comparison against `install.sh`.
- The helper gains a small, additive protocol change (`frontend`); `install.sh` output unchanged.
- Windows protection of the personal config relies on inherited profile ACLs (documented,
  warning when `XDG_CONFIG_HOME` is set); explicit ACL code is deferred.
- The Windows personal config header still says "Rewritten by install.sh" after an update.
- Test time grows by roughly one PowerShell start (0.3-1 s) per case; acceptable.
- CI on `ubuntu-latest` exercises `pwsh` 7 on Linux; Windows PowerShell 5.1 and `pwsh` on Windows
  are exercised on Windows dev machines only (no Windows CI runner yet).

## Alternatives considered

- **PowerShell `param()` block with typed parameters**: idiomatic, but binding errors echo the
  parameter name, exit 1 and accept abbreviations. Rejected (contract exit 2, no echo).
- **Re-implementing file work in PowerShell**: two diverging implementations of FR-20/22/23,
  JSONC editing in PowerShell. Rejected by the PO and here.
- **Pipeline to native command (`$bytes | & node`)**: mangles bytes on 5.1 (fact list above).
- **Temp file + `Start-Process -RedirectStandardInput`**: writes the key to disk. Rejected.
- **ACL hardening now (`icacls /inheritance:r /grant:r %USERNAME%:F`)**: changes the security
  model of the profile folder, needs its own test matrix (domain accounts, localized group
  names). Deferred; default profile ACLs already restrict access to the user and administrators.
- **Pester tests**: needs a module install / version pinning; `node:test` keeps one runner.
- **UTF-8 BOM in the script**: needed only for non-ASCII content; ASCII-only is simpler and
  avoids BOM-sensitive tooling.
