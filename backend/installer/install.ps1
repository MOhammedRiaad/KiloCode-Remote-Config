# Bootstrap installer for Windows (ADR-0014, contract installer-cli.md section 10).
# Front end only: parses inputs, checks prerequisites, then hands over to install-helper.ts,
# which does all file work. Writes no file itself. Runs on Windows PowerShell 5.1 and PowerShell 7+.
# Run it with: powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Org ... -Project ... -Repo ...
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Out-Text([string]$text) {
  [Console]::Out.WriteLine($text)
}

function Err-Text([string]$text) {
  [Console]::Error.WriteLine($text)
}

function Fail-Usage([string]$message) {
  Err-Text ('install.ps1: error: ' + $message)
  Err-Text 'Run install.ps1 -Help for usage.'
  exit 2
}

function Show-Usage {
  Out-Text 'Usage: install.ps1 -Org <org> -Project <project> -Repo <repo> [-Path <path>] [-Branch <branch>] [-Mode defaults|enforce] [-NoSmoke]'
  Out-Text '       install.ps1 -Help'
  Out-Text ''
  Out-Text 'Installs the Azure DevOps remote-config plugin and your personal Kilo config.'
  Out-Text 'Inputs can also come from KILO_AZDO_ORG, KILO_AZDO_PROJECT, KILO_AZDO_REPO,'
  Out-Text 'KILO_AZDO_PATH, KILO_AZDO_BRANCH and KILO_AZDO_MODE (parameters win).'
  Out-Text 'Your Bifrost virtual key is read from KILO_BIFROST_KEY (there is no parameter for it).'
  Out-Text 'After installing, a smoke test reads the shared config from Azure DevOps and calls Bifrost GET <baseURL>/models; -NoSmoke skips it.'
  Out-Text 'Requires Node.js 22.18 or later and either `az login` or AZDO_PAT.'
  Out-Text 'Exit codes: 0 ok, 1 prerequisite, 2 usage, 3 file system, 4 installed but smoke test failed.'
  Out-Text 'Run it with: powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 ...'
}

function Convert-ArgValue($value) {
  if ($null -eq $value) { return '' }
  if ($value -is [string]) { return $value }
  if (($value -is [int]) -or ($value -is [long]) -or ($value -is [double]) -or ($value -is [decimal])) {
    return [Convert]::ToString($value, [System.Globalization.CultureInfo]::InvariantCulture)
  }
  Fail-Usage 'unknown option or argument.'
}

function Get-Setting([string]$value, [string]$envName, [string]$default) {
  if ($value -ne '') { return $value }
  $fromEnv = [Environment]::GetEnvironmentVariable($envName)
  if (-not [string]::IsNullOrEmpty($fromEnv)) { return $fromEnv }
  return $default
}

function Test-HasNul([string]$text) {
  return ($text.IndexOf([char]0) -ge 0)
}

function Test-Windows {
  return ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT)
}

function Find-Tool([string]$name) {
  $found = @(Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue)
  foreach ($candidate in $found) {
    $source = [string]$candidate.Source
    if (-not (Test-Windows)) { return $source }
    $extension = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
    if (@('.exe', '.cmd', '.bat', '.com') -contains $extension) { return $source }
  }
  return $null
}

# Runs a native command with a constant argument list; never throws. Returns exit code and stdout lines.
function Invoke-Probe([string]$exe, [string[]]$exeArguments) {
  $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = -1
  $lines = @()
  try {
    $lines = @(& $exe @exeArguments 2>$null)
  } catch {
    return @{ Code = -1; Lines = @() }
  }
  return @{ Code = [int]$global:LASTEXITCODE; Lines = $lines }
}

function Test-NodeVersion([string]$node) {
  $probe = Invoke-Probe $node @('-p', 'process.versions.node')
  $version = ''
  if ($probe.Lines.Count -gt 0) { $version = ([string]$probe.Lines[0]).Trim() }
  if (($probe.Code -eq 0) -and ($version -match '^([0-9]{1,6})\.([0-9]{1,6})(\.|$)')) {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    if (($major -gt 22) -or (($major -eq 22) -and ($minor -ge 18))) { return $true }
  }
  $shown = 'unknown'
  if ($version -match '^[0-9A-Za-z.+-]{1,32}$') { $shown = $version }
  Err-Text ('install.ps1: error: Node.js 22.18 or later is required (found ' + $shown + ').')
  return $false
}

function Test-Credentials {
  foreach ($name in @('AZDO_PAT', 'AZURE_DEVOPS_EXT_PAT', 'KILO_AZDO_PAT')) {
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) { return $true }
  }
  $az = Find-Tool 'az'
  if ($null -eq $az) {
    Err-Text "install.ps1: error: No Azure DevOps credentials: install the Azure CLI and run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope."
    return $false
  }
  $probe = Invoke-Probe $az @('account', 'show', '--output', 'none')
  if ($probe.Code -ne 0) {
    Err-Text "install.ps1: error: The Azure CLI is not logged in: run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope."
    return $false
  }
  return $true
}

