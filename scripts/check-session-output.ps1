# check-session-output.ps1
# Quick diagnostic: did the last session produce output?
# Usage: powershell scripts/check-session-output.ps1
#
# Exit codes: 0 = PASS, 1 = FAIL

param(
    [string]$LogFile = "$env:USERPROFILE\.sessionforge\agent.log",
    [int]$TailLines = 200
)

$pass = $true

Write-Host "=== SessionForge Session Output Diagnostic ===" -ForegroundColor Cyan
Write-Host "Log: $LogFile"
Write-Host ""

# 1. Service account
$svcInfo = sc.exe qc SessionForgeAgent 2>&1 | Select-String "SERVICE_START_NAME"
$account = if ($svcInfo) { $svcInfo.ToString().Trim() } else { "UNKNOWN" }
Write-Host "Service account : $account"
if ($account -match "LocalSystem") {
    Write-Host "  WARN: Running as LocalSystem — WSL unavailable, pipes tier will be used" -ForegroundColor Yellow
}

# 2. Binary freshness
$svcBin  = "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe"
$srcBin  = "$PSScriptRoot\..\agent\sessionforge-new.exe"
if (Test-Path $svcBin) {
    Write-Host "Service binary  : $((Get-Item $svcBin).LastWriteTime)"
}
if (Test-Path $srcBin) {
    $newer = (Get-Item $srcBin).LastWriteTime -gt (Get-Item $svcBin).LastWriteTime
    Write-Host "New binary ready: $srcBin ($((Get-Item $srcBin).LastWriteTime))"
    if ($newer) {
        Write-Host "  ACTION: New binary is newer — swap with service binary and restart" -ForegroundColor Yellow
    }
}

# 3. Read log tail
if (-not (Test-Path $LogFile)) {
    Write-Host ""
    Write-Host "FAIL: Log file not found at $LogFile" -ForegroundColor Red
    exit 1
}
$lines = Get-Content $LogFile -Tail $TailLines

# 4. Spawn tier selected
$tierLine = $lines | Select-String "spawn tier detection complete" | Select-Object -Last 1
Write-Host ""
Write-Host "Spawn tier      : $(if ($tierLine) { $tierLine.ToString().Trim() } else { 'NOT DETECTED (logger nil at warmup — normal if service just started)' })"

# 5. Recent session starts
$sessions = $lines | Select-String "handler: start_session" | Select-Object -Last 3
Write-Host ""
Write-Host "Recent sessions :"
if ($sessions) {
    $sessions | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "  (none in last $TailLines lines)"
}

# 6. session_output chunks — the money check
$chunks = $lines | Select-String "session_output chunk"
Write-Host ""
if ($chunks -and $chunks.Count -gt 0) {
    Write-Host "session_output  : $($chunks.Count) chunks found" -ForegroundColor Green
    $chunks | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "session_output  : NONE — no output chunks in last $TailLines lines" -ForegroundColor Red
    $pass = $false

    # Diagnose why
    $spawnErr = $lines | Select-String "CreateProcess|spawnWithPipes|spawnWithConPTY|spawnWithWSL|cmd.Start" | Select-Object -Last 5
    if ($spawnErr) {
        Write-Host ""
        Write-Host "Spawn log (last 5):"
        $spawnErr | ForEach-Object { Write-Host "  $_" }
    }

    $wslErr = $lines | Select-String "WSL detection" | Select-Object -Last 3
    if ($wslErr) {
        Write-Host ""
        Write-Host "WSL detection:"
        $wslErr | ForEach-Object { Write-Host "  $_" }
    }
}

# 7. Process spawned (from new exec.Cmd path)
$spawned = $lines | Select-String "spawnWithPipes: process started|spawnWithConPTY: process created|spawnWithWSL: process created" | Select-Object -Last 3
Write-Host ""
Write-Host "Process spawned :"
if ($spawned) {
    $spawned | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
} else {
    Write-Host "  (none — process may not be starting)" -ForegroundColor Yellow
    $pass = $false
}

# 8. Verdict
Write-Host ""
Write-Host "================================================"
if ($pass) {
    Write-Host "RESULT: PASS — session output is flowing" -ForegroundColor Green
    exit 0
} else {
    Write-Host "RESULT: FAIL — session output not flowing" -ForegroundColor Red
    Write-Host ""
    Write-Host "Next steps:"
    if ($account -match "LocalSystem") {
        Write-Host "  1. Swap service binary: Copy sessionforge-new.exe over sessionforge.exe (run as Admin)"
        Write-Host "  2. Restart service: sc.exe stop SessionForgeAgent && sc.exe start SessionForgeAgent"
        Write-Host "  3. Start a session in the browser, re-run this script"
    }
    exit 1
}
