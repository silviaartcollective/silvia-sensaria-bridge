@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\sharp" (
  echo Silvia Crop Worker is not set up yet.
  echo Run setup-worker.cmd first.
  pause
  exit /b 1
)
node index.mjs
