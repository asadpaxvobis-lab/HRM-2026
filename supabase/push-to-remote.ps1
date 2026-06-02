# Push pending SQL migrations to linked Supabase project (zxkkmwycimijvbpgqpfh)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$sqlFile = Join-Path $PSScriptRoot "PUSH_PENDING_MIGRATIONS.sql"
if (-not (Test-Path $sqlFile)) {
    Write-Host "Missing $sqlFile" -ForegroundColor Red
    exit 1
}

Write-Host "Pushing migrations via Supabase CLI..." -ForegroundColor Cyan
Write-Host "Project ref: zxkkmwycimijvbpgqpfh" -ForegroundColor DarkGray

$linked = Join-Path $root ".supabase"
if (-not (Test-Path $linked)) {
    Write-Host "Linking project (you may be prompted for database password)..." -ForegroundColor Yellow
    npx --yes supabase@latest link --project-ref zxkkmwycimijvbpgqpfh --workdir $root
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Link failed. Run SQL manually in dashboard:" -ForegroundColor Yellow
        Write-Host "  https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/sql/new" -ForegroundColor White
        Write-Host "  File: supabase/PUSH_PENDING_MIGRATIONS.sql" -ForegroundColor White
        exit 1
    }
}

npx --yes supabase@latest db query --file $sqlFile --linked --workdir $root
if ($LASTEXITCODE -ne 0) {
    Write-Host "CLI push failed. Paste supabase/PUSH_PENDING_MIGRATIONS.sql in SQL Editor." -ForegroundColor Yellow
    exit 1
}

Write-Host "Done. Verifying columns..." -ForegroundColor Green
npx --yes supabase@latest db query --linked --workdir $root "SELECT column_name FROM information_schema.columns WHERE table_name = 'attendance_devices' AND column_name LIKE 'agent%' ORDER BY 1;"
