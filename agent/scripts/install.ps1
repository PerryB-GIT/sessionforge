# SessionForge Agent Installer for Windows
$ErrorActionPreference = "Stop"

$REPO = "sessionforge/agent"
$INSTALL_DIR = "$env:LOCALAPPDATA\SessionForge"

Write-Host "Installing SessionForge Agent..." -ForegroundColor Cyan

# Get latest version
$release = Invoke-RestMethod "https://api.github.com/repos/$REPO/releases/latest"
$VERSION = $release.tag_name
Write-Host "Version: $VERSION" -ForegroundColor Green

# Download
$downloadUrl = "https://github.com/$REPO/releases/download/$VERSION/sessionforge_windows_amd64.zip"
$zipPath = "$env:TEMP\sessionforge.zip"
Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

# Install
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $INSTALL_DIR -Force
Remove-Item $zipPath

# Add to PATH
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$INSTALL_DIR*") {
    [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$INSTALL_DIR", "User")
}

Write-Host ""
Write-Host "SessionForge Agent $VERSION installed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart your terminal"
Write-Host "  2. Get your API key from https://sessionforge.dev/dashboard/api-keys"
Write-Host "  3. Run: sessionforge auth token <your-api-key>"
