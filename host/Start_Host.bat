@echo off
title Spectre Orbit - Host
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_host.ps1" %*
if errorlevel 1 pause
