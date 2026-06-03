@echo off
cd /d "%~dp0"
title HRM ZKT Agent
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-agent-window.ps1"
