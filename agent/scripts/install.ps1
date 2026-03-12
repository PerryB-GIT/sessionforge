# SessionForge Agent — Windows one-line installer
#
# Basic install (no key):
#   iwr -useb https://sessionforge.dev/agent/install.ps1 | iex
#
# Fully automated (key inline) — two styles both work:
#   iwr -useb https://sessionforge.dev/agent/install.ps1 | iex; Install-SessionForge -ApiKey 'sf_live_xxxxx'
#   irm https://sessionforge.dev/agent/install.ps1 | iex; Install-SessionForge -ApiKey 'sf_live_xxxxx'

#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$REPO        = "PerryB-GIT/sessionforge"
$BINARY      = "sessionforge.exe"
$INSTALL_DIR = "$env:LOCALAPPDATA\Programs\sessionforge"

function Write-Step { param($msg) Write-Host "[sessionforge] $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "[sessionforge] $msg" -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "[sessionforge] ERROR: $msg" -ForegroundColor Red; exit 1 }

# ── Detect Architecture ────────────────────────────────────────────────────────
$arch   = [System.Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE")
$goArch = switch ($arch) {
    "AMD64" { "amd64" }
    "ARM64" { Write-Fail "ARM64 Windows is not yet supported." }
    default { "amd64" }
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
$ARCHIVE      = "sessionforge-windows-$goArch.zip"
$DOWNLOAD_URL = "https://github.com/$REPO/releases/download/$VERSION/$ARCHIVE"
$ZIP_PATH     = "$env:TEMP\sessionforge-$VERSION.zip"

Write-Step "Downloading $ARCHIVE..."
try {
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $ZIP_PATH -UseBasicParsing
} catch {
    Write-Fail "Download failed: $_"
}

# ── Verify checksum ────────────────────────────────────────────────────────────
try {
    $checksums    = (Invoke-WebRequest -Uri "https://github.com/$REPO/releases/download/$VERSION/checksums.txt" -UseBasicParsing).Content
    $expectedLine = ($checksums -split "`n") | Where-Object { $_ -like "*$ARCHIVE*" }
    if ($expectedLine) {
        $expectedHash = ($expectedLine -split "\s+")[0].ToUpper()
        $actualHash   = (Get-FileHash $ZIP_PATH -Algorithm SHA256).Hash.ToUpper()
        if ($expectedHash -ne $actualHash) {
            Remove-Item $ZIP_PATH -Force
            Write-Fail "Checksum mismatch! Expected $expectedHash, got $actualHash."
        }
        Write-Step "Checksum verified: OK"
    }
} catch {
    Write-Host "[sessionforge] Warning: Could not verify checksum. Proceeding." -ForegroundColor Yellow
}

# ── Install ────────────────────────────────────────────────────────────────────
Write-Step "Installing to $INSTALL_DIR..."
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null

# Stop any running instance before overwriting.
Get-Process -Name "sessionforge" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

Expand-Archive -Path $ZIP_PATH -DestinationPath $INSTALL_DIR -Force
Remove-Item $ZIP_PATH -Force

# Verify Git Bash was extracted.
$GitBash = "$INSTALL_DIR\gitbash\bin\bash.exe"
if (Test-Path $GitBash) {
    Write-Host "[sessionforge] Git Bash extracted: $GitBash" -ForegroundColor Green
} else {
    Write-Host "[sessionforge] Note: Git Bash not found in archive — will use system fallback." -ForegroundColor Yellow
}

$SF = "$INSTALL_DIR\$BINARY"
Write-Ok "SessionForge Agent $VERSION installed to $SF"

# ── Add to User PATH ───────────────────────────────────────────────────────────
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$INSTALL_DIR*") {
    [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$INSTALL_DIR", "User")
    $env:PATH = "$env:PATH;$INSTALL_DIR"
    Write-Step "Added $INSTALL_DIR to PATH"
}

# ── Install-SessionForge function ─────────────────────────────────────────────
# This function is exported into the caller's session so the one-liner:
#   iwr ... | iex; Install-SessionForge -ApiKey 'sf_live_xxx'
# works correctly after the script body runs.
function global:Install-SessionForge {
    param(
        [Parameter(Mandatory=$true)]
        [string]$ApiKey
    )

    $sfExe = "$env:LOCALAPPDATA\Programs\sessionforge\sessionforge.exe"
    if (-not (Test-Path $sfExe)) {
        Write-Host "[sessionforge] ERROR: Binary not found at $sfExe" -ForegroundColor Red
        return
    }

    # Authenticate
    Write-Host "[sessionforge] Authenticating..." -ForegroundColor Cyan
    try {
        & $sfExe auth login --key $ApiKey
    } catch {
        Write-Host "[sessionforge] ERROR: Authentication failed: $_" -ForegroundColor Red
        return
    }
    Write-Host "[sessionforge] Authenticated successfully." -ForegroundColor Green

    # Install as Windows service (requires elevated prompt)
    Write-Host "[sessionforge] Installing Windows service..." -ForegroundColor Cyan
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)

    if ($isAdmin) {
        & $sfExe service install
        & $sfExe service start
        Write-Host "[sessionforge] Service installed and started." -ForegroundColor Green
    } else {
        Write-Host "[sessionforge] Launching elevated prompt for service install..." -ForegroundColor Yellow
        Start-Process powershell -ArgumentList "-NoProfile -Command `"& '$sfExe' service install; & '$sfExe' service start`"" -Verb RunAs -Wait
        Write-Host "[sessionforge] Service install complete." -ForegroundColor Green
    }

    # Show status
    Write-Host ""
    & $sfExe status
}

# ── Done — show next steps ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "SessionForge Agent $VERSION is ready." -ForegroundColor White
Write-Host ""
Write-Host "If you have an API key, run:" -ForegroundColor White
Write-Host "  Install-SessionForge -ApiKey 'sf_live_xxxxx'" -ForegroundColor Cyan
Write-Host ""
Write-Host "Or manually:" -ForegroundColor White
Write-Host "  sessionforge auth login --key sf_live_xxxxx"
Write-Host "  sessionforge service install"
Write-Host "  sessionforge status"
Write-Host ""
