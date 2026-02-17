# SessionForge Agent — Windows one-line installer
# Usage: irm https://sessionforge.dev/install.ps1 | iex
#
# Or with explicit save + run:
#   Invoke-WebRequest https://sessionforge.dev/install.ps1 -OutFile install.ps1
#   .\install.ps1

#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$REPO        = "sessionforge/agent"
$BINARY      = "sessionforge.exe"
$INSTALL_DIR = "$env:LOCALAPPDATA\SessionForge"
$SERVICE_KEY = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Write-Step { param($msg) Write-Host "[sessionforge] $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "[sessionforge] $msg" -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "[sessionforge] ERROR: $msg" -ForegroundColor Red; exit 1 }

# ── Detect Architecture ────────────────────────────────────────────────────────
$arch = [System.Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE")
$goArch = switch ($arch) {
    "AMD64" { "amd64" }
    "ARM64" { Write-Fail "ARM64 Windows is not yet supported." }
    default { "amd64" } # fallback
}

Write-Step "Detected platform: windows/$goArch"

# ── Fetch latest release ───────────────────────────────────────────────────────
Write-Step "Fetching latest release info..."
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$REPO/releases/latest" -ErrorAction Stop
} catch {
    Write-Fail "Could not fetch release info: $_"
}

$VERSION = $release.tag_name
if (-not $VERSION) { Write-Fail "Could not determine latest version." }
Write-Step "Latest version: $VERSION"

# ── Download ───────────────────────────────────────────────────────────────────
$ARCHIVE     = "sessionforge_windows_$goArch.zip"
$DOWNLOAD_URL = "https://github.com/$REPO/releases/download/$VERSION/$ARCHIVE"
$ZIP_PATH    = "$env:TEMP\sessionforge-$VERSION.zip"

Write-Step "Downloading $DOWNLOAD_URL..."
try {
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $ZIP_PATH -UseBasicParsing
} catch {
    Write-Fail "Download failed: $_"
}

# ── Verify checksum ────────────────────────────────────────────────────────────
$CHECKSUM_URL = "https://github.com/$REPO/releases/download/$VERSION/checksums.txt"
try {
    $checksums = Invoke-WebRequest -Uri $CHECKSUM_URL -UseBasicParsing | Select-Object -ExpandProperty Content
    $expectedLine = ($checksums -split "`n") | Where-Object { $_ -like "*$ARCHIVE*" }
    if ($expectedLine) {
        $expectedHash = ($expectedLine -split "\s+")[0].ToUpper()
        $actualHash   = (Get-FileHash $ZIP_PATH -Algorithm SHA256).Hash.ToUpper()
        if ($expectedHash -ne $actualHash) {
            Remove-Item $ZIP_PATH -Force
            Write-Fail "Checksum mismatch! Expected $expectedHash, got $actualHash. Aborting."
        }
        Write-Step "Checksum verified: OK"
    }
} catch {
    Write-Host "[sessionforge] Warning: Could not verify checksum. Proceeding anyway." -ForegroundColor Yellow
}

# ── Install ────────────────────────────────────────────────────────────────────
Write-Step "Installing to $INSTALL_DIR..."
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null

# Stop any running instance before overwriting.
Get-Process -Name "sessionforge" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Expand-Archive -Path $ZIP_PATH -DestinationPath $INSTALL_DIR -Force
Remove-Item $ZIP_PATH -Force

Write-Ok "SessionForge Agent $VERSION installed to $INSTALL_DIR\$BINARY"

# ── Add to User PATH ───────────────────────────────────────────────────────────
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$INSTALL_DIR*") {
    [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$INSTALL_DIR", "User")
    Write-Step "Added $INSTALL_DIR to user PATH (restart terminal to take effect)"
} else {
    Write-Step "$INSTALL_DIR is already in PATH"
}

# ── Next steps ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Restart your terminal to pick up the PATH change"
Write-Host "  2. Get your API key from: https://sessionforge.dev/dashboard/api-keys"
Write-Host "  3. Run: " -NoNewline; Write-Host "sessionforge auth login --key sf_live_xxxxx" -ForegroundColor Cyan
Write-Host "  4. Run: " -NoNewline; Write-Host "sessionforge service install" -ForegroundColor Cyan -NoNewline; Write-Host "  (optional: run as a Windows Service)"
Write-Host "  5. Run: " -NoNewline; Write-Host "sessionforge status" -ForegroundColor Cyan -NoNewline; Write-Host "           (verify connection)"
Write-Host ""