function Get-InputBytes([string[]]$records) {
  $builder = New-Object System.Text.StringBuilder
  foreach ($record in $records) {
    [void]$builder.Append($record)
    [void]$builder.Append([char]0)
  }
  try {
    $encoding = New-Object System.Text.UTF8Encoding($false, $true)
    return , $encoding.GetBytes($builder.ToString())
  } catch {
    Err-Text 'install.ps1: error: an input is not valid Unicode text.'
    exit 2
  }
}

# Starts node on the helper with the records on stdin (bytes, no BOM); returns the helper's exit code.
function Invoke-Helper([string]$node, [string]$helper, [byte[]]$bytes) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $node
  $startInfo.Arguments = '"' + $helper + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $false
  $startInfo.RedirectStandardError = $false
  $process = [System.Diagnostics.Process]::Start($startInfo)
  try {
    $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $process.StandardInput.BaseStream.Flush()
  } catch [System.IO.IOException] {
    # the helper exited before reading everything; its exit code tells why
  } finally {
    $process.StandardInput.Close()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
  $process.WaitForExit()
  return [int]$process.ExitCode
}

try {
  foreach ($argument in $args) {
    if (($argument -is [string]) -and (@('-help', '-h', '-?', '--help') -contains $argument.ToLowerInvariant())) {
      Show-Usage
      exit 0
    }
  }

  $valueNames = @{ '-org' = 'org'; '-project' = 'project'; '-repo' = 'repo'; '-path' = 'path'; '-branch' = 'branch'; '-mode' = 'mode' }
  $given = @{ org = ''; project = ''; repo = ''; path = ''; branch = ''; mode = '' }
  $smoke = 'on'
  $index = 0
  while ($index -lt $args.Count) {
    if ($args[$index] -isnot [string]) { Fail-Usage 'unknown option or argument.' }
    $name = ([string]$args[$index]).ToLowerInvariant()
    if ($name -eq '-nosmoke') {
      $smoke = 'off'
      $index += 1
    } elseif ($valueNames.ContainsKey($name)) {
      if (($index + 1) -ge $args.Count) { Fail-Usage 'unknown option or argument.' }
      $given[$valueNames[$name]] = Convert-ArgValue $args[$index + 1]
      $index += 2
    } else {
      Fail-Usage 'unknown option or argument.'
    }
  }

  $org = Get-Setting $given['org'] 'KILO_AZDO_ORG' ''
  $project = Get-Setting $given['project'] 'KILO_AZDO_PROJECT' ''
  $repo = Get-Setting $given['repo'] 'KILO_AZDO_REPO' ''
  $path = Get-Setting $given['path'] 'KILO_AZDO_PATH' '/kilo.jsonc'
  $branch = Get-Setting $given['branch'] 'KILO_AZDO_BRANCH' 'main'
  $mode = Get-Setting $given['mode'] 'KILO_AZDO_MODE' 'defaults'

  $missing = $false
  foreach ($required in @(@('Org', 'ORG', $org), @('Project', 'PROJECT', $project), @('Repo', 'REPO', $repo))) {
    if ($required[2] -eq '') {
      Err-Text ('install.ps1: error: missing required input -' + $required[0] + ' (or KILO_AZDO_' + $required[1] + ').')
      $missing = $true
    }
  }
  if ($missing) {
    Err-Text 'Run install.ps1 -Help for usage.'
    exit 2
  }

  $apiKey = [Environment]::GetEnvironmentVariable('KILO_BIFROST_KEY')
  if ($null -eq $apiKey) { $apiKey = '' }
  foreach ($text in @($org, $project, $repo, $path, $branch, $mode, $apiKey)) {
    if (Test-HasNul $text) { Fail-Usage 'an input contains a NUL character.' }
  }

  $node = Find-Tool 'node'
  $prereqOk = $true
  if ($null -eq $node) {
    Err-Text 'install.ps1: error: Node.js was not found on PATH. Install Node.js 22.18 or later and re-run.'
    $prereqOk = $false
  } elseif (-not (Test-NodeVersion $node)) {
    $prereqOk = $false
  }
  if (-not (Test-Credentials)) { $prereqOk = $false }
  if (-not $prereqOk) { exit 1 }

  $helper = ''
  if (-not [string]::IsNullOrEmpty($PSScriptRoot)) { $helper = Join-Path $PSScriptRoot 'install-helper.ts' }
  if (($helper -eq '') -or $helper.Contains('"') -or -not (Test-Path -LiteralPath $helper -PathType Leaf)) {
    Err-Text 'install.ps1: error: installer sources are missing (expected install-helper.ts next to install.ps1).'
    exit 3
  }

  if ((Test-Windows) -and -not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('XDG_CONFIG_HOME'))) {
    Err-Text 'install.ps1: warning: XDG_CONFIG_HOME is set: make sure only your account can read that folder, because kilo.jsonc holds your Bifrost virtual key.'
  }

  $records = @("org=$org", "project=$project", "repo=$repo", "path=$path", "branch=$branch", "mode=$mode", "apiKey=$apiKey", "smoke=$smoke", 'frontend=install.ps1')
  $bytes = Get-InputBytes $records
  exit (Invoke-Helper $node $helper $bytes)
} catch {
  [Console]::Error.WriteLine('install.ps1: error: internal error.')
  exit 3
}
