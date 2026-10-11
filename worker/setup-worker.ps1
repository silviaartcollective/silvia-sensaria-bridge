$ErrorActionPreference = "Stop"
$WorkerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $WorkerDir
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {throw "Node.js 20+ is required."}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {throw "npm is required."}
Write-Host "Shared PC Crop + Mockup Worker - Arté Antica, Silvia and Japandi" -ForegroundColor Cyan
Write-Host "Use each shop's OWN Render CROP_WORKER_TOKEN. Tokens are never sent to the other shops."
$target = Join-Path $WorkerDir "config.local.json"
$previous=$null
if(Test-Path $target){
 try{$previous=Get-Content $target -Raw | ConvertFrom-Json}
 catch{Write-Host "Existing configuration is unreadable; it will be replaced." -ForegroundColor Yellow}
}
$definitions=@(
 @{name="Arte Antica"; url="https://arte-antica-product-creator.onrender.com"},
 @{name="Silvia Art Collective"; url="https://silvia-sensaria-bridge.onrender.com"},
 @{name="Japandi Art Collective"; url="https://japandi-sensaria-bridge.onrender.com"}
)
$apps=@()
foreach($entry in $definitions){
 $existing=@($previous.apps | Where-Object { $_.appUrl -eq $entry.url -or $_.name -eq $entry.name } | Select-Object -First 1)
 $oldToken=if($existing.Count -gt 0){[string]$existing[0].workerToken}else{""}
 Write-Host ""
 Write-Host "$($entry.name): $($entry.url)"
 $hint=if($oldToken.Length -ge 24){" [Enter to keep existing]"}else{""}
 $token=Read-Host "CROP_WORKER_TOKEN for $($entry.name)$hint"
 if([string]::IsNullOrWhiteSpace($token)){$token=$oldToken}
 if([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 24){
  throw "Missing or invalid CROP_WORKER_TOKEN for $($entry.name). No configuration was overwritten."
 }
 $apps+=@{name=$entry.name;appUrl=$entry.url;workerToken=$token.Trim()}
}
$config=@{apps=$apps;workerId="pod-crop-main-pc";pollIntervalMs=3000;idleExitMs=0}
Write-Host ""
Write-Host "Installing Sharp and Puppeteer Core for production crops and Photoshop PSD mockups…"
npm install
if($LASTEXITCODE -ne 0){throw "npm install failed."}
node --input-type=module -e "import('sharp').then(async ({default:sharp})=>{await sharp({create:{width:2,height:2,channels:3,background:'#ffffff'}}).jpeg().toBuffer();console.log('Sharp ready.')})"
if($LASTEXITCODE -ne 0){throw "Sharp is not ready; please review npm install messages."}
node --input-type=module -e "import('puppeteer-core').then(()=>console.log('Puppeteer Core ready.')).catch(e=>{console.error(e);process.exit(1);})"
if($LASTEXITCODE -ne 0){throw "Puppeteer Core is missing. Check npm install messages."}
$BrowserPaths=@(
  "$env:PROGRAMFILES\\Google\\Chrome\\Application\\chrome.exe",
  "$env:PROGRAMFILES\\Microsoft\\Edge\\Application\\msedge.exe",
  "${env:PROGRAMFILES(X86)}\\Microsoft\\Edge\\Application\\msedge.exe",
  "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe"
)
if(-not ($BrowserPaths | Where-Object { Test-Path $_ } | Select-Object -First 1)){
 Write-Host "Warning: Chrome/Edge not found in usual locations. Install one or set PHOTOPEA_CHROME_PATH for PSD rendering." -ForegroundColor Yellow
}
$config | ConvertTo-Json -Depth 6 | Set-Content -Path $target -Encoding UTF8
& (Join-Path $WorkerDir "install-protocol.ps1")
if($LASTEXITCODE -ne 0){throw "Windows protocol installation failed."}
Write-Host ""
Write-Host "Shared Crop + Mockup Worker configured for all 3 shops. Start worker/start-worker.cmd ONCE." -ForegroundColor Green
