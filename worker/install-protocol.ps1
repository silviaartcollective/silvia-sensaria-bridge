$ErrorActionPreference = "Stop"
$WorkerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $WorkerDir "start-worker.cmd"

if (-not (Test-Path $StartScript)) {
  throw "start-worker.cmd was not found in $WorkerDir"
}

function Register-WorkerProtocol([string]$Protocol, [string]$Description) {
  $ProtocolRoot = "HKCU:\Software\Classes\$Protocol"
  New-Item -Path $ProtocolRoot -Force | Out-Null

  # Set the actual unnamed/default registry value. Using a property literally
  # named "(Default)" can leave Windows with no protocol description/handler.
  Set-Item -Path $ProtocolRoot -Value $Description
  New-ItemProperty -Path $ProtocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

  $CommandKey = Join-Path $ProtocolRoot "shell\open\command"
  New-Item -Path $CommandKey -Force | Out-Null
  $Command = 'cmd.exe /c ""' + $StartScript + '" "%1""'
  Set-Item -Path $CommandKey -Value $Command

  $registered = (Get-Item -Path $CommandKey).GetValue("")
  if ([string]::IsNullOrWhiteSpace($registered) -or $registered -notlike "*start-worker.cmd*") {
    throw "Failed to register $Protocol protocol command."
  }
}

Register-WorkerProtocol "pod-crop-worker" "URL:Shared POD Crop Worker"
Register-WorkerProtocol "arteantica-worker" "URL:Shared POD Crop Worker"
Register-WorkerProtocol "silvia-worker" "URL:Shared POD Crop Worker"
Register-WorkerProtocol "japandi-worker" "URL:Shared POD Crop Worker"

Write-Host "Installed pod-crop-worker:// protocol."
Write-Host "Kept arteantica-worker:// as a compatibility alias."
Write-Host "Windows protocol command verified."
