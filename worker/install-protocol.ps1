param(
  [string]$WorkerDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$protocol = "silvia-worker"
$command = 'cmd.exe /c start "" "' + (Join-Path $WorkerDir 'start-worker.cmd') + '"'
$base = "HKCU:\Software\Classes\$protocol"

New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name "(Default)" -Value "URL:Silvia Crop Worker"
Set-ItemProperty -Path $base -Name "URL Protocol" -Value ""
New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\shell\open\command" -Name "(Default)" -Value $command

Write-Host "Registered $protocol://start"
