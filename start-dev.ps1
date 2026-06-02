# Start HRM web app (http://localhost:5173) in the foreground — logs in this window.
# For background / auto-start use: npm run dev:ensure  or  npm run dev:autostart (once)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}

Write-Host "Starting HRM ERP at http://localhost:5173"
Write-Host "Press Ctrl+C to stop. For background: npm run dev:ensure"
Set-Location "apps\web"
npm run dev
