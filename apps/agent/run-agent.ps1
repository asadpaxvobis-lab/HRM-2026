# Run HRM ZKT Agent (requires .NET 8 x86 runtime + ZKTime on this PC)
# First time: powershell -ExecutionPolicy Bypass -File .\setup-agent.ps1
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files (x86)\dotnet;C:\Program Files\dotnet;$env:LOCALAPPDATA\Microsoft\dotnet;" + $env:Path
Set-Location $PSScriptRoot

function Find-DotNet {
    foreach ($p in @(
            "C:\Program Files\dotnet\dotnet.exe",
            "C:\Program Files (x86)\dotnet\dotnet.exe",
            "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe"
        )) {
        if (Test-Path $p) { return $p }
    }
    $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Test-ServiceRolePlaceholder([string]$Key) {
    if ([string]::IsNullOrWhiteSpace($Key)) { return $true }
    $k = $Key.Trim()
    if ($k -match '^sb_publishable_') { return $true }
    return $k -match 'paste-service-role' -or $k -match 'YOUR_SERVICE_ROLE' -or $k -match 'PASTE_YOUR'
}

function Test-PublishableKeyMisuse([string]$Key) {
    if ([string]::IsNullOrWhiteSpace($Key)) { return $false }
    $k = $Key.Trim()
    return $k -match '^sb_publishable_'
}

if (-not (Test-Path "appsettings.Local.json")) {
    Write-Host "Missing appsettings.Local.json. Run setup first:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\setup-agent.ps1" -ForegroundColor White
    exit 1
}

$key = $env:Supabase__ServiceRoleKey
if (Test-ServiceRolePlaceholder $key) {
    $cfg = Get-Content "appsettings.Local.json" -Raw | ConvertFrom-Json
    $key = $cfg.Supabase.ServiceRoleKey
}
if (Test-PublishableKeyMisuse $key) {
    Write-Host "The publishable (anon) key cannot be used by the agent." -ForegroundColor Red
    Write-Host "Web app uses sb_publishable_... in apps/web/.env (already set)." -ForegroundColor DarkGray
    Write-Host "Agent needs service_role (sb_secret_...) from:" -ForegroundColor Yellow
    Write-Host "  https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/settings/api" -ForegroundColor White
    Write-Host "Run: powershell -ExecutionPolicy Bypass -File .\setup-agent.ps1" -ForegroundColor Yellow
    exit 1
}
if (Test-ServiceRolePlaceholder $key) {
    Write-Host "Supabase service_role key not configured. Run:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\setup-agent.ps1" -ForegroundColor White
    Write-Host "Or set env Supabase__ServiceRoleKey" -ForegroundColor Yellow
    exit 1
}

$dotnet = Find-DotNet
if (-not $dotnet) {
    Write-Host ".NET 8 not found. Run setup-agent.ps1 or:" -ForegroundColor Red
    Write-Host "  winget install Microsoft.DotNet.SDK.8" -ForegroundColor Yellow
    exit 1
}

$old = Get-Process -Name "Hrm.ZktAgent" -ErrorAction SilentlyContinue
if ($old) {
    Write-Host "Stopping old agent process(es)..." -ForegroundColor DarkGray
    $old | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Write-Host "Starting HRM ZKT Agent..." -ForegroundColor Cyan
Write-Host "Disconnect the device in ZKTime before sync, or close ZKTime." -ForegroundColor DarkGray
Write-Host "Web: Admin -> Devices -> Test agent at http://127.0.0.1:17880" -ForegroundColor DarkGray

& $dotnet build Hrm.ZktAgent.csproj -c Release -r win-x86 -v q
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed." -ForegroundColor Red
    exit 1
}

$exe = Join-Path $PSScriptRoot "bin\Release\net8.0\win-x86\Hrm.ZktAgent.exe"
if (-not (Test-Path $exe)) {
    Write-Host "Build output missing." -ForegroundColor Red
    exit 1
}

Write-Host "Leave this window open. Stop with Ctrl+C." -ForegroundColor Yellow
& $exe
