@echo off
REM Double-click launcher for the FGTA recorder.
REM Installs dependencies on first run, then starts and opens the dashboard.

cd /d "%~dp0"

if "%~1"=="--child" goto run

REM QuickEdit is on by default in Windows consoles, and it is a genuine hazard
REM for something meant to be left running for hours: one stray click inside
REM the window puts the console into selection mode, which BLOCKS the process
REM on its next write to stdout. The recorder logs constantly, so it freezes
REM within seconds - window still open, prompt still there, nothing recording
REM and nothing to say so. Console properties are stored per window title, so
REM this turns QuickEdit off for windows called "FGTA recorder" and nothing
REM else on the machine, then relaunches with that title so it takes effect
REM now rather than next time. (Pressing Esc unfreezes a console stuck this
REM way, if you ever meet one.)
reg add "HKCU\Console\FGTA recorder" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>nul
reg add "HKCU\Console\FGTA recorder" /v InsertMode /t REG_DWORD /d 0 /f >nul 2>nul
start "FGTA recorder" "%~f0" --child
exit /b 0

:run
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
  echo   and ffmpeg (about 230 MB) and takes a couple of minutes.
  echo.
  call npm install || (echo. & echo   Install failed - see the messages above. & pause & exit /b 1)
)

start "" http://localhost:8910
node index.js
pause
