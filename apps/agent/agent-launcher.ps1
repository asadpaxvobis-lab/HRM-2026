# Lightweight local API so HRM web (Admin -> Devices) can start the ZKT agent on this PC.
#
# How to start (do NOT nest "powershell -File" inside another PowerShell — Access denied on some PCs):
#   Option A: Double-click Start-Launcher.cmd
#   Option B: In this folder, run:  & .\agent-launcher.ps1
#   Option C: From repo root:  npm run launcher:agent  (run in cmd.exe, not nested in PS)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$port = 17879
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")

try {
    $listener.Start()
} catch {
    Write-Host "Could not bind http://127.0.0.1:$port/ - is another launcher running?" -ForegroundColor Red
    exit 1
}

Write-Host "HRM agent launcher listening on http://127.0.0.1:$port/" -ForegroundColor Cyan
Write-Host "POST /start  -> opens run-agent.ps1 in a new PowerShell window" -ForegroundColor DarkGray
Write-Host "Leave this window open (or add to Windows startup)." -ForegroundColor DarkGray

function Send-Json($ctx, [int]$status, $obj) {
    $json = $obj | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $ctx.Response.StatusCode = $status
    $ctx.Response.ContentType = "application/json"
    $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
    $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
}

$agentRunning = {
    $p = Get-Process -Name "Hrm.ZktAgent" -ErrorAction SilentlyContinue
    return $null -ne $p
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath.TrimEnd("/").ToLowerInvariant()
    $method = $ctx.Request.HttpMethod

    if ($method -eq "OPTIONS") {
        Send-Json $ctx 204 @{ ok = $true }
        continue
    }

    if ($path -eq "/health" -and $method -eq "GET") {
        Send-Json $ctx 200 @{
            ok = $true
            service = "Hrm.ZktAgent.Launcher"
            agentRunning = & $agentRunning
            agentDir = $PSScriptRoot
        }
        continue
    }

    if ($path -eq "/start" -and $method -eq "POST") {
        if (& $agentRunning) {
            Send-Json $ctx 200 @{
                ok = $true
                started = $false
                alreadyRunning = $true
                message = "Hrm.ZktAgent is already running."
            }
            continue
        }

        $runScript = Join-Path $PSScriptRoot "run-agent-window.ps1"
        if (-not (Test-Path $runScript)) {
            $runScript = Join-Path $PSScriptRoot "run-agent.ps1"
        }
        if (-not (Test-Path $runScript)) {
            Send-Json $ctx 500 @{ ok = $false; error = 'run-agent-window.ps1 not found' }
            continue
        }

        $psArgs = "-Sta -NoExit -ExecutionPolicy Bypass -File `"$runScript`""
        try {
            Start-Process -FilePath 'powershell.exe' -WorkingDirectory $PSScriptRoot -WindowStyle Normal -ArgumentList $psArgs
        } catch {
            # Fallback when Start-Process powershell is blocked (corporate policy)
            Start-Process -FilePath 'cmd.exe' -WorkingDirectory $PSScriptRoot -WindowStyle Normal -ArgumentList @(
                '/c',
                'start',
                '"HRM ZKT Agent"',
                'powershell.exe',
                $psArgs
            )
        }

        Send-Json $ctx 202 @{
            ok = $true
            started = $true
            message = "Agent starting in a new PowerShell window. Leave it open."
        }
        continue
    }

    Send-Json $ctx 404 @{ ok = $false; error = 'Use GET /health or POST /start' }
}
