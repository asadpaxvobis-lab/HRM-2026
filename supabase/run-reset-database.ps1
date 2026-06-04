# Open Supabase SQL Editor with RESET_ALL_DATA.sql on clipboard (full wipe + reseed).
# Optional: set $env:SUPABASE_DB_PASSWORD and install psql to run automatically.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$sqlFile = Join-Path $PSScriptRoot "RESET_ALL_DATA.sql"

if (-not (Test-Path $sqlFile)) {
    Write-Host "Missing $sqlFile" -ForegroundColor Red
    exit 1
}

$sql = Get-Content -Raw -Path $sqlFile
Set-Clipboard -Value $sql

$url = "https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/sql/new"
Write-Host "RESET_ALL_DATA.sql copied to clipboard." -ForegroundColor Green
Write-Host "Opening SQL Editor — paste (Ctrl+V) and click RUN." -ForegroundColor Yellow
Write-Host "Login after reset: admin@hrm.com / admin123" -ForegroundColor Cyan
Start-Process $url

if ($env:SUPABASE_DB_PASSWORD) {
    $host = "db.zxkkmwycimijvbpgqpfh.supabase.co"
    $env:PGPASSWORD = $env:SUPABASE_DB_PASSWORD
    $psql = Get-Command psql -ErrorAction SilentlyContinue
    if ($psql) {
        Write-Host "Running reset via psql..." -ForegroundColor Cyan
        & psql -h $host -p 5432 -U postgres -d postgres -f $sqlFile
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Remote database reset complete." -ForegroundColor Green
            exit 0
        }
    }
}

if ($env:SUPABASE_ACCESS_TOKEN) {
    Set-Location $root
    Write-Host "Trying: npx supabase db execute --linked ..." -ForegroundColor Cyan
    npx --yes supabase@latest link --project-ref zxkkmwycimijvbpgqpfh 2>$null
    npx --yes supabase@latest db execute --file $sqlFile --linked
}
