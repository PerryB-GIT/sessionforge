# swap-service.ps1
# Rule 3 (L009): Codify the service swap — stop, replace binary, restart.
# Run as Administrator.
#
# Usage: powershell scripts/swap-service.ps1
#        powershell scripts/swap-service.ps1 -NewBinary "C:\path\to\custom.exe"

param(
    [string]$NewBinary = "$PSScriptRoot\..\agent\sessionforge-new.exe",
    [string]$ServiceBinary = "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe",
    [string]$ServiceName = "SessionForgeAgent"
)

$ErrorActionPreference = "Stop"

# Verify new binary exists and is newer
if (-not (Test-Path $NewBinary)) {
    Write-Host "FAIL: New binary not found: $NewBinary" -ForegroundColor Red
    Write-Host "Build it first: cd agent && go build -o sessionforge-new.exe ./cmd/sessionforge/"
    exit 1
}

if (Test-Path $ServiceBinary) {
    $newTime = (Get-Item $NewBinary).LastWriteTime
    $svcTime = (Get-Item $ServiceBinary).LastWriteTime
    if ($newTime -le $svcTime) {
        Write-Host "WARN: New binary is NOT newer than service binary" -ForegroundColor Yellow
        Write-Host "  New:     $newTime"
        Write-Host "  Service: $svcTime"
        $confirm = Read-Host "Continue anyway? (y/N)"
        if ($confirm -ne "y") { exit 0 }
    }
}

Write-Host "=== SessionForge Service Swap ===" -ForegroundColor Cyan

# 1. Stop
Write-Host "Stopping $ServiceName..." -ForegroundColor White
sc.exe stop $ServiceName 2>&1 | Out-Null
Start-Sleep 2

# Confirm stopped
$state = (sc.exe query $ServiceName | Select-String "STATE").ToString()
if ($state -notmatch "STOPPED") {
    Write-Host "  Waiting for service to stop..." -ForegroundColor Yellow
    Start-Sleep 3
}

# 2. Copy
Write-Host "Copying new binary..." -ForegroundColor White
Copy-Item $NewBinary $ServiceBinary -Force
Write-Host "  $NewBinary -> $ServiceBinary" -ForegroundColor Green

# 3. Start
Write-Host "Starting $ServiceName..." -ForegroundColor White
sc.exe start $ServiceName 2>&1 | Out-Null
Start-Sleep 2

$state = (sc.exe query $ServiceName | Select-String "STATE").ToString()
Write-Host "  Service state: $state"

if ($state -match "RUNNING") {
    Write-Host "DONE: Service running with new binary." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next: start a session in the browser, then run:"
    Write-Host "  powershell scripts/check-session-output.ps1"
} else {
    Write-Host "WARN: Service may not be running — check state above." -ForegroundColor Yellow
}
