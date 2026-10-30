# Windows runner for the AI Factory. Same behaviour as scripts/factory-loop.sh.
# Usage: pwsh scripts/factory-loop.ps1 [-MaxCycles 10] [-PermissionMode acceptEdits] [-Model opus]
param(
    [int]$MaxCycles = $(if ($env:FACTORY_MAX_CYCLES) { [int]$env:FACTORY_MAX_CYCLES } else { 10 }),
    [string]$PermissionMode = $(if ($env:FACTORY_PERMISSION_MODE) { $env:FACTORY_PERMISSION_MODE } else { 'acceptEdits' }),
    [string]$Model = $env:FACTORY_MODEL,
    [int]$MaxTurns = $(if ($env:FACTORY_MAX_TURNS) { [int]$env:FACTORY_MAX_TURNS } else { 400 })
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force factory/logs | Out-Null

function Get-FactoryStatus { (Get-Content factory/state.json -Raw | ConvertFrom-Json).status }

bash scripts/bootstrap.sh
if ($LASTEXITCODE -ne 0) { throw 'bootstrap failed' }

for ($i = 1; $i -le $MaxCycles; $i++) {
    if (Test-Path factory/STOP) { Write-Host 'factory: STOP file present - stopping'; break }
    $status = Get-FactoryStatus
    if ($status -ne 'running') { Write-Host "factory: status=$status - stopping"; break }

    $log = "factory/logs/cycle-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
    Write-Host "factory: iteration $i/$MaxCycles - log $log"

    $claudeArgs = @('-p', '/factory-cycle', '--permission-mode', $PermissionMode, '--max-turns', $MaxTurns, '--output-format', 'text')
    if ($Model) { $claudeArgs += @('--model', $Model) }

    & claude @claudeArgs 2>&1 | Tee-Object -FilePath $log
    if ($LASTEXITCODE -ne 0) { Write-Host "factory: claude exited $LASTEXITCODE (see $log); continuing" }
}

Write-Host "factory: final status=$(Get-FactoryStatus)"
