# SessionForge — Debug Capture Script
# Collects diagnostics in one shot and writes a timestamped report file.
#
# Usage:
#   .\scripts\debug-session.ps1 [-SessionId <id>] [-Lines <n>]
#
# Parameters:
#   -SessionId   Optional session UUID to print a direct browser link
#   -Lines       Number of log lines to tail (default: 100)

param(
    [string]$SessionId = "",
    [int]$Lines = 100
)

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Section {
    param([string]$Title)
    $bar = "=" * 60
    Write-Host ""
    Write-Host $bar -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host $bar -ForegroundColor Cyan
}

# Accumulate everything for the output file
$transcript = [System.Collections.Generic.List[string]]::new()

function Out {
    param([string]$Line, [string]$Color = "White")
    Write-Host $Line -ForegroundColor $Color
    $transcript.Add($Line)
}

# ── State variables (for summary) ────────────────────────────────────────────
$agentRunning   = $false
$logLinesFound  = $false
$healthPass     = $false

# ── Header ───────────────────────────────────────────────────────────────────
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$outFile   = "debug-output-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"

Write-Section "SessionForge Debug Capture"
Out "Timestamp : $timestamp"
Out "Output    : $outFile"
Out "Log lines : $Lines"

# ── 1. Agent process check ────────────────────────────────────────────────────
Write-Section "Agent Process"

$proc = Get-Process -Name "sessionforge" -ErrorAction SilentlyContinue
if ($proc) {
    $agentRunning = $true
    Out "[OK] sessionforge.exe is RUNNING  (PID $($proc.Id))" "Green"
} else {
    Out "[!!] sessionforge.exe is NOT running" "Red"
    Out "     Start the agent with: sessionforge start" "Yellow"
}

# ── 2. Log file ───────────────────────────────────────────────────────────────
Write-Section "Agent Log"

# Config.toml may name the log differently — check both common names
$logCandidates = @(
    "$env:USERPROFILE\.sessionforge\agent.log",
    "$env:USERPROFILE\.sessionforge\sessionforge.log"
)

$logPath = $null
foreach ($candidate in $logCandidates) {
    if (Test-Path $candidate) {
        $logPath = $candidate
        break
    }
}

if ($logPath) {
    $logContent = Get-Content $logPath -Tail $Lines -ErrorAction SilentlyContinue
    if ($logContent) {
        $logLinesFound = $true
        Out "Log file  : $logPath" "Gray"
        Out "Lines     : $($logContent.Count) (last $Lines)" "Gray"
        Out ""
        foreach ($l in $logContent) {
            # Colorize by severity
            if ($l -match "ERROR|FATAL|panic") {
                Out $l "Red"
            } elseif ($l -match "WARN") {
                Out $l "Yellow"
            } elseif ($l -match "session_started|session_stopped|connected") {
                Out $l "Green"
            } else {
                Out $l "Gray"
            }
        }
    } else {
        Out "[--] Log file exists but is empty: $logPath" "Yellow"
    }
} else {
    Out "[!!] No log file found at expected locations:" "Red"
    foreach ($c in $logCandidates) { Out "       $c" "Yellow" }
    Out ""
    Out "     To enable logging, add to ~/.sessionforge/config.toml:" "Yellow"
    Out "       log_file  = `"$env:USERPROFILE\.sessionforge\agent.log`"" "Yellow"
    Out "       log_level = `"debug`"" "Yellow"
    Out ""
    Out "     Then run: .\scripts\setup-debug-logging.ps1" "Yellow"
}

# ── 3. Health check ───────────────────────────────────────────────────────────
Write-Section "Health Check — sessionforge.dev"

$healthUrl = "https://sessionforge.dev/api/health"
Out "GET $healthUrl" "Gray"

try {
    $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $status = $resp.StatusCode
    $body   = $resp.Content

    if ($status -eq 200) {
        $healthPass = $true
        Out "[OK] HTTP $status" "Green"
    } else {
        Out "[!!] HTTP $status" "Yellow"
    }
    Out "     $body" "Gray"
} catch {
    $errMsg = $_.Exception.Message
    Out "[!!] Health check FAILED: $errMsg" "Red"
}

# ── 4. Session browser link ───────────────────────────────────────────────────
if ($SessionId -ne "") {
    Write-Section "Session Link"
    $sessionUrl = "https://sessionforge.dev/sessions/$SessionId"
    Out "Session ID : $SessionId" "Gray"
    Out "Browser    : $sessionUrl" "Cyan"
}

# ── 5. Summary ────────────────────────────────────────────────────────────────
Write-Section "Summary"

$agentStatus  = if ($agentRunning)  { "[OK] Running"     } else { "[!!] NOT running" }
$logStatus    = if ($logLinesFound) { "[OK] Found"       } else { "[!!] No log data" }
$healthStatus = if ($healthPass)    { "[OK] Pass"        } else { "[!!] FAIL"        }

Out "Agent running   : $agentStatus"   $(if ($agentRunning)  { "Green" } else { "Red" })
Out "Log data        : $logStatus"     $(if ($logLinesFound) { "Green" } else { "Red" })
Out "Health check    : $healthStatus"  $(if ($healthPass)    { "Green" } else { "Red" })

# ── 6. Write output file ──────────────────────────────────────────────────────
$transcript | Set-Content -Path $outFile -Encoding UTF8

Write-Host ""
Write-Host "Full output saved to: $outFile" -ForegroundColor Cyan
