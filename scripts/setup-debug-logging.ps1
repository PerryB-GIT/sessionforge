# SessionForge — One-Time Debug Logging Setup
# Ensures config.toml has log_file and log_level set so debug-session.ps1
# always has data to read.
#
# Usage: .\scripts\setup-debug-logging.ps1

$configPath = "$env:USERPROFILE\.sessionforge\config.toml"
$logPath    = "$env:USERPROFILE\.sessionforge\agent.log"

# ── Verify config exists ──────────────────────────────────────────────────────
if (-not (Test-Path $configPath)) {
    Write-Host "[!!] Config not found: $configPath" -ForegroundColor Red
    Write-Host "     Run the SessionForge agent at least once to generate config.toml." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "SessionForge — Debug Logging Setup" -ForegroundColor Cyan
Write-Host "Config: $configPath" -ForegroundColor Gray
Write-Host ""

# Read current content
$lines = Get-Content $configPath

# ── Helper: check if a key is already set ─────────────────────────────────────
function Get-TomlValue {
    param([string[]]$Content, [string]$Key)
    foreach ($line in $Content) {
        if ($line -match "^\s*$Key\s*=\s*(.+)$") {
            return $Matches[1].Trim().Trim('"')
        }
    }
    return $null
}

$changes = @()

# ── Check log_file ────────────────────────────────────────────────────────────
$existingLogFile = Get-TomlValue -Content $lines -Key "log_file"
if ($existingLogFile) {
    Write-Host "[OK] log_file already set: $existingLogFile" -ForegroundColor Green
} else {
    # Escape backslashes for TOML
    $escapedPath = $logPath -replace '\\', '\\\\'
    $lines += "log_file = `"$escapedPath`""
    $changes += "Added   log_file = `"$escapedPath`""
    Write-Host "[+] Added log_file = `"$escapedPath`"" -ForegroundColor Yellow
}

# ── Check log_level ───────────────────────────────────────────────────────────
$existingLogLevel = Get-TomlValue -Content $lines -Key "log_level"
if ($existingLogLevel) {
    Write-Host "[OK] log_level already set: $existingLogLevel" -ForegroundColor Green
} else {
    $lines += 'log_level = "debug"'
    $changes += 'Added   log_level = "debug"'
    Write-Host '[+] Added log_level = "debug"' -ForegroundColor Yellow
}

# ── Write back only if changed ────────────────────────────────────────────────
if ($changes.Count -gt 0) {
    # Backup original
    $backupPath = "$configPath.bak"
    Copy-Item $configPath $backupPath -Force
    Write-Host ""
    Write-Host "Backup saved to: $backupPath" -ForegroundColor Gray

    $lines | Set-Content -Path $configPath -Encoding UTF8
    Write-Host ""
    Write-Host "Changes written to config.toml:" -ForegroundColor Cyan
    foreach ($c in $changes) { Write-Host "  $c" -ForegroundColor White }
    Write-Host ""
    Write-Host "Restart the SessionForge agent for changes to take effect." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "No changes needed — config.toml is already set up for debug logging." -ForegroundColor Green
}

Write-Host ""
