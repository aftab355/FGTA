@echo off
REM Double-click launcher for the FGTA recorder.
REM Installs dependencies on first run, then starts and opens the dashboard.

cd /d "%~dp0"
title FGTA recorder

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Get the LTS build from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   First run - installing. This downloads a private copy of Chromium
  echo   (about 150 MB) and takes a couple of minutes.
  echo.
  call npm install || (echo. & echo   Install failed - see the messages above. & pause & exit /b 1)
)

start "" http://localhost:8910
node index.js
pause
