# Register hrm-agent:// URL so the web app can start the ZKT agent (Admin -> Devices -> Run agent).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$runScript = Join-Path $PSScriptRoot "run-agent-window.ps1"
if (-not (Test-Path $runScript)) {
    $runScript = Join-Path $PSScriptRoot "run-agent.ps1"
}
$command = "powershell.exe -Sta -NoExit -ExecutionPolicy Bypass -File `"$runScript`""

$root = "HKCU:\Software\Classes\hrm-agent"
New-Item -Path $root -Force | Out-Null
Set-ItemProperty -Path $root -Name "(Default)" -Value "URL:HRM ZKT Agent"
New-ItemProperty -Path $root -Name "URL Protocol" -Value "" -Force | Out-Null

$cmdKey = "$root\shell\open\command"
New-Item -Path $cmdKey -Force | Out-Null
Set-ItemProperty -Path $cmdKey -Name "(Default)" -Value $command

Write-Host "Registered hrm-agent://start -> run-agent-window.ps1" -ForegroundColor Green
Write-Host "Start launcher: double-click Start-Launcher.cmd or run:  & .\agent-launcher.ps1" -ForegroundColor DarkGray
