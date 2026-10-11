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

if not exist "%~dp0node_modules\puppeteer-core" (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Shared Crop + Mockup Worker has been updated. Run setup-worker.cmd once to install PSD processing.','Shared POD Worker')"
  exit /b 1
)

set "LOG=%~dp0worker.log"
echo [%date% %time%] Launch requested>>"%LOG%"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','node index.mjs >> worker.log 2>&1' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
exit /b 0
