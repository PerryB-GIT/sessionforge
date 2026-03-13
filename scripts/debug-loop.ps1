# debug-loop.ps1
# Fully automated: build -> trigger swap (via SYSTEM scheduled task) -> start session (via Playwright) -> check logs
# Runs as normal user. No UAC required.
# One-time setup: run register-swap-task.ps1 as Administrator once first.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\debug-loop.ps1

param(
    [int]$Iterations = 20,
    [switch]$NoBuild,
    [switch]$NoSwap
)

$goExe    = "C:\Users\Jakeb\go\bin\go.exe"
$agentDir = "C:\Users\Jakeb\sessionforge\agent"
$newBin   = "$agentDir\sessionforge-new.exe"
$logFile  = "C:\Users\Jakeb\.sessionforge\agent.log"
$doneFlag = "C:\Users\Jakeb\sessionforge\scripts\.swap-done"
$errFlag  = "C:\Users\Jakeb\sessionforge\scripts\.swap-error"
$taskName = "SessionForgeSwap"

function Invoke-Swap {
    Write-Host "`n[SWAP] Triggering swap via Task Scheduler..." -ForegroundColor Cyan

    Remove-Item $doneFlag -Force -ErrorAction SilentlyContinue
    Remove-Item $errFlag  -Force -ErrorAction SilentlyContinue

    $result = schtasks /run /tn $taskName 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[SWAP] ERROR: schtasks failed. Run register-swap-task.ps1 as Admin first." -ForegroundColor Red
        Write-Host "       $result" -ForegroundColor Red
        return $false
    }

    Write-Host "[SWAP] Task triggered. Waiting for completion..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds(35)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $errFlag) {
            Write-Host "[SWAP] FAILED: $(Get-Content $errFlag)" -ForegroundColor Red
            return $false
        }
        if (Test-Path $doneFlag) {
            Write-Host "[SWAP] Service swapped and running." -ForegroundColor Green
            return $true
        }
        Start-Sleep 1
    }
    Write-Host "[SWAP] Timed out waiting for swap." -ForegroundColor Red
    return $false
}

function Start-SessionViaPlaywright {
    # Uses Node.js + Playwright to start a session on sessionforge.dev
    $playwrightScript = "C:\Users\Jakeb\sessionforge\scripts\start-session.mjs"
    Write-Host "[SESSION] Starting session via Playwright..." -ForegroundColor Cyan
    $output = & node $playwrightScript 2>&1
    $sessionId = ($output | Select-String "SESSION_ID=").ToString() -replace ".*SESSION_ID=",""
    if ($sessionId) {
        Write-Host "[SESSION] Started: $sessionId" -ForegroundColor Green
        return $sessionId.Trim()
    }
    Write-Host "[SESSION] Failed. Output:`n$output" -ForegroundColor Red
    return $null
}

function Wait-ForSession {
    param([string]$SessionId, [int]$TimeoutSec = 60)
    Write-Host "[WAIT] Waiting for session $SessionId in log..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $tail = Get-Content $logFile -Tail 20 -ErrorAction SilentlyContinue
        if ($tail | Select-String "starting session.*$SessionId") {
            Write-Host "[WAIT] Session confirmed in log." -ForegroundColor Green
            return $true
        }
        # Also accept any new "starting session" if we can't match by ID
        if ($SessionId -eq "" -and ($tail | Select-String "starting session")) {
            Write-Host "[WAIT] Session detected in log." -ForegroundColor Green
            return $true
        }
        Start-Sleep 2
    }
    Write-Host "[WAIT] Timeout - session not seen in log." -ForegroundColor Red
    return $false
}

function Check-Output {
    param([int]$WaitSec = 25)
    Write-Host "[CHECK] Waiting ${WaitSec}s for output..." -ForegroundColor Cyan
    Start-Sleep $WaitSec
    $tail = Get-Content $logFile -Tail 150 -ErrorAction SilentlyContinue

    $spawned   = $tail | Select-String "spawnWithPipes: process started|spawnWithUserConPTY: process started" | Select-Object -Last 1
    $output    = $tail | Select-String "session_output chunk" | Select-Object -Last 3
    $exited    = $tail | Select-String "process exited|session exited|crashed" | Select-Object -Last 1
    $spawnErr  = $tail | Select-String "spawnWithUserConPTY failed|ERROR.*spawn" | Select-Object -Last 1

    Write-Host ""
    Write-Host "=== Result ===" -ForegroundColor Cyan
    if ($spawned)  { Write-Host "SPAWNED : $($spawned.Line)"  -ForegroundColor Green }
    else           { Write-Host "SPAWNED : NOT FOUND"         -ForegroundColor Red }
    if ($spawnErr) { Write-Host "ERR     : $($spawnErr.Line)" -ForegroundColor Yellow }

    if ($output -and $output.Count -gt 0) {
        Write-Host "OUTPUT  : $($output.Count) chunk(s) - SUCCESS!" -ForegroundColor Green
        $output | ForEach-Object { Write-Host "  $_" }
        return $true
    } else {
        Write-Host "OUTPUT  : NONE" -ForegroundColor Red
        if ($exited) { Write-Host "EXIT    : $($exited.Line)" -ForegroundColor Yellow }
    }
    return $false
}

# ── Main ────────────────────────────────────────────────────────────────────

Write-Host "=== SessionForge Debug Loop ===" -ForegroundColor Magenta

for ($iter = 1; $iter -le $Iterations; $iter++) {
    Write-Host "`n========================================" -ForegroundColor Magenta
    Write-Host " Iteration $iter / $Iterations" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta

    if (-not $NoBuild) {
        Write-Host "[BUILD] Building..." -ForegroundColor Cyan
        $buildOut = & $goExe build -o $newBin "$agentDir\cmd\sessionforge\" 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[BUILD] FAILED:`n$buildOut" -ForegroundColor Red
            break
        }
        Write-Host "[BUILD] OK" -ForegroundColor Green
    }

    if (-not $NoSwap) {
        $swapped = Invoke-Swap
        if (-not $swapped) { break }
        Start-Sleep 5  # Wait for agent reconnect
    }

    $sessionId = Start-SessionViaPlaywright
    if (-not $sessionId) {
        Write-Host "[LOOP] Could not start session." -ForegroundColor Yellow
        continue
    }

    $found = Wait-ForSession -SessionId $sessionId -TimeoutSec 60
    if (-not $found) {
        Write-Host "[LOOP] Session not in log - skipping." -ForegroundColor Yellow
        continue
    }

    $success = Check-Output -WaitSec 25
    if ($success) {
        Write-Host "`nSUCCESS - output is flowing!" -ForegroundColor Green
        break
    } else {
        Write-Host "`n[LOOP] No output. Continuing..." -ForegroundColor Yellow
        Start-Sleep 3
    }
}

Write-Host "`nLoop complete." -ForegroundColor Cyan
Read-Host "Press Enter to close"
