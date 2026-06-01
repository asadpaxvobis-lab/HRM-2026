# Run HRM ZKT Agent (requires .NET 8 x86 runtime + ZKTime on this PC)
# If scripts are blocked:  powershell -ExecutionPolicy Bypass -File .\run-agent.ps1
$env:Path = "C:\Program Files (x86)\dotnet;C:\Program Files\dotnet;" + $env:Path
Set-Location $PSScriptRoot

if (-not (Test-Path "appsettings.Local.json")) {
    Write-Host "Create appsettings.Local.json from appsettings.example.json and set ServiceRoleKey." -ForegroundColor Yellow
    exit 1
}

if ($env:Supabase__ServiceRoleKey) {
    Write-Host "Using Supabase__ServiceRoleKey from environment." -ForegroundColor DarkGray
} else {
    $config = Get-Content "appsettings.Local.json" -Raw
    if ($config -match "PASTE_YOUR_SERVICE_ROLE") {
        Write-Host "Set service role key in appsettings.Local.json OR:" -ForegroundColor Yellow
        Write-Host '  $env:Supabase__ServiceRoleKey = "your-key"' -ForegroundColor Yellow
        Write-Host "Get key: Supabase Dashboard -> Settings -> API -> service_role" -ForegroundColor Yellow
        exit 1
    }
}

$old = Get-Process -Name "Hrm.ZktAgent" -ErrorAction SilentlyContinue
if ($old) {
    Write-Host "Stopping old agent process(es)..." -ForegroundColor DarkGray
    $old | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Write-Host "Starting HRM ZKT Agent (32-bit, for ZKTime)..." -ForegroundColor Cyan
Write-Host "Tip: In ZKTime click DISCONNECT on the device before sync, or close ZKTime." -ForegroundColor DarkGray
Write-Host "Web UI: Admin -> Devices -> Test agent / Pull (http://127.0.0.1:17880)" -ForegroundColor DarkGray

$env:Path = "C:\Program Files (x86)\dotnet;C:\Program Files\dotnet;" + $env:Path
dotnet build Hrm.ZktAgent.csproj -c Release -r win-x86 -v q | Out-Null
$exe = Join-Path $PSScriptRoot "bin\Release\net8.0\win-x86\Hrm.ZktAgent.exe"
if (-not (Test-Path $exe)) {
    Write-Host "Build failed. Install .NET 8 x86 runtime: winget install Microsoft.DotNet.Runtime.8 --architecture x86" -ForegroundColor Red
    exit 1
}

Write-Host "Leave this window open. Press Ctrl+C to stop." -ForegroundColor Yellow
& $exe
