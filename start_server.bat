@echo off
title Spectre Orbit - Matchmaking Server
echo ========================================================
echo   SPECTRE ORBIT ONLINE // MATCHMAKING SERVER
echo   Babylon.js 9 WebGPU Matchmaking & Signaling Service
echo ========================================================
echo.
echo Starting server on http://localhost:8080 ...
echo Press Ctrl+C anytime to stop.
echo.
cd /d "%~dp0"
node server/index.mjs
pause
