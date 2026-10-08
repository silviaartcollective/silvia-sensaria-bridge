$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Installing Silvia Crop Worker..."
npm install

$appUrl = Read-Host "Silvia Render URL [https://silvia-sensaria-bridge.onrender.com]"
if ([string]::IsNullOrWhiteSpace($appUrl)) {
  $appUrl = "https://silvia-sensaria-bridge.onrender.com"
}
$token = Read-Host "CROP_WORKER_TOKEN from Render"
if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 24) {
  throw "Worker token must be at least 24 characters."
}

$config = @{
  appUrl = $appUrl.TrimEnd("/")
  workerToken = $token
  workerId = "silvia-main-pc"
  pollIntervalMs = 3000
  idleExitMs = 0
} | ConvertTo-Json

Set-Content -Path (Join-Path $PSScriptRoot "config.local.json") -Value $config -Encoding UTF8
& (Join-Path $PSScriptRoot "install-protocol.ps1")
Write-Host "Silvia Crop Worker setup complete."
