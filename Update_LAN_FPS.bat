@echo off
title LAN_FPS Online Updater
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update_LAN_FPS.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Update encountered an issue. Press any key to exit...
    pause >nul
)
