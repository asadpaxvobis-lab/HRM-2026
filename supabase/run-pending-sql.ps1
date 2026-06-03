# Open Supabase SQL Editor with PUSH_PENDING_MIGRATIONS.sql on clipboard (run manually).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$sqlFile = Join-Path $PSScriptRoot "PUSH_PENDING_MIGRATIONS.sql"

if (-not (Test-Path $sqlFile)) {
    Write-Host "Missing $sqlFile" -ForegroundColor Red
    exit 1
}

$sql = Get-Content -Raw -Path $sqlFile
Set-Clipboard -Value $sql

$url = "https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/sql/new"
Write-Host "SQL copied to clipboard." -ForegroundColor Green
Write-Host "Opening Supabase SQL Editor - paste Ctrl+V and click RUN." -ForegroundColor Yellow
Start-Process $url

if ($env:SUPABASE_ACCESS_TOKEN) {
    Write-Host "Trying CLI push..." -ForegroundColor Cyan
    Set-Location $root
    $pushScript = Join-Path $PSScriptRoot "push-to-remote.ps1"
    & $pushScript
}
