# One-time setup for HRM ZKT Agent (Supabase key + .NET + HTTP URL reservation)
# Run: powershell -ExecutionPolicy Bypass -File .\setup-agent.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = "C:\Program Files (x86)\dotnet;C:\Program Files\dotnet;$env:LOCALAPPDATA\Microsoft\dotnet;" + $env:Path

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

function Ensure-UrlAcl([int]$Port) {
    $url = "http://+:$Port/"
    $existing = netsh http show urlacl 2>$null | Select-String [regex]::Escape($url)
    if ($existing) {
        Write-Host "URL reservation already exists for $url" -ForegroundColor DarkGray
        return $true
    }
    Write-Host "Registering $url (needed for LAN access from other PCs)..." -ForegroundColor Cyan
    netsh http add urlacl url=$url user="$env:USERDOMAIN\$env:USERNAME" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Could not register URL (try Run as Administrator):" -ForegroundColor Yellow
        Write-Host "  netsh http add urlacl url=$url user=Everyone" -ForegroundColor Yellow
        return $false
    }
    Write-Host "URL reservation OK." -ForegroundColor Green
    return $true
}

Write-Host "`n=== HRM ZKT Agent setup ===`n" -ForegroundColor Cyan

$dotnet = Find-DotNet
if (-not $dotnet) {
    Write-Host ".NET 8 SDK is not installed." -ForegroundColor Red
    Write-Host "Install (then re-run this script):" -ForegroundColor Yellow
    Write-Host "  winget install Microsoft.DotNet.SDK.8" -ForegroundColor White
    Write-Host "  winget install Microsoft.DotNet.Runtime.8 --architecture x86" -ForegroundColor White
    exit 1
}
Write-Host ".NET: $(& $dotnet --version)" -ForegroundColor Green

if (-not (Test-Path "appsettings.Local.json")) {
    Copy-Item "appsettings.example.json" "appsettings.Local.json"
    Write-Host "Created appsettings.Local.json" -ForegroundColor Green
}

$cfg = Get-Content "appsettings.Local.json" -Raw | ConvertFrom-Json
$key = $env:Supabase__ServiceRoleKey
if (Test-ServiceRolePlaceholder $key) {
    $key = $cfg.Supabase.ServiceRoleKey
}
if (Test-ServiceRolePlaceholder $key) {
    Write-Host "`nSupabase service_role key required." -ForegroundColor Yellow
    Write-Host "Do NOT use sb_publishable_... (that key is only for the web login in apps/web/.env)." -ForegroundColor DarkGray
    Write-Host "Use sb_secret_... from service_role on this page:" -ForegroundColor DarkGray
    Write-Host "https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/settings/api`n" -ForegroundColor White
    $plain = Read-Host "Paste service_role key (sb_secret_...)"
    if (Test-ServiceRolePlaceholder $plain) {
        Write-Host "Invalid or empty key." -ForegroundColor Red
        exit 1
    }
    if (-not $cfg.Supabase) { $cfg | Add-Member -NotePropertyName Supabase -NotePropertyValue ([pscustomobject]@{}) }
    $cfg.Supabase | Add-Member -NotePropertyName Url -NotePropertyValue "https://zxkkmwycimijvbpgqpfh.supabase.co" -Force
    $cfg.Supabase | Add-Member -NotePropertyName ServiceRoleKey -NotePropertyValue $plain.Trim() -Force
    $cfg | ConvertTo-Json -Depth 6 | Set-Content "appsettings.Local.json" -Encoding UTF8
    Write-Host "Saved service role key to appsettings.Local.json" -ForegroundColor Green
}

$listenLan = $true
if ($cfg.Agent -and $null -ne $cfg.Agent.ListenOnLan) {
    $listenLan = [bool]$cfg.Agent.ListenOnLan
}
$port = 17880
if ($cfg.Agent -and $cfg.Agent.TriggerPort) {
    $port = [int]$cfg.Agent.TriggerPort
}
if ($listenLan) {
    Ensure-UrlAcl $port | Out-Null
}

Write-Host ""
Write-Host "Building agent for win-x86..." -ForegroundColor Cyan
& $dotnet build Hrm.ZktAgent.csproj -c Release -r win-x86
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nSetup complete. Start the agent with:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File .\run-agent.ps1`n" -ForegroundColor White
Write-Host "Then in HRM: Admin -> Devices -> Test agent (http://127.0.0.1:17880)" -ForegroundColor DarkGray
Write-Host "Also run migration APPLY_0035_ZKT_AGENT.sql in Supabase SQL Editor if not done yet.`n" -ForegroundColor DarkGray
