param(
 [Parameter(Mandatory=$true)][string]$Script,
 [Parameter(Mandatory=$true)][string]$Diagnostic
)
$ErrorActionPreference = 'Stop'
try {
 $photoshop = New-Object -ComObject Photoshop.Application -ErrorAction Stop
} catch {
 [System.IO.File]::WriteAllText($Diagnostic, 'Photoshop COM unavailable: '+[string]$_.Exception.Message)
 exit 9
}
try {
 $photoshop.DoJavaScriptFile($Script) | Out-Null
 exit 0
} catch {
 [System.IO.File]::WriteAllText($Diagnostic, 'Photoshop script execution failed: '+[string]$_.Exception.Message)
 exit 10
}
