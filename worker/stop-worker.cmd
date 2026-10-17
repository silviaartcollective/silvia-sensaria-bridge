@echo off
rem Stops the shared PC crop + mockup worker, which runs hidden in the background.
rem The running worker writes its process ID to %TEMP%\pod-crop-worker.lock.
powershell -NoProfile -Command "$lock=Join-Path $env:TEMP 'pod-crop-worker.lock'; $id=(Get-Content $lock -ErrorAction SilentlyContinue | Select-Object -First 1); $p=if($id){Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue}; if($p -and $p.ProcessName -eq 'node'){ Stop-Process -Id $p.Id -Force; Write-Host 'Shared PC worker stopped.' } else { Write-Host 'The shared PC worker is not running.' }; Remove-Item $lock -ErrorAction SilentlyContinue"
pause
