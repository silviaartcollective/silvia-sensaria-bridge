@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Node.js 20 or newer is required for the Shared POD Crop Worker.','Shared POD Crop Worker')"
  exit /b 1
)

if not exist "%~dp0config.local.json" (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('The Shared POD Crop Worker has not been set up yet. Run setup-worker.cmd first.','Shared POD Crop Worker')"
  exit /b 1
)

if not exist "%~dp0node_modules\sharp" (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Crop worker dependencies are missing. Run setup-worker.cmd again.','Shared POD Crop Worker')"
  exit /b 1
)

if not exist "%~dp0node_modules\ag-psd" (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Shared Crop + Mockup Worker has been updated. Run setup-worker.cmd once to install the PSD reader.','Shared POD Worker')"
  exit /b 1
)

rem Let image work from every render thread run at once (Node defaults to 4).
set "UV_THREADPOOL_SIZE=16"
rem A page asks for the worker while it is already running: nothing to do. (The
rem running worker holds worker.log open, so this must not write to it.)
powershell -NoProfile -WindowStyle Hidden -Command "$lock=Join-Path $env:TEMP 'pod-crop-worker.lock'; $id=(Get-Content $lock -ErrorAction SilentlyContinue | Select-Object -First 1); if($id -and (Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue | Where-Object ProcessName -eq 'node')){exit 3}; exit 0"
if "%errorlevel%"=="3" exit /b 0
(echo [%date% %time%] Launch requested)>>"%~dp0launch.log" 2>nul
rem supervise.mjs runs the worker and starts it again if it ever stops unexpectedly.
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','node supervise.mjs >> worker.log 2>&1' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
exit /b 0
