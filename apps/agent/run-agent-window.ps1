# Wrapper: keeps PowerShell open so errors are visible (used by Run agent button).
$host.UI.RawUI.WindowTitle = 'HRM ZKT Agent'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '=== HRM ZKT Agent ===' -ForegroundColor Cyan
Write-Host ''

& "$PSScriptRoot\run-agent.ps1"
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host ''
    Write-Host "Agent did not start (exit code $exitCode). Read the messages above." -ForegroundColor Red
    Write-Host 'Fix: run setup-agent.ps1 once, then try again.' -ForegroundColor Yellow
    Write-Host ''
    Read-Host 'Press Enter to close'
    exit $exitCode
}

# run-agent.ps1 blocks on Hrm.ZktAgent.exe until you press Ctrl+C there
if (-not (Get-Process -Name 'Hrm.ZktAgent' -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host 'Agent process ended.' -ForegroundColor Yellow
    Read-Host 'Press Enter to close'
}
