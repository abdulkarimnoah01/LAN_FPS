@echo off
title LAN_FPS Publisher
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish_update.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Publish encountered an issue. Press any key to exit...
    pause >nul
)
