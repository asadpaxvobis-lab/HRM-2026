# One-time setup: auto-start HRM web dev server when you log in to Windows.
# Run as normal user (not admin required for AtLogOn trigger).
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$EnsureScript = Join-Path $PSScriptRoot "ensure-dev-server.ps1"
$TaskName = "HRM-2026-WebDev"

if (-not (Test-Path $EnsureScript)) {
    throw "Missing $EnsureScript"
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$EnsureScript`" -Quiet"

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Starts HRM ERP Vite dev server (localhost:5173) after Windows logon." `
    -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "The dev server will start automatically when you sign in to Windows."
Write-Host ""
Write-Host "Start now:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$EnsureScript`""
Write-Host ""
Write-Host "Remove autostart:"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
