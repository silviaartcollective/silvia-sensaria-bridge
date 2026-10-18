@echo off
rem Updates the shared PC worker to the latest version now. The worker also
rem updates itself when it is idle; use this if that is turned off or failed.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)
node update-worker.mjs %*
pause
