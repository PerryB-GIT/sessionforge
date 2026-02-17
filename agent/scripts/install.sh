#!/bin/bash
set -e

REPO="sessionforge/agent"
BINARY="sessionforge"
INSTALL_DIR="/usr/local/bin"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Get latest version
VERSION=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
echo "Installing SessionForge Agent ${VERSION}..."

# Download binary
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/sessionforge_${OS}_${ARCH}.tar.gz"
curl -sL "$DOWNLOAD_URL" | tar xz -C /tmp

# Install
sudo mv /tmp/$BINARY $INSTALL_DIR/$BINARY
sudo chmod +x $INSTALL_DIR/$BINARY

echo "SessionForge Agent ${VERSION} installed!"
echo ""
echo "Next steps:"
echo "  1. Get your API key from https://sessionforge.dev/dashboard/api-keys"
echo "  2. Run: sessionforge auth token <your-api-key>"
echo "  3. Run: sessionforge service install (to start on boot)"
