#!/bin/sh
# SessionForge Agent — Linux/macOS one-line installer
# Usage: curl -sSL https://sessionforge.dev/install.sh | sh
set -e

REPO="sessionforge/agent"
BINARY="sessionforge"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="${HOME}/.sessionforge"

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { printf "${CYAN}[sessionforge]${RESET} %s\n" "$1"; }
ok()   { printf "${GREEN}[sessionforge]${RESET} %s\n" "$1"; }
err()  { printf "${RED}[sessionforge] ERROR:${RESET} %s\n" "$1" >&2; exit 1; }

# ── Detect OS ──────────────────────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  linux)  OS="linux"  ;;
  darwin) OS="darwin" ;;
  *)      err "Unsupported operating system: $OS" ;;
esac

# ── Detect Architecture ────────────────────────────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)          ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *)               err "Unsupported architecture: $ARCH" ;;
esac

log "Detected platform: ${OS}/${ARCH}"

# ── Fetch latest release ───────────────────────────────────────────────────────
log "Fetching latest release info..."
if command -v curl >/dev/null 2>&1; then
  FETCH="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
  FETCH="wget -qO-"
else
  err "Neither curl nor wget found. Please install one and retry."
fi

LATEST_JSON=$($FETCH "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(printf '%s' "$LATEST_JSON" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
  err "Could not determine latest version. Check your internet connection."
fi

log "Latest version: ${VERSION}"

# ── Download and extract ───────────────────────────────────────────────────────
ARCHIVE="sessionforge_${OS}_${ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE}"
TMP_DIR=$(mktemp -d)

log "Downloading ${DOWNLOAD_URL}..."
$FETCH "$DOWNLOAD_URL" | tar xz -C "$TMP_DIR"

# ── Install ────────────────────────────────────────────────────────────────────
if [ -w "$INSTALL_DIR" ]; then
  SUDO=""
else
  SUDO="sudo"
  log "Need sudo to install to ${INSTALL_DIR}"
fi

$SUDO mv "${TMP_DIR}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
$SUDO chmod +x "${INSTALL_DIR}/${BINARY}"
rm -rf "$TMP_DIR"

ok "SessionForge Agent ${VERSION} installed to ${INSTALL_DIR}/${BINARY}"

# ── Verify ─────────────────────────────────────────────────────────────────────
if ! command -v sessionforge >/dev/null 2>&1; then
  printf "\n${RED}Warning:${RESET} ${INSTALL_DIR} is not in your PATH.\n"
  printf "Add this to your shell profile:\n"
  printf "  export PATH=\"\$PATH:${INSTALL_DIR}\"\n\n"
fi

# ── Next steps ─────────────────────────────────────────────────────────────────
printf "\n${BOLD}Next steps:${RESET}\n"
printf "  1. Get your API key from ${CYAN}https://sessionforge.dev/dashboard/api-keys${RESET}\n"
printf "  2. Run: ${BOLD}sessionforge auth login --key sf_live_xxxxx${RESET}\n"
printf "  3. Run: ${BOLD}sessionforge service install${RESET}  (start on boot)\n"
printf "  4. Run: ${BOLD}sessionforge status${RESET}           (verify connection)\n\n"
