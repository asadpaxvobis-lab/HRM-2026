@echo off
REM Double-click or run from cmd (avoids nested powershell "Access is denied" in some setups).
cd /d "%~dp0"
title HRM Agent Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-launcher.ps1"
echo.
pause
