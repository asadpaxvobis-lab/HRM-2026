# Stops the background Vite dev server on port 5173.
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path $PSScriptRoot -Parent
$PidFile = Join-Path $Root ".dev-server\vite.pid"

$stopped = $false

if (Test-Path $PidFile) {
    $storedPid = [int](Get-Content $PidFile -Raw)
    if ($storedPid -gt 0) {
        Stop-Process -Id $storedPid -Force -ErrorAction SilentlyContinue
        $stopped = $true
        Write-Host "Stopped dev server PID $storedPid"
    }
    Remove-Item $PidFile -Force
}

$conn = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conn) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped process on port 5173 (PID $($c.OwningProcess))"
    $stopped = $true
}

if (-not $stopped) {
    Write-Host "No dev server found on port 5173."
}
