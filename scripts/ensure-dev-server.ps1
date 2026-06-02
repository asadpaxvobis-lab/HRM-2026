# Starts the Vite dev server (http://localhost:5173) if it is not already running.
# Safe to run repeatedly — used by Cursor folder-open task and Windows logon task.
param(
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$WebDir = Join-Path $Root "apps\web"
$LogDir = Join-Path $Root ".dev-server"
$LogOut = Join-Path $LogDir "vite.log"
$LogErr = Join-Path $LogDir "vite.err.log"
$PidFile = Join-Path $LogDir "vite.pid"
$Url = "http://127.0.0.1:5173/"

function Write-DevLog([string]$Message) {
    if (-not $Quiet) { Write-Host $Message }
}

function Test-DevServerHealthy {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Get-ListenerPid {
    $conn = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    return $null
}

if (Test-DevServerHealthy) {
    Write-DevLog "HRM web dev server already running at $Url"
    exit 0
}

$listenerPid = Get-ListenerPid
if ($listenerPid) {
    Write-DevLog "Port 5173 is in use (PID $listenerPid) but health check failed - wait or run scripts/stop-dev-server.ps1"
    exit 1
}

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Write-DevLog "Installing npm dependencies (first run)..."
    Push-Location $Root
    npm install
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-DevLog "Starting HRM web dev server in background -> $Url"
Write-DevLog "Logs: $LogOut"

$proc = Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $WebDir `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $LogOut `
    -RedirectStandardError $LogErr

$proc.Id | Out-File -FilePath $PidFile -Encoding ascii -Force

$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (Test-DevServerHealthy) {
        Write-DevLog "Ready: $Url"
        exit 0
    }
    if ($proc.HasExited) {
        Write-DevLog "Dev server exited early. Last log lines:"
        if (Test-Path $LogErr) { Get-Content $LogErr -Tail 15 | ForEach-Object { Write-DevLog $_ } }
        if (Test-Path $LogOut) { Get-Content $LogOut -Tail 15 | ForEach-Object { Write-DevLog $_ } }
        exit 1
    }
}

Write-DevLog "Server still starting - open $Url in a few seconds. Check $LogOut if it fails."
exit 0
