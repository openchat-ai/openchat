@echo off
cd /d "%~dp0"
title opencode-remote-watchdog
echo Watchdog started, monitoring bot...

:loop
powershell -NoProfile -Command "if (-not (Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'cli.*weixin' })) { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo Bot not running, starting...
  start /b cmd /c "opencode-remote weixin"
)
timeout /t 30 /nobreak >nul
goto loop
