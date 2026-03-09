# debug-capture.ps1
# Captures SessionForge agent log tail, /api/health response, and timestamp.
# Outputs to both console and C:\Users\Jakeb\sessionforge\debug-capture-output.txt

$OutputFile = "C:\Users\Jakeb\sessionforge\debug-capture-output.txt"
$HealthUrl  = "https://sessionforge.dev/api/health"

# Possible log file locations (checked in order)
$LogPaths = @(
    "$env:USERPROFILE\.sessionforge\sessionforge.log",
    "C:\Users\Jakeb\.sessionforge\sessionforge.log"
)

# Helper: write a line to both console and output file
function Write-Both {
    param([string]$Line = "")
    Write-Host $Line
    Add-Content -Path $OutputFile -Value $Line
}

# ── Start fresh output file ──────────────────────────────────────────────────
$null = New-Item -Path $OutputFile -ItemType File -Force

$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss (UTC zzz)"
Write-Both "============================================================"
Write-Both "  SessionForge Debug Capture"
Write-Both "  $Timestamp"
Write-Both "============================================================"
Write-Both ""

# ── Agent log tail ────────────────────────────────────────────────────────────
Write-Both "---- Agent Log (last 50 lines) -----------------------------"
$LogFound = $false

foreach ($LogPath in $LogPaths) {
    if (Test-Path $LogPath) {
        Write-Both "Log file: $LogPath"
        Write-Both ""
        try {
            $Lines = Get-Content -Path $LogPath -Tail 50 -ErrorAction Stop
            foreach ($L in $Lines) { Write-Both $L }
        } catch {
            Write-Both "[ERROR] Could not read log file: $_"
        }
        $LogFound = $true
        break
    }
}

if (-not $LogFound) {
    Write-Both "[WARNING] No agent log file found."
    Write-Both "  Checked locations:"
    foreach ($P in $LogPaths) { Write-Both "    $P" }
}

Write-Both ""

# ── Health check ─────────────────────────────────────────────────────────────
Write-Both "---- Health Check: $HealthUrl ----"
try {
    $Response = Invoke-RestMethod -Uri $HealthUrl `
                                  -Method GET `
                                  -TimeoutSec 15 `
                                  -ErrorAction Stop
    $ResponseJson = $Response | ConvertTo-Json -Depth 5
    Write-Both $ResponseJson
} catch {
    # Capture raw HTTP response if available
    $StatusCode = $_.Exception.Response?.StatusCode?.value__
    if ($StatusCode) {
        Write-Both "[HTTP $StatusCode] $($_.Exception.Message)"
        try {
            $RawBody = $_.ErrorDetails.Message
            if ($RawBody) { Write-Both $RawBody }
        } catch {}
    } else {
        Write-Both "[ERROR] $($_.Exception.Message)"
    }
}

Write-Both ""
Write-Both "============================================================"
Write-Both "  Capture complete: $Timestamp"
Write-Both "  Output saved to: $OutputFile"
Write-Both "============================================================"
