# Start HRM web app (http://localhost:5173)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}

Write-Host "Starting HRM ERP at http://localhost:5173"
Write-Host "Press Ctrl+C to stop."
Set-Location "apps\web"
npm run dev
